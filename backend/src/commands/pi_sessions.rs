use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tokio::time::timeout;

/// Nombre del sidecar que invoca este módulo. Debe matchear
/// `externalBin` en `tauri.conf.json` y el allowlist en
/// `capabilities/default.json`.
const PI_SESSIONS_BIN: &str = "pi-sessions";

/// Timeout para cada sub-proceso de `pi-sessions`. La operación `list`
/// puede tocar cientos de archivos; las otras dos son instantáneas.
/// 5s es generoso pero evita que un cuelgue del sidecar congele la UI.
const SUBPROCESS_TIMEOUT: Duration = Duration::from_secs(5);

/// Sesión de pi serializada al frontend.
///
/// Refleja la `interface SessionInfo` de TypeScript en
/// `frontend/src/lib/pi/types.ts`. Si cambian los campos en un lado,
/// hay que actualizarlos en el otro — el contrato se valida en el
/// `serde_json::from_str` de `list_sessions`.
#[derive(Serialize, Deserialize, Clone)]
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
/// Se mantiene privada porque solo la usa `list_sessions` para extraer
/// el array de `sessions`.
#[derive(Deserialize)]
struct ListResponse {
    sessions: Vec<SessionInfo>,
}

/// Ejecuta `pi-sessions <args>` y devuelve su stdout.
///
/// `cwd` se pasa como `current_dir` del sub-proceso: pi-sessions usa
/// el cwd de su propio proceso para resolver el `.pi/settings.json` del
/// proyecto, que a su vez determina el `sessionDir` real (puede ser
/// `<cwd>/.pi/sessions/` o `~/.pi/agent/sessions/`). Si no se setea
/// el cwd, lee el settings desde el directorio del binario y siempre
/// cae en el default global — es el bug que rompió el listing original.
///
/// Si el exit code no es 0, devuelve `Err(stderr)`. Si el sub-proceso
/// excede el timeout, devuelve `Err("pi-sessions timeout")`.
async fn run_pi_sessions(args: &[&str], app: &AppHandle) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar(PI_SESSIONS_BIN)
        .map_err(|e| format!("failed to create pi-sessions sidecar: {e}"))?;

    let output_fut = sidecar.args(args).output();

    let output = match timeout(SUBPROCESS_TIMEOUT, output_fut).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(format!("pi-sessions spawn error: {e}")),
        Err(_) => return Err("pi-sessions timeout".to_string()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("pi-sessions exited with code {:?}", output.status.code())
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn list_sessions(cwd: String, app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let stdout = run_pi_sessions(&["list", &cwd], &app).await?;
    let parsed: ListResponse = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse pi-sessions output: {e}"))?;
    Ok(parsed.sessions)
}

#[tauri::command]
pub async fn delete_session(path: String, app: AppHandle) -> Result<(), String> {
    run_pi_sessions(&["delete", &path], &app).await?;
    Ok(())
}

#[tauri::command]
pub async fn rename_session(path: String, name: String, app: AppHandle) -> Result<(), String> {
    run_pi_sessions(&["rename", &path, &name], &app).await?;
    Ok(())
}
