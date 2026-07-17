//! config.rs — Config de xi-serve: token de auth + whitelist de proyectos.
//!
//! Vive en `~/.pi/config/xi-serve.json` (mismo directorio que las configs
//! de extensiones). Se crea al primer arranque con un token aleatorio.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::{info, warn};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Token de auth. Viaja como `?token=` en el handshake del WS.
    pub token: String,
    /// Working dirs permitidos. El agente remoto queda acotado a estos
    /// directorios — la decisión de seguridad central del diseño.
    #[serde(default)]
    pub projects: Vec<String>,
    /// Segundos antes de denegar un approve/ask sin respuesta.
    #[serde(default = "default_approve_timeout")]
    pub approve_timeout_secs: u64,
    /// `projects` canonicalizados (+ el --cwd de la CLI). No se serializa.
    #[serde(skip)]
    pub roots: Vec<PathBuf>,
}

fn default_approve_timeout() -> u64 {
    600
}

pub fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".pi").join("config").join("xi-serve.json"))
}

/// Carga el config, creándolo (con token nuevo) si no existe.
/// `extra_project` (--cwd) se suma a la whitelist solo en memoria.
pub fn load_or_create(extra_project: Option<&str>) -> Result<Config, String> {
    let path = config_path().ok_or("no se pudo resolver el home dir")?;

    let mut cfg: Config = if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| format!("no se pudo leer {}: {e}", path.display()))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("config inválido en {}: {e}", path.display()))?
    } else {
        Config {
            token: String::new(),
            projects: vec![],
            approve_timeout_secs: default_approve_timeout(),
            roots: vec![],
        }
    };

    if cfg.token.is_empty() {
        cfg.token = generate_token();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("no se pudo crear {}: {e}", dir.display()))?;
        }
        let pretty = serde_json::to_string_pretty(&cfg).expect("config serializable");
        std::fs::write(&path, pretty)
            .map_err(|e| format!("no se pudo escribir {}: {e}", path.display()))?;
        // Se imprime UNA vez (al generarlo) para copiarlo al cliente.
        // En arranques posteriores solo se loggea el path.
        info!("Token generado: {}", cfg.token);
        info!("Guardado en {}", path.display());
    }

    for p in &cfg.projects {
        match Path::new(p).canonicalize() {
            Ok(root) => cfg.roots.push(root),
            Err(e) => warn!("proyecto de la whitelist inválido, ignorado: {p} ({e})"),
        }
    }
    if let Some(extra) = extra_project {
        match Path::new(extra).canonicalize() {
            Ok(root) => cfg.roots.push(root),
            Err(e) => warn!("--cwd inválido, ignorado: {extra} ({e})"),
        }
    }
    if cfg.roots.is_empty() {
        warn!(
            "whitelist de proyectos vacía — agregá \"projects\": [\"/ruta/al/proyecto\"] en {}",
            path.display()
        );
    }
    Ok(cfg)
}

pub fn generate_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("sin fuente de aleatoriedad del OS");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Comparación en tiempo constante — el token es la única credencial.
pub fn token_matches(provided: &str, expected: &str) -> bool {
    if provided.len() != expected.len() || expected.is_empty() {
        return false;
    }
    provided
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

/// Extrae el valor de `token=` de un query string.
pub fn token_from_query(query: &str) -> Option<&str> {
    query.split('&').find_map(|kv| kv.strip_prefix("token="))
}

/// Valida que `path` exista y esté dentro de algún proyecto whitelisteado.
pub fn validate_in_roots(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let p = Path::new(path)
        .canonicalize()
        .map_err(|_| format!("Ruta inválida o no existe: {path}"))?;
    if roots.iter().any(|r| p.starts_with(r)) {
        Ok(p)
    } else {
        Err(format!("Ruta fuera de la whitelist de proyectos: {path}"))
    }
}

/// Valida un path de sesión: archivo `.jsonl` bajo `~/.pi/` (donde pi
/// guarda sesiones por defecto) o bajo un proyecto permitido (sessionsDir
/// relativo tipo `.pi/sessions`).
pub fn validate_session_path(path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let p = Path::new(path)
        .canonicalize()
        .map_err(|_| format!("Sesión inválida o no existe: {path}"))?;
    if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err(format!("No es un archivo de sesión .jsonl: {path}"));
    }
    let under_pi_home = dirs::home_dir()
        .map(|h| p.starts_with(h.join(".pi")))
        .unwrap_or(false);
    if under_pi_home || roots.iter().any(|r| p.starts_with(r)) {
        Ok(p)
    } else {
        Err(format!("Sesión fuera de los directorios permitidos: {path}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("xi-serve-test-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn token_matches_correcto() {
        assert!(token_matches("abc123", "abc123"));
    }

    #[test]
    fn token_matches_rechaza_distinto_y_vacio() {
        assert!(!token_matches("abc124", "abc123"));
        assert!(!token_matches("abc", "abc123"));
        assert!(!token_matches("", ""));
    }

    #[test]
    fn token_from_query_extrae() {
        assert_eq!(token_from_query("token=xyz"), Some("xyz"));
        assert_eq!(token_from_query("a=1&token=xyz&b=2"), Some("xyz"));
        assert_eq!(token_from_query("a=1"), None);
    }

    #[test]
    fn generate_token_es_hex_de_64() {
        let t = generate_token();
        assert_eq!(t.len(), 64);
        assert!(t.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(t, generate_token());
    }

    #[test]
    fn validate_in_roots_acepta_dentro_rechaza_fuera() {
        let root = tempdir("roots").canonicalize().unwrap();
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let roots = vec![root.clone()];
        assert!(validate_in_roots(sub.to_str().unwrap(), &roots).is_ok());
        assert!(validate_in_roots("/etc", &roots).is_err());
    }

    #[test]
    fn validate_session_path_exige_jsonl() {
        let root = tempdir("sesiones").canonicalize().unwrap();
        let ok = root.join("s.jsonl");
        let bad = root.join("s.txt");
        std::fs::write(&ok, "{}").unwrap();
        std::fs::write(&bad, "{}").unwrap();
        let roots = vec![root];
        assert!(validate_session_path(ok.to_str().unwrap(), &roots).is_ok());
        assert!(validate_session_path(bad.to_str().unwrap(), &roots).is_err());
    }
}
