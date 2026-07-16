//! extensions.rs — Asegura las extensiones empaquetadas (xi-tools, xi-flow,
//! xi-exa) en `~/.pi/agent/extensions/`.
//!
//! Puerto de `apps/desktop/backend/src/extensions.rs`. La diferencia: xi-serve
//! no es una app Tauri, así que no hay `resource_dir` — el bundle de
//! extensiones se busca junto al binario (`<exe_dir>/extensions/`), donde el
//! empaquetado del homeserver debe copiarlo.

use std::fs;
use std::path::Path;
use tracing::{info, warn};

const BUNDLED_EXTENSIONS: &[&str] = &["xi-tools", "xi-flow", "xi-exa"];

/// Extensión de la que depende la capa de supervisión (approve/ask). Sin
/// ella, un agente remoto queda desatendido — ver docs/mobile/05.
const SAFETY_NET_EXTENSION: &str = "xi-flow";

pub fn ensure_extensions() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("no se pudo resolver el home dir")?;
    let target_dir = home.join(".pi").join("agent").join("extensions");

    let missing: Vec<&&str> = BUNDLED_EXTENSIONS
        .iter()
        .filter(|ext| !target_dir.join(ext).join("index.ts").exists())
        .collect();

    if missing.is_empty() {
        info!("[extensions] Ya instaladas en {}", target_dir.display());
        return check_safety_net(&target_dir);
    }

    let exe = std::env::current_exe().map_err(|e| format!("no se pudo resolver el binario actual: {e}"))?;
    let source_dir = exe
        .parent()
        .ok_or("el binario actual no tiene directorio padre")?
        .join("extensions");

    if !source_dir.exists() {
        warn!(
            "[extensions] Bundle no encontrado en {}. Copiá las extensiones ahí o instalalas manualmente.",
            source_dir.display()
        );
        return check_safety_net(&target_dir);
    }

    fs::create_dir_all(&target_dir).map_err(|e| format!("no se pudo crear {}: {e}", target_dir.display()))?;

    for ext in &missing {
        let src = source_dir.join(ext);
        let dst = target_dir.join(ext);

        if !src.exists() {
            warn!("[extensions] {ext} no encontrada en el bundle");
            continue;
        }

        if let Err(e) = (|| -> std::io::Result<()> {
            if dst.exists() {
                fs::remove_dir_all(&dst)?;
            }
            copy_dir_all(&src, &dst)
        })() {
            warn!("[extensions] Error instalando {ext}: {e}");
            continue;
        }

        info!("[extensions] Instalada {ext}");
    }

    check_safety_net(&target_dir)
}

/// xi-flow es la red de seguridad de approve/ask para un agente remoto
/// desatendido. Si no está instalada, avisamos fuerte en vez de arrancar
/// en silencio sin supervisión.
fn check_safety_net(target_dir: &Path) -> Result<(), String> {
    if !target_dir.join(SAFETY_NET_EXTENSION).join("index.ts").exists() {
        return Err(format!(
            "{SAFETY_NET_EXTENSION} no está instalada en {} — sin ella no hay approve/ask para el agente remoto",
            target_dir.display()
        ));
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
