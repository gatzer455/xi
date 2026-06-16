use super::pi_process::PiProcessState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize)]
pub struct PiStatus {
    pub running: bool,
    pub cwd: Option<String>,
}

/// Obtener el estado del proceso pi
#[tauri::command]
pub fn get_pi_status(state: State<'_, PiProcessState>) -> PiStatus {
    let process = state.lock().unwrap();
    PiStatus {
        running: process.is_running(),
        cwd: process.cwd().map(|s| s.to_string()),
    }
}

/// Iniciar el proceso pi en un directorio específico.
///
/// Si `session_path` viene, pi carga esa sesión al arrancar (via
/// `--session <path>`). El frontend usa esto para switch entre
/// sesiones: matar la activa + spawnear con el path nuevo.
#[tauri::command]
pub fn start_pi(
    cwd: String,
    state: State<'_, PiProcessState>,
    app: tauri::AppHandle,
    session_path: Option<String>,
) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    process.spawn(cwd, session_path, app)
}

/// Detener el proceso pi
#[tauri::command]
pub fn stop_pi(state: State<'_, PiProcessState>) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    process.kill();
    Ok(())
}

/// Enviar un prompt a pi
#[tauri::command]
pub fn send_prompt(message: String, state: State<'_, PiProcessState>) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    let cmd = serde_json::json!({
        "type": "prompt",
        "message": message
    });
    process.send(&cmd.to_string())
}

/// Enviar un comando JSON raw a pi
#[tauri::command]
pub fn send_pi_command(json: String, state: State<'_, PiProcessState>) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    process.send(&json)
}

/// Abortar la operación actual de pi
#[tauri::command]
pub fn abort_pi(state: State<'_, PiProcessState>) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    let cmd = serde_json::json!({"type": "abort"});
    process.send(&cmd.to_string())
}

/// Obtener el estado de pi via RPC
#[tauri::command]
pub fn get_pi_state(state: State<'_, PiProcessState>) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    let cmd = serde_json::json!({"type": "get_state"});
    process.send(&cmd.to_string())
}

/// Obtener los mensajes de pi via RPC
#[tauri::command]
pub fn get_pi_messages(state: State<'_, PiProcessState>) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    let cmd = serde_json::json!({"type": "get_messages"});
    process.send(&cmd.to_string())
}

/// Crear una nueva sesión
#[tauri::command]
pub fn new_pi_session(state: State<'_, PiProcessState>) -> Result<(), String> {
    let mut process = state.lock().unwrap();
    let cmd = serde_json::json!({"type": "new_session"});
    process.send(&cmd.to_string())
}
