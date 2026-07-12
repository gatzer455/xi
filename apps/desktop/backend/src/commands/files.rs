//! files.rs — Comandos de filesystem para el explorador de archivos.
//!
//! Permite listar, leer y escribir archivos del workingDir.
//! Filtra archivos ocultos y directorios no deseados (.git, node_modules, etc.).

use super::pi_process::PiProcessState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

/// Entrada de archivo para el explorador.
#[derive(Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String, // relativo al workingDir
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64, // timestamp en ms
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
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".mp3", ".mp4", ".wav", ".avi",
    ".mov", ".zip", ".tar", ".gz", ".7z", ".rar", ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".woff", ".woff2", ".ttf", ".otf", ".eot", ".so", ".dll", ".dylib",
];

/// Valida que la ruta esté dentro del directorio raíz permitido.
pub fn confine_path(path: &str, root: &Path) -> Result<PathBuf, String> {
    let requested = Path::new(path).canonicalize().map_err(|_| "Ruta inválida o no existe".to_string())?;
    if !requested.starts_with(root) {
        return Err("Ruta fuera del directorio permitido".into());
    }
    Ok(requested)
}

/// Extrae el working directory de pi del estado Tauri.
pub fn get_cwd(state: &PiProcessState) -> Result<PathBuf, String> {
    let process = state.lock().unwrap();
    let cwd = process.cwd().ok_or_else(|| "No hay directorio de trabajo".to_string())?;
    Path::new(cwd).canonicalize().map_err(|e| format!("Error resolviendo directorio de trabajo: {e}"))
}

/// Integrado: get_cwd + confine_path.
pub fn confine(path: &str, state: &PiProcessState) -> Result<PathBuf, String> {
    let root = get_cwd(state)?;
    confine_path(path, &root)
}

// ── list_files ─────────────────────────────────────────────────

/// Lógica interna, sin confinamiento (para tests).
pub fn list_files_inner(dir: &Path) -> Result<Vec<FileEntry>, String> {
    if !dir.is_dir() {
        return Err(format!("No es un directorio: {}", dir.display()));
    }

    let entries = fs::read_dir(dir).map_err(|e| format!("Error leyendo directorio: {e}"))?;
    let mut result: Vec<FileEntry> = Vec::new();

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy().to_string();

        if EXCLUDED.contains(&name_str.as_str()) { continue; }
        if name_str.starts_with('.') { continue; }

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

        let ext = if is_dir {
            String::new()
        } else {
            Path::new(&name_str)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        };

        if !is_dir && BINARY_EXTENSIONS.contains(&ext.as_str()) { continue; }

        let rel_path = entry
            .path()
            .strip_prefix(dir)
            .unwrap_or(&entry.path())
            .to_string_lossy()
            .to_string();

        result.push(FileEntry { name: name_str, path: rel_path, is_dir, size, modified });
    }

    result.sort_by(|a, b| {
        if a.is_dir != b.is_dir { return b.is_dir.cmp(&a.is_dir); }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(result)
}

#[tauri::command]
pub fn list_files(path: String, state: State<'_, PiProcessState>) -> Result<Vec<FileEntry>, String> {
    let dir = confine(&path, &state)?;
    list_files_inner(&dir)
}

// ── read_file ──────────────────────────────────────────────────

/// Lógica interna, sin confinamiento (para tests).
pub fn read_file_inner(file: &Path) -> Result<String, String> {
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

#[tauri::command]
pub fn read_file(path: String, state: State<'_, PiProcessState>) -> Result<String, String> {
    let file = confine(&path, &state)?;
    read_file_inner(&file)
}

// ── write_file ─────────────────────────────────────────────────

/// Lógica interna, sin confinamiento (para tests).
pub fn write_file_inner(file: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Error creando directorio: {e}"))?;
    }
    fs::write(file, content).map_err(|e| format!("Error escribiendo archivo: {e}"))
}

#[tauri::command]
pub fn write_file(path: String, content: String, state: State<'_, PiProcessState>) -> Result<(), String> {
    let file = confine(&path, &state)?;
    write_file_inner(&file, &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_dir() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("test.txt"), "hello world").unwrap();
        fs::write(dir.path().join("test.md"), "# Markdown").unwrap();
        fs::write(dir.path().join("config.json"), "{\"key\": \"value\"}").unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();
        fs::write(dir.path().join("subdir/nested.txt"), "nested").unwrap();
        fs::write(dir.path().join(".hidden"), "hidden").unwrap();
        dir
    }

    #[test]
    fn list_files_retorna_archivos_y_directorios() {
        let dir = setup_test_dir();
        let result = list_files_inner(dir.path()).unwrap();
        assert_eq!(result.len(), 4);
        assert!(result[0].is_dir);
        assert_eq!(result[0].name, "subdir");
        assert_eq!(result[1].name, "config.json");
        assert_eq!(result[2].name, "test.md");
        assert_eq!(result[3].name, "test.txt");
    }

    #[test]
    fn list_files_filtra_ocultos() {
        let dir = setup_test_dir();
        let result = list_files_inner(dir.path()).unwrap();
        assert!(!result.iter().any(|f| f.name == ".hidden"));
    }

    #[test]
    fn list_files_filtra_excluidos() {
        let dir = setup_test_dir();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::create_dir(dir.path().join("target")).unwrap();
        let result = list_files_inner(dir.path()).unwrap();
        assert!(!result.iter().any(|f| f.name == "node_modules"));
        assert!(!result.iter().any(|f| f.name == ".git"));
        assert!(!result.iter().any(|f| f.name == "target"));
    }

    #[test]
    fn list_files_retorna_paths_relativos() {
        let dir = setup_test_dir();
        let result = list_files_inner(dir.path()).unwrap();
        for file in &result {
            assert!(!file.path.starts_with('/'));
            assert!(!file.path.contains(dir.path().to_string_lossy().as_ref()));
        }
    }

    #[test]
    fn list_files_error_si_no_existe() {
        let dir = TempDir::new().unwrap();
        let result = list_files_inner(&dir.path().join("nope"));
        assert!(result.is_err());
    }

    #[test]
    fn read_file_inner_retorna_contenido() {
        let dir = setup_test_dir();
        let content = read_file_inner(&dir.path().join("test.txt")).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn read_file_inner_error_si_no_existe() {
        let result = read_file_inner(Path::new("/no/existe/archivo.txt"));
        assert!(result.is_err());
    }

    #[test]
    fn read_file_inner_error_si_es_directorio() {
        let dir = setup_test_dir();
        let result = read_file_inner(dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn write_file_inner_crea_archivo() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nuevo.txt");
        write_file_inner(&path, "contenido nuevo").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "contenido nuevo");
    }

    #[test]
    fn write_file_inner_sobrescribe() {
        let dir = setup_test_dir();
        let path = dir.path().join("test.txt");
        write_file_inner(&path, "nuevo contenido").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "nuevo contenido");
    }

    #[test]
    fn write_file_inner_crea_dirs_padre() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a/b/c/archivo.txt");
        write_file_inner(&path, "contenido").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "contenido");
    }

    #[test]
    fn confine_path_acepta_ruta_dentro_del_root() {
        let dir = setup_test_dir();
        let path = dir.path().join("test.txt").to_string_lossy().to_string();
        assert!(confine_path(&path, dir.path()).is_ok());
    }

    #[test]
    fn confine_path_rechaza_ruta_fuera_del_root() {
        let dir = setup_test_dir();
        let outside = "/tmp";
        let path = outside.to_string();
        assert!(confine_path(&path, dir.path()).is_err());
    }
}
