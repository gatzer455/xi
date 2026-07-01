// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::pi_process::{create_pending_requests, create_pi_state};
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("xi.log".into()),
                    }),
                ])
                .build(),
        )
        .setup(|app| {
            // Inicializar el estado del proceso pi y pending requests
            app.manage(create_pi_state());
            app.manage(create_pending_requests());
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
            commands::pi_version::get_pi_version,
            commands::pi_version::get_pi_upstream_version,
            commands::auth_config::get_auth_status,
            commands::auth_config::set_api_key,
            commands::auth_config::test_api_key,
            commands::auth_config::get_api_key,
            commands::auth_config::delete_api_key,
            commands::recents::get_recents,
            commands::recents::add_recent,
            commands::extension_ui::respond_extension_ui,
            commands::files::list_files,
            commands::files::read_file,
            commands::files::write_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
