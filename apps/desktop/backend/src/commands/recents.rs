//! recents.rs — Proyectos recientes persistidos en app_config_dir/recents.json.
//!
//! El archivo es JSON plano, versionado, con cap de 10 items. Se usa
//! para popular la pantalla de bienvenida (`#/welcome`) con los
//! proyectos que el usuario abrió antes.
//!
//! Decisiones:
//! - 0 deps nuevas. Usa `tauri::Manager` (ya en scope) y `serde_json` (ya).
//! - Atomic write via tmp+rename. El rename es atómico dentro del mismo
//!   filesystem (POSIX). Si el proceso muere mid-write, el archivo
//!   original queda intacto o se reemplaza atómicamente, nunca corrupto.
//! - `path` se canoniza con `std::fs::canonicalize` para resolver
//!   symlinks y paths relativos antes de almacenar. Si el path no
//!   existe, `canonicalize` falla y propagamos el error al frontend.
//! - Si el JSON está corrupto, retornamos `[]` (no recuperamos). Los
//!   recientes se vuelven a agregar al abrir proyectos.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Cap máximo de proyectos recientes. Lo suficiente para una grilla de
/// 3 columnas en desktop. Más de 10 y la welcome se vuelve ruidosa.
const MAX_RECENTS: usize = 10;

/// Versión del schema del archivo. Si cambia el formato, leemos
/// `version`, migramos, escribimos con la versión nueva.
const RECENTS_VERSION: u32 = 1;

/// Un proyecto reciente. Se serializa con `#[serde(rename_all = "camelCase")]`
/// para que el frontend TS reciba `lastOpened` (no `last_opened`).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub path: String,
    pub last_opened: u64,
    pub name: String,
}

/// Forma completa del archivo `recents.json`.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct RecentsFile {
    version: u32,
    recents: Vec<Recent>,
}

impl RecentsFile {
    fn empty() -> Self {
        Self {
            version: RECENTS_VERSION,
            recents: Vec::new(),
        }
    }
}

/// Resuelve la ruta del archivo `recents.json` y garantiza que el
/// directorio padre existe. Si `app_config_dir()` falla (caso extremo),
/// propagamos el error.
fn recents_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app_config_dir: {e}"))?;

    fs::create_dir_all(&dir).map_err(|e| format!("failed to create {dir:?}: {e}"))?;

    Ok(dir.join("recents.json"))
}

/// Lee el archivo. Si no existe, está corrupto, o está vacío, retorna
/// un `RecentsFile` vacío. Nunca falla al frontend — los recientes
/// corruptos se pierden pero la app sigue funcionando.
fn read_recents_file(path: &Path) -> RecentsFile {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return RecentsFile::empty(),
    };

    if raw.trim().is_empty() {
        return RecentsFile::empty();
    }

    match serde_json::from_str::<RecentsFile>(&raw) {
        Ok(file) => file,
        Err(e) => {
            eprintln!("recents.json corrupted: {e}; using empty list");
            RecentsFile::empty()
        }
    }
}

/// Escribe atómicamente: primero a un archivo `.tmp`, luego
/// `fs::rename` lo promueve. Si el rename falla, el archivo original
/// queda intacto. El `.tmp` queda en disco pero el siguiente write
/// lo sobreescribe.
fn write_recents_file(path: &Path, file: &RecentsFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file)
        .map_err(|e| format!("failed to serialize recents: {e}"))?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("failed to write {tmp:?}: {e}"))?;

    fs::rename(&tmp, path).map_err(|e| format!("failed to rename {tmp:?} → {path:?}: {e}"))?;

    Ok(())
}

/// Unix epoch en milisegundos. El reloj de la system clock puede ir
/// atrás (NTP adjust), pero para el caso de uso de "ordenar por
/// reciente" eso no importa — un timestamp que salta para atrás
/// sigue siendo comparable.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn get_recents(app: tauri::AppHandle) -> Result<Vec<Recent>, String> {
    let path = recents_path(&app)?;
    let file = read_recents_file(&path);
    Ok(file.recents)
}

#[tauri::command]
pub async fn add_recent(path: String, app: tauri::AppHandle) -> Result<(), String> {
    let abs = fs::canonicalize(&path).map_err(|e| format!("invalid path {path:?}: {e}"))?;

    let path_str = abs.to_string_lossy().to_string();
    let name = abs
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unnamed")
        .to_string();

    let recents_path = recents_path(&app)?;
    let mut file = read_recents_file(&recents_path);

    // Dedup: si el path ya está, lo removemos para re-insertarlo al tope.
    file.recents.retain(|r| r.path != path_str);

    file.recents.insert(
        0,
        Recent {
            path: path_str,
            last_opened: now_ms(),
            name,
        },
    );

    file.recents.truncate(MAX_RECENTS);

    write_recents_file(&recents_path, &file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_file_has_correct_version() {
        let f = RecentsFile::empty();
        assert_eq!(f.version, RECENTS_VERSION);
        assert!(f.recents.is_empty());
    }

    #[test]
    fn truncate_caps_to_max() {
        let mut f = RecentsFile::empty();
        for i in 0..15 {
            f.recents.insert(
                0,
                Recent {
                    path: format!("/p/{i}"),
                    last_opened: i as u64,
                    name: format!("p{i}"),
                },
            );
            f.recents.truncate(MAX_RECENTS);
        }
        assert_eq!(f.recents.len(), MAX_RECENTS);
        // El más reciente (i=14) debe estar al tope
        assert_eq!(f.recents[0].path, "/p/14");
    }

    #[test]
    fn dedup_moves_to_top() {
        let mut f = RecentsFile::empty();
        f.recents.push(Recent {
            path: "/a".into(),
            last_opened: 1,
            name: "a".into(),
        });
        f.recents.push(Recent {
            path: "/b".into(),
            last_opened: 2,
            name: "b".into(),
        });
        f.recents.push(Recent {
            path: "/c".into(),
            last_opened: 3,
            name: "c".into(),
        });

        // Simular el flujo de add_recent con /b
        f.recents.retain(|r| r.path != "/b");
        f.recents.insert(
            0,
            Recent {
                path: "/b".into(),
                last_opened: 99,
                name: "b".into(),
            },
        );
        f.recents.truncate(MAX_RECENTS);

        assert_eq!(f.recents.len(), 3);
        assert_eq!(f.recents[0].path, "/b");
        assert_eq!(f.recents[0].last_opened, 99);
    }
}
