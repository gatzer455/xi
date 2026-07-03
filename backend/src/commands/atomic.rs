// atomic.rs — Atomic JSON write helper (tmp + sync + rename + chmod).
//
// Usado por auth_config.rs y extensions_config.rs para evitar
// archivos parcialmente escritos por cortes de energía o crash.

use serde::Serialize;
use std::path::Path;

/// Escribe un valor serializable a un archivo JSON usando atomic write.
///
/// Patrón: tmp → sync → rename (la escritura es atómica a nivel de
/// filesystem porque rename es atómico dentro del mismo filesystem).
///
/// * `path` — Ruta destino.
/// * `value` — Valor a serializar (Serialize).
/// * `file_mode` — Si `Some(mode)`, hace chmod al archivo (Unix, ej: 0o600).
/// * `dir_mode` — Si `Some(mode)`, hace chmod al directorio padre (Unix, ej: 0o700).
pub async fn write_json<T: Serialize>(
    path: &Path,
    value: &T,
    file_mode: Option<u32>,
    dir_mode: Option<u32>,
) -> Result<(), String> {
    // 1. Asegurar directorio padre
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("No se puede crear el directorio: {e}"))?;

        // Permisos del directorio (opcional)
        #[cfg(unix)]
        if let Some(mode) = dir_mode {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = tokio::fs::metadata(parent).await {
                let mut perms = meta.permissions();
                perms.set_mode(mode);
                let _ = tokio::fs::set_permissions(parent, perms).await;
            }
        }
    }

    // 2. Serializar
    let serialized = serde_json::to_string_pretty(value)
        .map_err(|e| format!("No se puede serializar: {e}"))?;

    // 3. Atomic write: tmp + sync + rename
    let tmp_path = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &serialized)
        .await
        .map_err(|e| format!("No se puede escribir el archivo temporal: {e}"))?;

    if let Ok(file) = tokio::fs::File::open(&tmp_path).await {
        let _ = file.sync_all().await;
    }

    tokio::fs::rename(&tmp_path, path)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("No se puede guardar la config: {e}")
        })?;

    // 4. Permisos del archivo (opcional)
    #[cfg(unix)]
    if let Some(mode) = file_mode {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = tokio::fs::metadata(path).await {
            let mut perms = meta.permissions();
            perms.set_mode(mode);
            let _ = tokio::fs::set_permissions(path, perms).await;
        }
    }

    Ok(())
}
