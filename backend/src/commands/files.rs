//! files.rs — Comandos de filesystem para el explorador de archivos.
//!
//! Permite listar, leer y escribir archivos del workingDir.
//! Filtra archivos ocultos y directorios no deseados (.git, node_modules, etc.).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Entrada de archivo para el explorador.
#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,    // relativo al workingDir
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,   // timestamp en ms
}

/// Directorios y archivos que se ocultan en el explorador.
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

/// Extensiones de archivos binarios que no se pueden mostrar.
const BINARY_EXTENSIONS: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".mp3", ".mp4", ".wav", ".avi", ".mov",
    ".zip", ".tar", ".gz", ".7z", ".rar",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".so", ".dll", ".dylib",
];

/// Listar archivos de un directorio.
///
/// Retorna la lista de archivos y subdirectorios, excluyendo
/// los directorios de la lista EXCLUDED.
#[tauri::command]
pub fn list_files(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);

    if !dir.is_dir() {
        return Err(format!("No es un directorio: {}", path));
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("Error leyendo directorio: {}", e))?;

    let mut result: Vec<FileEntry> = Vec::new();

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy().to_string();

        // Saltar archivos/directorios excluidos
        if EXCLUDED.contains(&name_str.as_str()) {
            continue;
        }

        // Saltar archivos que empiezan con . (ocultos)
        if name_str.starts_with('.') {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();
        let size = metadata.len();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // Para archivos,获取 la extensión
        let ext = if is_dir {
            String::new()
        } else {
            Path::new(&name_str)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        };

        // Saltar archivos binarios
        if !is_dir && BINARY_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        // Construir path relativo al directorio actual
        let rel_path = entry.path().strip_prefix(dir).unwrap_or(&entry.path()).to_string_lossy().to_string();

        result.push(FileEntry {
            name: name_str,
            path: rel_path,
            is_dir,
            size,
            modified,
        });
    }

    // Ordenar: directorios primero, luego por nombre
    result.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            return b.is_dir.cmp(&a.is_dir);
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    Ok(result)
}

/// Leer contenido de un archivo.
///
/// Retorna el contenido como string. Si el archivo es binario
/// o muy grande, retorna error.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let file = Path::new(&path);

    if !file.is_file() {
        return Err(format!("No es un archivo: {}", path));
    }

    // Verificar tamaño (máximo 1MB)
    let metadata = fs::metadata(file).map_err(|e| format!("Error leyendo metadata: {}", e))?;
    if metadata.len() > 1_048_576 {
        return Err("Archivo demasiado grande (máximo 1MB)".to_string());
    }

    // Verificar que no sea binario
    let ext = file.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    if BINARY_EXTENSIONS.contains(&format!(".{}", ext).as_str()) {
        return Err("Archivo binario no soportado".to_string());
    }

    fs::read_to_string(file).map_err(|e| format!("Error leyendo archivo: {}", e))
}

/// Escribir contenido a un archivo.
///
/// Sobrescribe el contenido completo del archivo.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let file = Path::new(&path);

    // Crear directorio padre si no existe
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Error creando directorio: {}", e))?;
    }

    fs::write(file, content).map_err(|e| format!("Error escribiendo archivo: {}", e))
}
