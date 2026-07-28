//! plugins.rs — Sistema de plugins de xi.
//!
//! Descubre plugins en ~/.xi/plugins/ escaneando manifest.json.
//! Expone comandos Tauri para listar, cargar e instalar plugins.
//!
//! Un plugin de xi agrega un tipo de panel nuevo (ej. terminal).
//! No es una extensión de pi — no agrega herramientas al agente.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;
use tauri::Manager;

/// Plugin manifest (manifest.json en la raíz del plugin).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    /// Nombre del binario sidecar, relativo a la raíz del plugin.
    pub sidecar: String,
    /// Archivo JS de entrada del frontend, relativo a la raíz del plugin.
    pub entry: String,
}

/// Info de un plugin descubierto, con paths absolutos resueltos.
#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub sidecar_path: String,
    pub entry_path: String,
    pub installed: bool,
}

/// Escanea ~/.xi/plugins/ y devuelve los plugins con manifest.json válido.
pub fn discover_plugins(app: &AppHandle) -> Result<Vec<PluginInfo>, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("No se pudo resolver home dir: {e}"))?;
    let plugins_dir = home.join(".xi").join("plugins");

    if !plugins_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&plugins_dir)
        .map_err(|e| format!("No se pudo leer {}: {e}", plugins_dir.display()))?;

    let mut plugins = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest: PluginManifest = match fs::read_to_string(&manifest_path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(m) => m,
                Err(e) => {
                    log::warn!(
                        "[plugins] {}: JSON inválido: {e}",
                        manifest_path.display()
                    );
                    continue;
                }
            },
            Err(e) => {
                log::warn!("[plugins] No se pudo leer {}: {e}", manifest_path.display());
                continue;
            }
        };

        let sidecar_path = path.join(&manifest.sidecar);
        let entry_path = path.join(&manifest.entry);

        let installed = sidecar_path.exists() && entry_path.exists();

        plugins.push(PluginInfo {
            name: manifest.name,
            version: manifest.version,
            sidecar_path: sidecar_path.to_string_lossy().into(),
            entry_path: entry_path.to_string_lossy().into(),
            installed,
        });
    }

    log::info!("[plugins] {} plugin(s) descubierto(s)", plugins.len());
    Ok(plugins)
}

/// Lee el contenido del archivo JS de entrada de un plugin.
pub fn read_plugin_entry(plugin_name: &str, app: &AppHandle) -> Result<String, String> {
    let plugins = discover_plugins(app)?;

    let plugin = plugins
        .iter()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| format!("Plugin no encontrado: {plugin_name}"))?;

    fs::read_to_string(&plugin.entry_path)
        .map_err(|e| format!("No se pudo leer {}: {e}", plugin.entry_path))
}
