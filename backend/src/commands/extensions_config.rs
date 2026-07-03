// extensions_config.rs — Commands para gestionar la config de extensiones.
//
// Maneja dos archivos:
// - ~/.pi/agent/extensions/pi-exa/exa-config.json: API key de Exa
// - ~/.pi/agent/approve-rules.json: reglas de pi-approve
//
// Patrón: mismo que auth_config.rs (atomic write, chmod 600, leer → modificar → escribir).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ═══════════════════════════════════════════════════════
// Paths
// ═══════════════════════════════════════════════════════

fn extensions_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("agent").join("extensions")
}

fn exa_config_path() -> PathBuf {
    extensions_dir().join("pi-exa").join("exa-config.json")
}

fn approve_rules_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("agent").join("approve-rules.json")
}

// ═══════════════════════════════════════════════════════
// pi-exa
// ═══════════════════════════════════════════════════════

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExaConfigStatus {
    pub has_key: bool,
    pub last4: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExaConfigFile {
    #[serde(default)]
    api_key: Option<String>,
}

/// Lee el estado actual de la config de Exa (sin exponer la key).
#[tauri::command]
pub async fn get_exa_config() -> Result<ExaConfigStatus, String> {
    let path = exa_config_path();
    let config = read_exa_config(&path).await?;

    let last4 = config.api_key.as_ref().and_then(|k| {
        let chars: Vec<char> = k.chars().collect();
        if chars.len() >= 4 {
            Some(chars[chars.len() - 4..].iter().collect())
        } else if k.is_empty() {
            None
        } else {
            Some(k.clone())
        }
    });

    Ok(ExaConfigStatus {
        has_key: config.api_key.is_some(),
        last4,
    })
}

async fn read_exa_config(path: &PathBuf) -> Result<ExaConfigFile, String> {
    if !path.exists() {
        return Ok(ExaConfigFile { api_key: None });
    }
    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("No se puede leer la config de Exa: {e}"))?;
    serde_json::from_str(&content).map_err(|_| "Config de Exa corrupta.".to_string())
}

/// Retorna la API key completa (solo cuando el user hace click en "Ver").
#[tauri::command]
pub async fn get_exa_api_key() -> Result<Option<String>, String> {
    let path = exa_config_path();
    let config = read_exa_config(&path).await?;
    Ok(config.api_key)
}

/// Guarda (o actualiza) la API key de Exa.
#[tauri::command]
pub async fn set_exa_api_key(api_key: String) -> Result<(), String> {
    let path = exa_config_path();
    write_exa_config(&path, &api_key).await
}

/// Elimina la API key de Exa.
#[tauri::command]
pub async fn delete_exa_api_key() -> Result<(), String> {
    let path = exa_config_path();
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("No se puede eliminar la config de Exa: {e}"))?;
    }
    Ok(())
}

async fn write_exa_config(path: &PathBuf, api_key: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("No se puede crear el directorio: {e}"))?;
    }

    let json = serde_json::json!({ "apiKey": api_key });
    let serialized = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("No se puede serializar: {e}"))?;

    // Atomic write
    let tmp_path = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &serialized)
        .await
        .map_err(|e| format!("No se puede escribir: {e}"))?;

    if let Ok(file) = tokio::fs::File::open(&tmp_path).await {
        let _ = file.sync_all().await;
    }

    tokio::fs::rename(&tmp_path, path)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("No se puede guardar la config: {e}")
        })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = tokio::fs::metadata(path).await {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = tokio::fs::set_permissions(path, perms).await;
        }
    }

    Ok(())
}

/// Valida una API key de Exa contra la API real (mismo patrón que test_api_key).
#[tauri::command]
pub async fn test_exa_api_key(api_key: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("No se puede crear el cliente HTTP: {e}"))?;

    let response = match client
        .post("https://api.exa.ai/search")
        .header("x-api-key", &api_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "query": "test",
            "numResults": 1,
            "contents": { "highlights": true }
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return Err("No se pudo conectar a Exa (timeout)".to_string());
        }
        Err(e) if e.is_connect() || e.is_request() => {
            return Err("No se pudo conectar a Exa (sin red)".to_string());
        }
        Err(e) => return Err(format!("Error de red: {e}")),
    };

    let status = response.status();
    if status.is_success() {
        Ok(())
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        Err("API key inválida".to_string())
    } else if status.as_u16() == 429 {
        Err("Rate limit. Esperá unos minutos.".to_string())
    } else {
        let body = response.text().await.unwrap_or_default();
        let truncated: String = body.chars().take(200).collect();
        Err(format!("HTTP {}: {truncated}", status.as_u16()))
    }
}

// ═══════════════════════════════════════════════════════
// pi-approve
// ═══════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApproveRules {
    pub rules: std::collections::HashMap<String, Vec<String>>,
    pub messages: std::collections::HashMap<String, String>,
}

impl Default for ApproveRules {
    fn default() -> Self {
        let mut rules = std::collections::HashMap::new();
        rules.insert(
            "bash".to_string(),
            vec![
                "rm -rf".to_string(),
                "sudo".to_string(),
                "chmod 777".to_string(),
                "shutdown".to_string(),
                "reboot".to_string(),
            ],
        );
        rules.insert(
            "write".to_string(),
            vec![".env".to_string(), "credentials".to_string(), "secrets".to_string()],
        );
        rules.insert(
            "edit".to_string(),
            vec![".env".to_string(), "credentials".to_string(), "secrets".to_string()],
        );

        let mut messages = std::collections::HashMap::new();
        messages.insert("bash".to_string(), "Confirm before running this command".to_string());
        messages.insert("write".to_string(), "Confirm before writing to this file".to_string());
        messages.insert("edit".to_string(), "Confirm before editing this file".to_string());

        ApproveRules { rules, messages }
    }
}

/// Lee las reglas de pi-approve. Si no existe el archivo, retorna defaults.
#[tauri::command]
pub async fn get_approve_rules() -> Result<ApproveRules, String> {
    let path = approve_rules_path();
    if !path.exists() {
        return Ok(ApproveRules::default());
    }

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("No se puede leer approve-rules.json: {e}"))?;

    if content.trim().is_empty() {
        return Ok(ApproveRules::default());
    }

    serde_json::from_str(&content).map_err(|e| format!("approve-rules.json corrupto: {e}"))
}

/// Guarda las reglas de pi-approve. Atomic write.
#[tauri::command]
pub async fn set_approve_rules(config: ApproveRules) -> Result<(), String> {
    let path = approve_rules_path();

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("No se puede crear el directorio: {e}"))?;
    }

    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("No se puede serializar: {e}"))?;

    let tmp_path = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &serialized)
        .await
        .map_err(|e| format!("No se puede escribir: {e}"))?;

    if let Ok(file) = tokio::fs::File::open(&tmp_path).await {
        let _ = file.sync_all().await;
    }

    tokio::fs::rename(&tmp_path, &path)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp_path);
            format!("No se puede guardar approve-rules.json: {e}")
        })?;

    Ok(())
}
