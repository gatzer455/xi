use std::fs;
use std::path::Path;
use tauri::path::BaseDirectory;
use tauri::AppHandle;
use tauri::Manager;

/// Extensiones que xi empaqueta y debe asegurar en ~/.pi/agent/extensions/
const BUNDLED_EXTENSIONS: &[&str] = &["xi-tools", "xi-flow", "xi-exa"];

/// Copia las extensiones empaquetadas a ~/.pi/agent/extensions/
/// si no existen ya. Se llama en setup() al iniciar la app.
///
/// Si las extensiones ya están instaladas, no hace nada.
/// Si estamos en modo dev y no se ha ejecutado bundle-extensions.sh,
/// se salta silenciosamente.
///
/// Cada extensión se chequea individualmente: si una falla al
/// copiarse, las demás siguen (no queremos que un error de
/// permisos en xi-exa impida instalar xi-tools).
pub fn ensure_extensions(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let home = app.path().home_dir()?;
    let target_dir = home.join(".pi").join("agent").join("extensions");

    // Sentinel: chequeamos cada extensión individualmente.
    // Si alguna no existe, la instalamos. Las que ya están se saltean.
    let missing: Vec<&&str> = BUNDLED_EXTENSIONS
        .iter()
        .filter(|ext| !target_dir.join(ext).join("index.ts").exists())
        .collect();

    if missing.is_empty() {
        log::info!("[extensions] Ya instaladas en ~/.pi/agent/extensions/");
        return Ok(());
    }

    let source_dir = app.path().resolve("extensions", BaseDirectory::Resource)?;

    if !source_dir.exists() {
        // Modo dev: no se ha ejecutado bundle-extensions.sh. Saltar.
        log::warn!(
            "[extensions] No encontradas en {}. Ejecuta scripts/bundle-extensions.mjs primero",
            source_dir.display()
        );
        return Ok(());
    }

    fs::create_dir_all(&target_dir)?;

    let mut installed = 0usize;
    for ext in &missing {
        let src = source_dir.join(ext);
        let dst = target_dir.join(ext);

        if !src.exists() {
            log::warn!("[extensions] {ext} no encontrada en el bundle");
            continue;
        }

        if let Err(e) = (|| -> std::io::Result<()> {
            if dst.exists() {
                fs::remove_dir_all(&dst)?;
            }
            copy_dir_all(&src, &dst)
        })() {
            log::warn!("[extensions] Error instalando {ext}: {e}");
            continue;
        }

        log::info!("[extensions] Instalada {ext}");
        installed += 1;
    }

    if installed > 0 {
        log::info!(
            "[extensions] {installed} extension(es) instalada(s) en {}",
            target_dir.display()
        );
    }
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
