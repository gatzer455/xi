/// App mobile de xi — conecta via WebSocket a xi-serve.
///
/// La app no tiene comandos IPC propios: todo pasa por WS. El frontend
/// vive en `apps/mobile/frontend` (propio, sobre `packages/xi-ui`) y
/// pide URL + token en runtime (pantalla de conexión, persistidos en
/// localStorage) — no hay nada horneado en build time. Cambiar de
/// servidor no requiere recompilar el APK (ver docs/mobile/04).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error al iniciar xi mobile");
}
