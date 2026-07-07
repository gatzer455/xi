use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use tokio::sync::oneshot;

// ─── Pending Requests ────────────────────────────────────────────────────────

/// Requests interactivos de extensiones de pi pendientes de respuesta.
///
/// Cada request tiene un id único (UUID) y un oneshot::Sender para
/// enviar la respuesta de vuelta al task que lee stdout y escribe
/// la respuesta a pi via stdin.
pub type PendingRequests = Arc<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>>;

pub fn create_pending_requests() -> PendingRequests {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Retorna el directorio donde Tauri resolvió el sidecar `name` en
/// el bundle actual. Se usa como `PI_PACKAGE_DIR` para que pi pueda
/// leer su `package.json` (necesario para reportar la versión real
/// en lugar de "0.0.0" cuando corre como bun-binary).
///
/// En dev, Tauri expone el binario copiado a `target/debug/<name>`
/// y los resources a `target/debug/`. En release, Tauri los copia
/// juntos (macOS: `Contents/Resources/`, Windows: junto al .exe,
/// Linux: junto al binario). El directorio es estable para cada
/// release, así que es un buen lugar para que el `package.json` viva.
///
/// BUG HISTÓRICO: en una versión anterior esta función hacía
/// `resource_dir.join(name)`, retornando el path al BINARIO (un
/// archivo), no al directorio. pi intentaba leer `<path>/package.json`
/// y fallaba con ENOTDIR. Ahora retornamos el directorio limpio.
fn get_sidecar_dir(app: &AppHandle, _name: &str) -> PathBuf {
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// Estado del proceso pi
pub struct PiProcess {
    child: Option<tauri_plugin_shell::process::CommandChild>,
    cwd: Option<String>,
    /// Identificador de generación del proceso actual. Se incrementa
    /// en cada `spawn()` y en cada `kill()`. El reader task captura
    /// el valor al arrancar y, al recibir `Terminated`, SOLO limpia
    /// `child` si su generación coincide con la actual. Esto evita
    /// que el `Terminated` tardío de un proceso viejo (matado por un
    /// re-spawn) pisée la referencia del nuevo proceso vivo — bug que
    /// dejaba a xi sin poder hablar con el nuevo pi tras un kill+
    /// respawn (ej. abrir una sesión vieja o un new chat).
    generation: u64,
}

impl PiProcess {
    pub fn new() -> Self {
        Self {
            child: None,
            cwd: None,
            generation: 0,
        }
    }

    /// Spawnear el proceso pi como sidecar con un cwd específico.
    ///
    /// Si `session_path` viene, valida que el archivo exista y pasa
    /// `--session <path>` a pi para que cargue esa sesión al arrancar.
    /// La validación se hace ANTES de matar el sidecar actual: si el
    /// path es inválido, la sesión activa queda intacta en vez de
    /// romperse por un spawn fallido posterior.
    pub fn spawn(
        &mut self,
        cwd: String,
        session_path: Option<String>,
        app: AppHandle,
        pending_requests: PendingRequests,
        process_state: PiProcessState,
    ) -> Result<(), String> {
        eprintln!(
            "[pi] spawn requested, cwd={}, session_path={:?}",
            cwd, session_path
        );

        // Validar el path de sesión antes de matar el sidecar actual.
        // Si el archivo no existe, devolvemos error sin tocar nada.
        if let Some(path) = &session_path {
            std::fs::metadata(path)
                .map_err(|e| format!("session file not found: {} ({})", path, e))?;
        }

        // Si ya hay un proceso corriendo, matarlo
        self.kill();

        // Construir args base + session opcional
        let mut args: Vec<String> = vec!["--mode".into(), "rpc".into(), "--no-themes".into()];
        if let Some(path) = &session_path {
            args.push("--session".into());
            args.push(path.clone());
        }

        // Crear el sidecar command. PI_PACKAGE_DIR apunta al
        // directorio del binario de pi dentro del bundle de Tauri
        // (donde está el package.json que el build-pi.sh copia al
        // lado del binario). Sin esto, pi detecta que es un bun-
        // binary y VERSION retorna "0.0.0" en lugar de la versión
        // real.
        let sidecar_command = app
            .shell()
            .sidecar("pi")
            .map_err(|e| format!("Failed to create sidecar command: {}", e))?
            .args(args)
            .env("PI_PACKAGE_DIR", get_sidecar_dir(&app, "pi"))
            .current_dir(&cwd);

        // Spawnear el proceso
        let (mut rx, child) = sidecar_command
            .spawn()
            .map_err(|e| format!("Failed to spawn pi sidecar: {}", e))?;

        // Leer stdout/stderr en un task async y emitir eventos.
        //
        // El reader intercepta `extension_ui_request` antes de emitir
        // `pi:raw`. Por cada request, crea un oneshot channel y spawnea
        // un task que espera la respuesta del frontend y la escribe a
        // stdin de pi.
        eprintln!("[pi] sidecar spawned, waiting for stdout");
        // Avanzar la generación ANTES de spawnear el reader y capturarla.
        // Usamos self.generation directamente (no re-lockeamos
        // process_state: el caller start_pi ya tiene tomado ese lock,
        // y Mutex de Rust no es reentrante — re-lockear seria deadlock).
        self.generation = self.generation.wrapping_add(1);
        let spawned_generation = self.generation;
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                        if line.is_empty() {
                            continue;
                        }
                        // Log filtrado: muestra tipo+size, trunca payloads grandes
                        log_pi_stdout(&line);

                        // Interceptar extension_ui_request ANTES de emitir pi:raw
                        if let Some(val) = try_parse_extension_ui_request(&line) {
                            let id = val["id"].as_str().unwrap_or("").to_string();
                            eprintln!("[extension-ui] intercepted request id={id}");

                            let (tx, rx) = oneshot::channel();
                            pending_requests.lock().unwrap().insert(id.clone(), tx);

                            // Emitir al frontend para mostrar UI
                            let _ = app_clone.emit("extension-ui-request", val);

                            // Spawnear task que espera la respuesta y escribe a stdin
                            let pending = pending_requests.clone();
                            let proc = process_state.clone();
                            let _app_task = app_clone.clone();
                            let id_clone = id.clone();
                            tauri::async_runtime::spawn(async move {
                                // Esperar la respuesta del frontend sin timeout propio.
                                // Pi ya tiene su propio timeout — si el usuario tarda mucho,
                                // pi maneja el timeout y cierra la sesión.
                                match rx.await {
                                    Ok(response) => {
                                        // Construir response con id y tipo, más los campos del response
                                        let mut response_obj = serde_json::Map::new();
                                        response_obj.insert(
                                            "type".into(),
                                            serde_json::Value::String(
                                                "extension_ui_response".into(),
                                            ),
                                        );
                                        response_obj.insert(
                                            "id".into(),
                                            serde_json::Value::String(id_clone.clone()),
                                        );
                                        // Merge los campos del response del frontend
                                        if let serde_json::Value::Object(map) = response {
                                            for (k, v) in map {
                                                response_obj.insert(k, v);
                                            }
                                        }
                                        let response_json = serde_json::Value::Object(response_obj);
                                        let mut process = proc.lock().unwrap();
                                        if let Err(e) = process.send(&response_json.to_string()) {
                                            eprintln!(
                                                "[extension-ui] failed to write response: {e}"
                                            );
                                        }
                                    }
                                    Err(_) => {
                                        // Channel closed — frontend dropped without responding
                                        eprintln!(
                                            "[extension-ui] channel closed for id={id_clone}"
                                        );
                                    }
                                }
                                pending.lock().unwrap().remove(&id_clone);
                            });
                            continue;
                        }

                        // Evento normal — emitir como pi:raw
                        let _ = app_clone.emit("pi:raw", line);
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                        if !line.is_empty() {
                            eprintln!("[pi stderr] {}", line);
                            let _ = app_clone.emit("pi:err", line);
                        }
                    }
                    CommandEvent::Terminated(status) => {
                        eprintln!(
                            "[pi] terminated with code {:?} (generation {})",
                            status.code, spawned_generation
                        );
                        let _ = app_clone.emit("pi:terminated", status.code);
                        // Solo limpiar child si ESTE proceso sigue siendo
                        // el activo (misma generación). Si hubo un
                        // re-spawn en paralelo, generation ya avanzó y NO
                        // debemos pisar el nuevo child vivo — caso:
                        // abrir sesión vieja o new chat hace kill+respawn,
                        // y el Terminated del viejo llegaba tarde y piseaba
                        // la referencia del nuevo pi.
                        let mut proc = process_state.lock().unwrap();
                        if proc.generation == spawned_generation {
                            proc.child = None;
                            proc.cwd = None;
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });

        self.child = Some(child);
        self.cwd = Some(cwd);

        Ok(())
    }

    /// Enviar un comando JSONL a pi via stdin.
    ///
    /// Si pi no está corriendo, el error incluye el comando que se
    /// intentó enviar (campo `type` del JSON) para que el frontend
    /// pueda mostrarlo y el desarrollador pueda diagnosticar sin
    /// abrir el debugger. Es un error estructurado con contexto.
    pub fn send(&mut self, json_line: &str) -> Result<(), String> {
        let child = self
            .child
            .as_mut()
            .ok_or_else(|| format_command_not_running_error(json_line))?;

        child
            .write(format!("{}\n", json_line).as_bytes())
            .map_err(|e| format!("Failed to write to stdin: {}", e))?;

        Ok(())
    }

    /// Matar el proceso pi
    pub fn kill(&mut self) {
        if let Some(child) = self.child.take() {
            let _ = child.kill();
        }
        self.cwd = None;
        // Avanzar la generación también al matar manualmente: así un
        // `Terminated` tardío del child viejo no pisea un `child=None`
        // sobre un proceso que ya fue reemplazado por un spawn posterior.
        self.generation = self.generation.wrapping_add(1);
    }

    /// Verificar si el proceso está corriendo
    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    /// Obtener el cwd actual
    pub fn cwd(&self) -> Option<&str> {
        self.cwd.as_deref()
    }
}

/// Wrapper thread-safe para PiProcess
pub type PiProcessState = Arc<Mutex<PiProcess>>;

pub fn create_pi_state() -> PiProcessState {
    Arc::new(Mutex::new(PiProcess::new()))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Loguear una línea stdout de pi a la terminal con filtro inteligente.
///
/// - Si es JSON válido, extrae el campo `type` y muestra tipo + tamaño.
/// - Si el payload es chico (< 300 B), lo muestra completo.
/// - Si es grande, muestra solo el tipo + tamaño + primeros 200 chars.
/// - Si no es JSON válido, muestra la línea tal cual (debería ser raro).
const STDOUT_LOG_SIZE_LIMIT: usize = 300;
const STDOUT_LOG_TRUNCATE: usize = 200;

fn log_pi_stdout(line: &str) {
    let size = line.len();
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
        let event_type = val
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");

        // message_update es 90% del tráfico: usamos debug! para que no
        // inunde la terminal en dev normal. Se ve con RUST_LOG=debug.
        // El resto (response, message_end, agent_end, etc.) sigue en info!.
        let is_stream = event_type == "message_update";

        if size > STDOUT_LOG_SIZE_LIMIT {
            // chars().take() es UTF-8-safe: no paniquea si el corte
            // cae en medio de un carácter multi-byte.
            let truncated: String = line.chars().take(STDOUT_LOG_TRUNCATE).collect();
            if is_stream {
                log::debug!("[pi stdout] type={event_type} size={size}B (truncated) {truncated}…");
            } else {
                log::info!("[pi stdout] type={event_type} size={size}B (truncated) {truncated}…");
            }
        } else {
            if is_stream {
                log::debug!("[pi stdout] type={event_type} size={size}B {line}");
            } else {
                log::info!("[pi stdout] type={event_type} size={size}B {line}");
            }
        }
    } else {
        log::info!("[pi stdout] (unparseable) size={size}B {line}");
    }
}

/// Intentar parsear una línea JSONL como `extension_ui_request`.
///
/// Retorna `Some(Value)` si la línea es un request válido,
/// `None` si no lo es (evento normal de pi).
fn try_parse_extension_ui_request(line: &str) -> Option<serde_json::Value> {
    let val = serde_json::from_str::<serde_json::Value>(line).ok()?;
    if val.get("type").and_then(|t| t.as_str()) != Some("extension_ui_request") {
        return None;
    }
    if val.get("id").is_none() || val.get("method").is_none() {
        return None;
    }
    Some(val)
}

/// Construye un error estructurado cuando se intenta mandar un
/// comando a pi sin que el sidecar esté corriendo.
///
/// Extrae el campo `type` del JSON para identificar qué comando
/// se intentó. Si el JSON no parsea o no tiene `type`, usa
/// "unknown". El mensaje incluye el tipo de comando y una
/// sugerencia de fix (llamar a `start_pi` primero).
///
/// NO incluye el JSON completo porque puede contener datos
/// sensibles del usuario (prompts, archivos, etc.). Solo
/// exponemos el `type` para diagnóstico.
///
/// Esto aplica la regla "errores estructurados con contexto" del
/// code-style: el error permite entender la causa sin abrir el
/// debugger y sin reproducir el bug desde cero.
fn format_command_not_running_error(json_line: &str) -> String {
    let cmd_type = serde_json::from_str::<serde_json::Value>(json_line)
        .ok()
        .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(String::from))
        .unwrap_or_else(|| "unknown".to_string());
    format!(
        "pi process not running. Cannot send command type=\"{cmd_type}\". \
         Fix: call start_pi(cwd) before sending commands to pi."
    )
}
