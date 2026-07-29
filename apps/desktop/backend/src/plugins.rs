//! plugins.rs — Sistema de plugins de xi.
//!
//! Descubre plugins en ~/.xi/plugins/ escaneando manifest.json.
//! Expone comandos Tauri para listar, cargar e instalar plugins.
//!
//! También maneja sidecars de plugins: spawn, stdin write, stdout forwarding.
//! El patrón es idéntico a pi (PiProcess): stdin/stdout JSONL.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Plugin manifest (manifest.json en la raíz del plugin).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    pub sidecar: String,
    pub entry: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub name: String,
    pub version: String,
    pub sidecar_path: String,
    pub entry_path: String,
    pub installed: bool,
}

/// Proceso sidecar de un plugin.
pub(crate) struct PluginProcess {
    /// stdin del sidecar — escribir comandos JSONL.
    pub(crate) stdin: Box<dyn Write + Send>,
    /// Child handle para kill + wait.
    pub(crate) child: Child,
}

/// Almacena los procesos sidecar activos por nombre de plugin.
pub(crate) struct PluginProcessMap(pub(crate) Mutex<HashMap<String, PluginProcess>>);

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
                    log::warn!("[plugins] {}: JSON inválido: {e}", manifest_path.display());
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

pub fn read_plugin_entry(plugin_name: &str, app: &AppHandle) -> Result<String, String> {
    let plugins = discover_plugins(app)?;
    let plugin = plugins
        .iter()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| format!("Plugin no encontrado: {plugin_name}"))?;
    fs::read_to_string(&plugin.entry_path)
        .map_err(|e| format!("No se pudo leer {}: {e}", plugin.entry_path))
}

// ─── Sidecar process management ───

/// Spawnea el sidecar de un plugin y empieza a forwardear su stdout.
pub fn spawn_plugin_pty(plugin_name: &str, app: &AppHandle) -> Result<(), String> {
    let plugins = discover_plugins(app)?;
    let plugin = plugins
        .iter()
        .find(|p| p.name == plugin_name)
        .ok_or_else(|| format!("Plugin no encontrado: {plugin_name}"))?;

    if !plugin.installed {
        return Err(format!("Plugin {plugin_name} no está instalado"));
    }

    let sidecar_path = &plugin.sidecar_path;

    // Kill existing process if any
    kill_plugin_pty_internal(plugin_name, app);

    let mut child = Command::new(sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo spawnear {plugin_name}: {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "No se pudo tomar stdin del sidecar".to_string())?;

    // Thread: lee stdout del sidecar → emite eventos Tauri
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo tomar stdout del sidecar".to_string())?;

    let event_name = format!("plugin:{plugin_name}:data");
    let exit_name = format!("plugin:{plugin_name}:exit");
    let handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    let _ = handle.emit(&event_name, &l);
                }
                Err(_) => break,
            }
        }
        let _ = handle.emit(&exit_name, "");
    });

    // Thread: consume stderr (loggear a consola)
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "No se pudo tomar stderr del sidecar".to_string())?;

    let name = plugin_name.to_string();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) => log::warn!("[plugin:{name}] stderr: {l}"),
                Err(_) => break,
            }
        }
    });

    // Guardar el proceso
    let state = app.state::<PluginProcessMap>();
    let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    map.insert(
        plugin_name.to_string(),
        PluginProcess {
            stdin: Box::new(stdin),
            child,
        },
    );

    log::info!("[plugins] {plugin_name} spawneado");
    Ok(())
}

/// Escribe datos al stdin del sidecar de un plugin.
pub fn write_plugin_stdin(plugin_name: &str, data: &str, app: &AppHandle) -> Result<(), String> {
    let state = app.state::<PluginProcessMap>();
    let mut map = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    let proc = map
        .get_mut(plugin_name)
        .ok_or_else(|| format!("Plugin {plugin_name} no está corriendo"))?;
    proc.stdin
        .write_all(data.as_bytes())
        .map_err(|e| format!("Error escribiendo a {plugin_name}: {e}"))?;
    proc.stdin
        .flush()
        .map_err(|e| format!("Error flush {plugin_name}: {e}"))?;
    Ok(())
}

/// Mata el sidecar de un plugin.
fn kill_plugin_pty_internal(plugin_name: &str, app: &AppHandle) {
    let state = app.state::<PluginProcessMap>();
    let mut map = match state.0.lock() {
        Ok(m) => m,
        Err(_) => return,
    };
    if let Some(mut proc) = map.remove(plugin_name) {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
        log::info!("[plugins] {plugin_name} terminado");
    }
}

pub fn create_plugin_process_map() -> PluginProcessMap {
    PluginProcessMap(Mutex::new(HashMap::new()))
}
