use std::fs;
use std::path::Path;
use tauri::path::BaseDirectory;
use tauri::Manager;

/// Extensiones que xi empaqueta y debe asegurar en ~/.pi/agent/extensions/
const BUNDLED_EXTENSIONS: &[&str] = &["xi-tools", "pi-approve", "pi-ask", "pi-exa"];

/// Copia las extensiones empaquetadas a ~/.pi/agent/extensions/
/// si no existen ya. Se llama en setup() al iniciar la app.
///
/// Si las extensiones ya están instaladas, no hace nada.
/// Si estamos en modo dev y no se ha ejecutado bundle-extensions.sh,
/// se salta silenciosamente.
pub fn ensure_extensions(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let home = app.path().home_dir()?;
    let target_dir = home.join(".pi/agent/extensions");

    // Sentinel: si xi-tools ya existe, asumimos que todas están
    if target_dir.join("xi-tools/index.ts").exists() {
        log::info!("[extensions] Ya instaladas en ~/.pi/agent/extensions/");
        return Ok(());
    }

    let source_dir = app.path().resolve("extensions", BaseDirectory::Resource)?;

    if !source_dir.exists() {
        // Modo dev: no se ha ejecutado bundle-extensions.sh. Saltar.
        log::warn!(
            "[extensions] No encontradas en {}. Ejecuta scripts/bundle-extensions.sh primero",
            source_dir.display()
        );
        return Ok(());
    }

    fs::create_dir_all(&target_dir)?;

    for ext in BUNDLED_EXTENSIONS {
        let src = source_dir.join(ext);
        let dst = target_dir.join(ext);

        if src.exists() {
            log::info!("[extensions] Instalando {}...", ext);
            // Si ya existe de una instalación parcial, sobrescribir
            if dst.exists() {
                fs::remove_dir_all(&dst)?;
            }
            copy_dir_all(&src, &dst)?;
        } else {
            log::warn!("[extensions] {} no encontrada en el bundle", ext);
        }
    }

    log::info!(
        "[extensions] Instaladas en {}",
        target_dir.display()
    );
    Ok(())
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_all(&path, &dest)?;
        } else {
            fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}
