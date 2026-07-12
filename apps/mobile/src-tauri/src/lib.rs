use tauri::Manager;

/// App mobile de xi — conecta via WebSocket a xi-serve.
///
/// La app no tiene comandos IPC propios: todo pasa por WS.
/// El frontend se conecta a xi-serve via WsEventBus.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let url = std::env::var("XI_SERVE_URL").unwrap_or_else(|_| "ws://127.0.0.1:9876/ws".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();
            window.eval(&format!("window.__XI_SERVE_URL__ = '{url}';"))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar xi mobile");
}
