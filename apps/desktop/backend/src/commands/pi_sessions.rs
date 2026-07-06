use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;
use tokio::time::timeout;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Nombre del sidecar que invoca este módulo. Debe matchear
/// `externalBin` en `tauri.conf.json` y el allowlist en
/// `capabilities/default.json`.
const PI_SESSIONS_BIN: &str = "pi-sessions";

/// Timeout para cada sub-proceso de `pi-sessions`. La operación `list`
/// puede tocar cientos de archivos; las otras dos son instantáneas.
/// 20s es generoso pero evita que un cuelgue del sidecar congele la UI.
const SUBPROCESS_TIMEOUT: Duration = Duration::from_secs(20);

/// Sesión de pi serializada al frontend.
///
/// Refleja la `interface SessionInfo` de TypeScript en
/// `frontend/src/lib/pi/types.ts`. Si cambian los campos en un lado,
/// hay que actualizarlos en el otro — el contrato se valida en el
/// `serde_json::from_str` de `list_sessions`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub path: String,
    pub id: String,
    pub cwd: String,
    pub name: Option<String>,
    pub parent_session_path: Option<String>,
    pub created: u64,
    pub modified: u64,
    pub message_count: u64,
    pub first_message: String,
}

/// Forma del JSON que `pi-sessions list` emite en stdout.
/// El campo `skipped` aparece solo cuando hay archivos corruptos
/// que `SessionManager.list` omitió.
#[derive(Deserialize)]
struct ListResponse {
    sessions: Vec<SessionInfo>,
    #[serde(default)]
    skipped: Option<SkippedInfo>,
}

/// Archivos corruptos que `pi-sessions list` encontró pero no pudo leer.
/// Se expone al frontend para que muestre un warning — sin esto, el
/// usuario no sabría que faltan sesiones.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkippedInfo {
    pub count: u64,
}

/// Resultado de `list_sessions`: sesiones parseadas + opcionalmente
/// archivos que no se pudieron leer.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsResult {
    pub sessions: Vec<SessionInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<SkippedInfo>,
}

/// Resuelve el path del binario `pi-sessions` en runtime.
///
/// Replica la lógica de resolución de sidecars de Tauri: el binario
/// está en el mismo directorio que el ejecutable de la app. En dev
/// es `target/debug/pi-sessions`, en producción queda junto al
/// binario empaquetado.
///
/// Hacemos esto manualmente en vez de usar `app.shell().sidecar()`
/// porque el shell plugin de Tauri tiene un bug conocido donde el
/// event loop proxy interno pierde eventos cuando el output es grande
/// (tauri-apps/tauri#7684). Con 35+ sesiones (~220KB de JSON), el
/// proxy se satura y solo entrega los primeros ~72KB, truncando el
/// resto. `std::process::Command::output()` no pasa por ese proxy y
/// maneja outputs de cualquier tamaño sin pérdida.
fn resolve_sidecar_path(_app: &AppHandle) -> Result<PathBuf, String> {
    // `std::env::current_exe()` nos da el path del binario de xi.
    // En dev es `target/debug/xi-backend`, en producción es el
    // binario empaquetado. El sidecar `pi-sessions` está en el
    // mismo directorio (Tauri lo copia ahí durante el build).
    let exe = std::env::current_exe().map_err(|e| format!("failed to resolve current exe: {e}"))?;

    let exe_dir = exe
        .parent()
        .ok_or_else(|| "current exe has no parent directory".to_string())?;

    // En macOS, dentro de un .app bundle, el binario está en
    // `Contents/MacOS/` y los recursos en `Contents/Resources/`.
    // Los sidecars empaquetados van a `Resources/`, así que si
    // estamos dentro de un bundle, subimos un nivel y buscamos ahí.
    let base_dir = if exe_dir.ends_with("MacOS") {
        exe_dir
            .parent()
            .map(|p| p.join("Resources"))
            .unwrap_or_else(|| exe_dir.to_path_buf())
    } else {
        exe_dir.to_path_buf()
    };

    // En Windows los ejecutables terminan en .exe. El instalador de
    // Tauri copia el sidecar con extension, pero nuestro join() no la
    // agrega. `std::process::Command` no resuelve .exe implicitamente
    // en paths absolutos, asi que hay que hacerlo explicito.
    let bin_name = if cfg!(target_os = "windows") {
        format!("{PI_SESSIONS_BIN}.exe")
    } else {
        PI_SESSIONS_BIN.to_string()
    };

    let bin_path = base_dir.join(bin_name);
    if !bin_path.exists() {
        return Err(format!(
            "pi-sessions binary not found at {}",
            bin_path.display()
        ));
    }
    Ok(bin_path)
}

