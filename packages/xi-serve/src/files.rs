//! files.rs — Explorador read-only, confinado a la whitelist de proyectos.
//!
//! Puerto de `apps/desktop/backend/src/commands/files.rs` sin `write_file`
//! (fuera de alcance para el remoto — ver docs/mobile/05-conectividad-seguridad.md)
//! y confinado contra `roots` (la whitelist), no contra un único cwd.

use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

const EXCLUDED: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".next",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
];

const BINARY_EXTENSIONS: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".mp3", ".mp4", ".wav", ".avi",
    ".mov", ".zip", ".tar", ".gz", ".7z", ".rar", ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".woff", ".woff2", ".ttf", ".otf", ".eot", ".so", ".dll", ".dylib",
];

pub fn list_files(dir: &Path) -> Result<Vec<FileEntry>, String> {
    if !dir.is_dir() {
        return Err(format!("No es un directorio: {}", dir.display()));
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("Error leyendo directorio: {e}"))?;
    let mut result: Vec<FileEntry> = Vec::new();

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy().to_string();

        if EXCLUDED.contains(&name_str.as_str()) || name_str.starts_with('.') {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();
        let ext = if is_dir {
            String::new()
        } else {
            Path::new(&name_str)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        };
        if !is_dir && BINARY_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let rel_path = entry
            .path()
            .strip_prefix(dir)
            .unwrap_or(&entry.path())
            .to_string_lossy()
            .to_string();

        result.push(FileEntry {
            name: name_str,
            path: rel_path,
            is_dir,
            size: metadata.len(),
            modified,
        });
    }

    result.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            return b.is_dir.cmp(&a.is_dir);
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(result)
}

pub fn read_file(file: &Path) -> Result<String, String> {
    if !file.is_file() {
        return Err(format!("No es un archivo: {}", file.display()));
    }
    let metadata = fs::metadata(file).map_err(|e| format!("Error leyendo metadata: {e}"))?;
    if metadata.len() > 1_048_576 {
        return Err("Archivo demasiado grande (máximo 1MB)".to_string());
    }
    let ext = file.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    if BINARY_EXTENSIONS.contains(&format!(".{ext}").as_str()) {
        return Err("Archivo binario no soportado".to_string());
    }
    fs::read_to_string(file).map_err(|e| format!("Error leyendo archivo: {e}"))
}
