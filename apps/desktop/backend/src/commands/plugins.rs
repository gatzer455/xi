//! commands/plugins.rs — Comandos Tauri para el sistema de plugins.

use crate::plugins;
use tauri::AppHandle;

/// Lista los plugins descubiertos en ~/.xi/plugins/.
#[tauri::command]
pub fn get_plugins(app: AppHandle) -> Result<Vec<plugins::PluginInfo>, String> {
    plugins::discover_plugins(&app)
}

/// Lee el archivo JS de entrada de un plugin.
#[tauri::command]
pub fn read_plugin_entry(plugin_name: String, app: AppHandle) -> Result<String, String> {
    plugins::read_plugin_entry(&plugin_name, &app)
}

/// Spawnea el sidecar de un plugin.
#[tauri::command]
pub fn spawn_plugin_pty(plugin_name: String, app: AppHandle) -> Result<(), String> {
    plugins::spawn_plugin_pty(&plugin_name, &app)
}

/// Escribe datos al stdin del sidecar.
#[tauri::command]
pub fn write_plugin_stdin(plugin_name: String, data: String, app: AppHandle) -> Result<(), String> {
    plugins::write_plugin_stdin(&plugin_name, &data, &app)
}