/// Ejecuta `pi-sessions <args>` y devuelve su stdout.
///
/// Usa `std::process::Command` directamente (no el shell plugin de
/// Tauri) para evitar el bug de truncamiento con outputs grandes
/// (tauri-apps/tauri#7684). El shell plugin pasa los eventos de
/// stdout por su event loop proxy interno, que pierde datos cuando
/// el volumen supera su capacidad (~72KB en la práctica).
/// `std::process::Command::output()` usa pipes del OS nativas con
/// buffering ilimitado, sin pasar por ningún proxy.
///
/// Si el exit code no es 0, devuelve `Err(stderr)`. Si el sub-proceso
/// excede el timeout, devuelve `Err("pi-sessions timeout")`.
async fn run_pi_sessions(args: Vec<String>, app: &AppHandle) -> Result<String, String> {
    let bin_path = resolve_sidecar_path(app)?;

    // `Command::output()` es bloqueante (espera a que el proceso
    // termine). Lo ejecutamos en un thread dedicado vía
    // `tokio::task::spawn_blocking` para no congelar el async runtime.
    let output_fut = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&bin_path);
        cmd.args(&args);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.output()
    });

    let output = match timeout(SUBPROCESS_TIMEOUT, output_fut).await {
        // timeout → Elapsed
        Err(_) => return Err("pi-sessions timeout".to_string()),
        // spawn_blocking panic/cancel → JoinError
        Ok(Err(e)) => return Err(format!("pi-sessions task error: {e}")),
        // Command::output() falló (io::Error)
        Ok(Ok(Err(e))) => return Err(format!("pi-sessions spawn error: {e}")),
        // Todo ok: tenemos el Output
        Ok(Ok(Ok(out))) => out,
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("pi-sessions exited with code {:?}", output.status.code())
        } else {
            stderr
        });
    }

    // from_utf8 (no lossy) porque el JSON debe ser UTF-8 válido.
    String::from_utf8(output.stdout)
        .map_err(|e| format!("pi-sessions output is not valid UTF-8: {e}"))
}

/// Parsea el JSON que `pi-sessions list` emite en stdout.
///
/// Extraída de `list_sessions` para poder testear el parseo sin
/// necesidad de un `AppHandle` de Tauri (que no existe en unit tests).
/// Los bugs de truncamiento y control chars que tuvimos se atrapan
/// acá: si el JSON está cortado o corrupto, serde_json reporta un
/// error descriptivo que llega al usuario.
fn parse_sessions_list(stdout: &str) -> Result<ListSessionsResult, String> {
    let parsed: ListResponse = serde_json::from_str(stdout)
        .map_err(|e| format!("failed to parse pi-sessions output: {e}"))?;
    Ok(ListSessionsResult {
        sessions: parsed.sessions,
        skipped: parsed.skipped,
    })
}

#[tauri::command]
pub async fn list_sessions(cwd: String, app: AppHandle) -> Result<ListSessionsResult, String> {
    let stdout = run_pi_sessions(vec!["list".into(), cwd], &app).await?;
    parse_sessions_list(&stdout)
}

#[tauri::command]
pub async fn delete_session(path: String, app: AppHandle) -> Result<(), String> {
    run_pi_sessions(vec!["delete".into(), path], &app).await?;
    Ok(())
}

