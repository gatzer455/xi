// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::pi_process::create_pi_state;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Inicializar el estado del proceso pi
            app.manage(create_pi_state());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pi_rpc::get_pi_status,
            commands::pi_rpc::start_pi,
            commands::pi_rpc::stop_pi,
            commands::pi_rpc::send_prompt,
            commands::pi_rpc::send_pi_command,
            commands::pi_rpc::abort_pi,
            commands::pi_rpc::get_pi_state,
            commands::pi_rpc::get_pi_messages,
            commands::pi_rpc::new_pi_session,
            commands::pi_sessions::list_sessions,
            commands::pi_sessions::delete_session,
            commands::pi_sessions::rename_session,
            commands::recents::get_recents,
            commands::recents::add_recent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
