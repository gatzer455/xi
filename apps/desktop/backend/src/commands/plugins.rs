//! commands/plugins.rs — Comandos Tauri para el sistema de plugins.

use crate::plugins;
use tauri::AppHandle;

/// Lista los plugins descubiertos en ~/.xi/plugins/.
#[tauri::command]
pub fn get_plugins(app: AppHandle) -> Result<Vec<plugins::PluginInfo>, String> {
    plugins::discover_plugins(&app)
}

/// Lee el archivo JS de entrada de un plugin.
/// El frontend lo convierte a Blob URL y hace import() dinámico.
#[tauri::command]
pub fn read_plugin_entry(plugin_name: String, app: AppHandle) -> Result<String, String> {
    plugins::read_plugin_entry(&plugin_name, &app)
}