#[tauri::command]
pub async fn rename_session(path: String, name: String, app: AppHandle) -> Result<(), String> {
    run_pi_sessions(vec!["rename".into(), path, name], &app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construye un JSON de una sesión con los campos mínimos.
    /// Los campos opcionales (name, parentSessionPath) se omiten
    /// para testear que serde los acepte como ausentes.
    ///
    /// Si `first_message` contiene un `\n` real (byte 0x0A de Rust),
    /// el JSON resultante tiene un control char dentro del string —
    /// justo lo que producía el bug #3090 de tauri-plugin-shell.
    fn session_json(first_message: &str) -> String {
        format!(
            r#"{{"sessions":[{{
              "path":"/tmp/s1.jsonl",
              "id":"abc12345",
              "cwd":"/tmp",
              "created":1700000000000,
              "modified":1700000001000,
              "messageCount":3,
              "firstMessage":"{}"
            }}]}}"#,
            first_message
        )
    }

    /// Construye un JSON con el campo `skipped` opcional.
    fn session_json_con_skipped(skipped_count: u64) -> String {
        format!(
            r#"{{"sessions":[],"skipped":{{"count":{}}}}}"#,
            skipped_count
        )
    }

    #[test]
    fn parse_json_valido_con_una_sesion() {
        let json = session_json("Hola pi");
        let result = parse_sessions_list(&json).unwrap();
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.sessions[0].id, "abc12345");
        assert_eq!(result.sessions[0].first_message, "Hola pi");
        assert_eq!(result.sessions[0].message_count, 3);
        assert_eq!(result.sessions[0].created, 1700000000000);
        assert_eq!(result.sessions[0].modified, 1700000001000);
    }

    #[test]
    fn parse_json_vacio_sin_sesiones() {
        let json = r#"{"sessions":[]}"#;
        let result = parse_sessions_list(json).unwrap();
        assert!(result.sessions.is_empty());
    }

    /// Reproduce el bug del truncamiento (#7684): el output se corta
    /// a los ~72KB porque el event loop proxy del shell plugin se
    /// satura. El JSON queda con un string sin cerrar → serde reporta EOF.
    #[test]
    fn parse_json_truncado_eof_da_error_descriptivo() {
        let json = session_json("mensaje largo");
        // Cortar a la mitad del JSON (simula truncamiento del pipe)
        let truncated = &json[..json.len() / 2];
        let err = parse_sessions_list(truncated).unwrap_err();
        assert!(
            err.contains("failed to parse pi-sessions output"),
            "el error debe mencionar pi-sessions: {err}"
        );
        assert!(
            err.contains("EOF") || err.contains("unexpected EOF"),
            "el error debe mencionar EOF: {err}"
        );
    }

    /// Reproduce el bug de output() que inserta \n entre chunks (#3090):
    /// un byte 0x0A suelto dentro de un string JSON es un control char
    /// que serde rechaza. JSON.stringify lo escaparía como \\n, pero
    /// output() insertaba \n raw, corrompiendo el string.
    ///
    /// `session_json` usa `format!` que inserta el `\n` de Rust tal
    /// cual en el template, produciendo el JSON con el control char.
    #[test]
    fn parse_json_con_control_char_da_error_descriptivo() {
        let json = session_json("texto\ncon newline literal");
        let err = parse_sessions_list(&json).unwrap_err();
        assert!(
            err.contains("control character"),
            "el error debe mencionar control character: {err}"
        );
    }

    /// Sesión con firstMessage >64KB (mayor que el pipe buffer del kernel).
    /// Este es el caso que disparaba el truncamiento del shell plugin.
    /// Con el fix (std::process::Command), el parser recibe el JSON
    /// completo sin importar el tamaño.
    #[test]
    fn parse_json_con_first_message_muy_largo() {
        let big_message = "x".repeat(80_000);
        let json = session_json(&big_message);
        let result = parse_sessions_list(&json).unwrap();
        assert_eq!(result.sessions.len(), 1);
        assert_eq!(result.sessions[0].first_message.len(), 80_000);
    }

    /// firstMessage con Unicode, emoji y caracteres especiales.
    /// Verifica que serde_json maneje multi-byte UTF-8 correctamente.
    #[test]
    fn parse_json_con_unicode_y_emoji() {
        let msg = "Hola π — 🎉 ñoño façade";
        let json = session_json(msg);
        let result = parse_sessions_list(&json).unwrap();
        assert_eq!(result.sessions[0].first_message, msg);
    }

    /// Campos opcionales (name, parentSessionPath) ausentes.
    /// serde con `Option<T>` debe aceptarlos como null o ausentes.
    #[test]
    fn parse_json_con_campos_opcionales_ausentes() {
        let json = session_json("test");
        let result = parse_sessions_list(&json).unwrap();
        assert!(result.sessions[0].name.is_none());
        assert!(result.sessions[0].parent_session_path.is_none());
    }

    /// Campos opcionales presentes.
    #[test]
    #[allow(clippy::useless_format)] // {{ y }} son escapes de format! para {} en JSON
    fn parse_json_con_campos_opcionales_presentes() {
        let json = format!(
            r#"{{"sessions":[{{
              "path":"/tmp/s.jsonl",
              "id":"xyz",
              "cwd":"/tmp",
              "name":"Mi sesión",
              "parentSessionPath":"/tmp/parent.jsonl",
              "created":1,
              "modified":2,
              "messageCount":5,
              "firstMessage":"hola"
            }}]}}"#
        );
        let result = parse_sessions_list(&json).unwrap();
        assert_eq!(result.sessions[0].name.as_deref(), Some("Mi sesión"));
        assert_eq!(
            result.sessions[0].parent_session_path.as_deref(),
            Some("/tmp/parent.jsonl")
        );
    }

    /// Múltiples sesiones en un solo JSON (el caso real del workspace
    /// problemático con 35 sesiones). Verifica que el parser maneje
    /// arrays grandes sin truncamiento.
    #[test]
    fn parse_json_con_multiples_sesiones() {
        let mut sessions_arr = Vec::new();
        for i in 0..35 {
            sessions_arr.push(format!(
                r#"{{"path":"/tmp/s{}.jsonl","id":"id{}","cwd":"/tmp","created":{},"modified":{},"messageCount":{},"firstMessage":"msg {}"}}"#,
                i, i, i, i, i, i
            ));
        }
        let json = format!(r#"{{"sessions":[{}]}}"#, sessions_arr.join(","));
        let result = parse_sessions_list(&json).unwrap();
        assert_eq!(result.sessions.len(), 35);
        assert_eq!(result.sessions[0].id, "id0");
        assert_eq!(result.sessions[34].id, "id34");
    }

    /// JSON con trailing newline (lo que `std::process::Command::output()`
    /// entrega, ya que `console.log` agrega el newline final).
    /// serde_json debe aceptar whitespace trailing.
    #[test]
    fn parse_json_con_trailing_newline() {
        let json = format!("{}\n", session_json("test"));
        let result = parse_sessions_list(&json).unwrap();
        assert_eq!(result.sessions.len(), 1);
    }

    /// JSON con skipped presente.
    #[test]
    fn parse_json_con_skipped_presente() {
        let json = session_json_con_skipped(3);
        let result = parse_sessions_list(&json).unwrap();
        assert!(result.sessions.is_empty());
        assert_eq!(result.skipped.unwrap().count, 3);
    }

    /// JSON sin skipped (el campo está ausente en el JSON).
    /// `ListResponse.skipped` usa `#[serde(default)]`, así que
    /// se parsea como `None`.
    #[test]
    fn parse_json_sin_skipped_es_none() {
        let json = session_json("test");
        let result = parse_sessions_list(&json).unwrap();
        assert!(result.skipped.is_none());
    }

    /// JSON completamente inválido (no es JSON).
    #[test]
    fn parse_json_invalido_da_error_descriptivo() {
        let err = parse_sessions_list("not json at all").unwrap_err();
        assert!(err.contains("failed to parse pi-sessions output"));
    }

    /// JSON con estructura wrong (falta el key "sessions").
    #[test]
    fn parse_json_sin_key_sessions_da_error() {
        let err = parse_sessions_list(r#"{"data":[]}"#).unwrap_err();
        assert!(err.contains("failed to parse"));
    }

    /// JSON con una sesión que tiene `firstMessage` null.
    /// pi-sessions siempre envía un string (usa `"(no messages)"` como
    /// fallback), pero si por algún motivo llega null, el parser debe
    /// fallar con un error claro en vez de panic.
    #[test]
    fn parse_json_con_first_message_null_da_error() {
        let json = r#"{"sessions":[{"path":"/x","id":"a","cwd":"/","created":1,"modified":2,"messageCount":0,"firstMessage":null}]}"#;
        let err = parse_sessions_list(json).unwrap_err();
        assert!(err.contains("failed to parse"));
    }
}
