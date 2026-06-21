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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Helper: crea un directorio temporal con archivos de prueba.
    fn setup_test_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        // Archivos
        fs::write(dir.path().join("test.txt"), "hello world").unwrap();
        fs::write(dir.path().join("test.md"), "# Markdown").unwrap();
        fs::write(dir.path().join("config.json"), "{\"key\": \"value\"}").unwrap();
        // Directorio
        fs::create_dir(dir.path().join("subdir")).unwrap();
        fs::write(dir.path().join("subdir/nested.txt"), "nested").unwrap();
        // Archivo oculto (debe ser filtrado)
        fs::write(dir.path().join(".hidden"), "hidden").unwrap();
        dir
    }

    #[test]
    fn list_files_retorna_archivos_y_directorios() {
        let dir = setup_test_dir();
        let result = list_files(dir.path().to_string_lossy().to_string()).unwrap();

        // Debe tener 3 archivos + 1 directorio (test.txt, test.md, config.json, subdir)
        assert_eq!(result.len(), 4);

        // Directorios primero
        assert!(result[0].is_dir);
        assert_eq!(result[0].name, "subdir");

        // Archivos ordenados alfabéticamente
        assert_eq!(result[1].name, "config.json");
        assert_eq!(result[2].name, "test.md");
        assert_eq!(result[3].name, "test.txt");
    }

    #[test]
    fn list_files_filtra_archivos_ocultos() {
        let dir = setup_test_dir();
        let result = list_files(dir.path().to_string_lossy().to_string()).unwrap();

        // .hidden no debe aparecer
        assert!(!result.iter().any(|f| f.name == ".hidden"));
    }

    #[test]
    fn list_files_filtra_directorios_excluidos() {
        let dir = setup_test_dir();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::create_dir(dir.path().join("target")).unwrap();

        let result = list_files(dir.path().to_string_lossy().to_string()).unwrap();

        assert!(!result.iter().any(|f| f.name == "node_modules"));
        assert!(!result.iter().any(|f| f.name == ".git"));
        assert!(!result.iter().any(|f| f.name == "target"));
    }

    #[test]
    fn list_files_retorna_paths_relativos() {
        let dir = setup_test_dir();
        let result = list_files(dir.path().to_string_lossy().to_string()).unwrap();

        // Los paths no deben empezar con / ni con el path completo
        for file in &result {
            assert!(!file.path.starts_with('/'));
            assert!(!file.path.contains(dir.path().to_string_lossy().as_ref()));
        }
    }

    #[test]
    fn list_files_retorna_error_para_directorio_inexistente() {
        let result = list_files("/no/existe/carpeta".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn read_file_retorna_contenido() {
        let dir = setup_test_dir();
        let path = dir.path().join("test.txt").to_string_lossy().to_string();
        let content = read_file(path).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn read_file_retorna_error_para_archivo_inexistente() {
        let result = read_file("/no/existe/archivo.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn read_file_retorna_error_para_directorio() {
        let dir = setup_test_dir();
        let result = read_file(dir.path().to_string_lossy().to_string());
        assert!(result.is_err());
    }

    #[test]
    fn write_file_crea_archivo() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nuevo.txt").to_string_lossy().to_string();

        write_file(path.clone(), "contenido nuevo".to_string()).unwrap();

        let content = fs::read_to_string(path).unwrap();
        assert_eq!(content, "contenido nuevo");
    }

    #[test]
    fn write_file_sobrescribe_archivo_existente() {
        let dir = setup_test_dir();
        let path = dir.path().join("test.txt").to_string_lossy().to_string();

        write_file(path.clone(), "nuevo contenido".to_string()).unwrap();

        let content = fs::read_to_string(path).unwrap();
        assert_eq!(content, "nuevo contenido");
    }

    #[test]
    fn write_file_crea_directorios_padre() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a/b/c/archivo.txt").to_string_lossy().to_string();

        write_file(path.clone(), "contenido".to_string()).unwrap();

        let content = fs::read_to_string(path).unwrap();
        assert_eq!(content, "contenido");
    }
}
