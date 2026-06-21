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
}

impl PiProcess {
    pub fn new() -> Self {
        Self {
            child: None,
            cwd: None,
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
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
                        if line.is_empty() {
                            continue;
                        }
                        eprintln!("[pi stdout] {}", line);

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
                        eprintln!("[pi] terminated with code {:?}", status.code);
                        let _ = app_clone.emit("pi:terminated", status.code);
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

    /// Enviar un comando JSONL a pi via stdin
    pub fn send(&mut self, json_line: &str) -> Result<(), String> {
        let child = self.child.as_mut().ok_or("pi process not running")?;

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
