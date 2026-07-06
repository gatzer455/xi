use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use super::pi_process::{PendingRequests, PiProcessState};

// ─── Types ────────────────────────────────────────────────────────────────────

/// Request interactivo de una extensión de pi.
///
/// pi emite esto por stdout cuando una extensión llama
/// `ctx.ui.select()`, `ctx.ui.confirm()`, etc. El campo `id`
/// es un UUID que identifica la request y se usa para correlacionar
/// la respuesta.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ExtensionUIRequest {
    #[serde(rename = "type")]
    pub request_type: String,
    pub id: String,
    pub method: String,
    #[serde(flatten)]
    pub payload: Value,
}

// ─── Command ──────────────────────────────────────────────────────────────────

/// Responder a un `extension_ui_request` pendiente.
///
/// El frontend llama a este command cuando el usuario responde
/// al dialog. El command resuelve el `oneshot::Sender`
/// correspondiente, lo que desbloquea el task que está esperando
/// y escribe la respuesta a pi via stdin.
#[tauri::command]
pub fn respond_extension_ui(
    id: String,
    response: Value,
    pending: State<'_, PendingRequests>,
    _process: State<'_, PiProcessState>,
) -> Result<(), String> {
    let sender = pending
        .lock()
        .unwrap()
        .remove(&id)
        .ok_or_else(|| format!("No pending request for id={id}"))?;

    sender
        .send(response)
        .map_err(|e| format!("Failed to send response: {e}"))
}
