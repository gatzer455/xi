// auth_config.rs — Commands para gestionar la API key del provider LLM.
//
// Por qué existe:
// - El user no-técnico no puede (ni debe) editar ~/.pi/agent/auth.json
//   a mano. xi le da una UI en Settings para que pegue su key y la
//   guardamos en el formato que pi espera.
// - También expone un "test" que valida la key contra el provider
//   antes de guardarla, para feedback inmediato.
//
// Decisiones de diseño (ver .develop/02-design/onboarding.md):
// - D1: xi escribe directo a auth.json, no via pi (el RPC de pi no
//   expone auth commands).
// - D2: el formato escrito es idéntico al de pi: { provider: { type,
//   ... } }. Para api_key: { type: "api_key", key: "..." }.
// - D3: atomic write con temp file + rename para evitar corrupción.
// - D5: test por provider, cada uno con su endpoint de validación.
// - D7: la primera sección de settings es "Proveedor" (orden lógico).
//
// Limitaciones:
// - xi solo escribe entries de tipo "api_key". Si el user quiere
//   OAuth, tiene que usar `pi login` en su terminal. Esto está en
//   scope para una v2.

use serde_json::Value;
use std::path::PathBuf;

/// Path al archivo auth.json de pi. Estructura: ~/.pi/agent/auth.json.
/// Si `PI_AUTH_PATH` está seteado (override para tests), se usa ese.
fn auth_path() -> PathBuf {
    if let Ok(custom) = std::env::var("PI_AUTH_PATH") {
        return PathBuf::from(custom);
    }

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("agent").join("auth.json")
}

/// Lee el auth.json y retorna la lista de provider IDs configurados.
/// Si el archivo no existe, retorna `vec![]` (no es un error — el
/// user simplemente no configuró nada todavía).
#[tauri::command]
pub async fn get_auth_status() -> Result<Vec<String>, String> {
    let path = auth_path();

    // Si no existe, no es error — el flujo normal para un user nuevo.
    if !path.exists() {
        return Ok(vec![]);
    }

    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("No se puede leer la config de pi: {e}"))?;

    let parsed: Value = serde_json::from_str(&content)
        .map_err(|_| "Archivo auth.json corrupto. Contactá a soporte.".to_string())?;

    let obj = parsed
        .as_object()
        .ok_or_else(|| "auth.json no es un objeto JSON".to_string())?;

    Ok(obj.keys().cloned().collect())
}

/// Escribe (o actualiza) la API key de un provider en auth.json.
/// Atomic write: escribe a auth.json.tmp, fsync, rename. Si el
/// rename falla, intenta borrar el tmp.
#[tauri::command]
pub async fn set_api_key(provider: String, api_key: String) -> Result<(), String> {
    let path = auth_path();

    // 1. Asegurar que el directorio ~/.pi/agent existe.
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("No se puede crear el directorio de config: {e}"))?;

        // Setear permisos 700 en el directorio (owner-only).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = tokio::fs::metadata(parent).await {
                let mut perms = meta.permissions();
                perms.set_mode(0o700);
                let _ = tokio::fs::set_permissions(parent, perms).await;
            }
        }
    }

    // 2. Leer el archivo existente (o empezar con {} si no existe).
    let mut entries: serde_json::Map<String, Value> = if path.exists() {
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("No se puede leer la config existente: {e}"))?;
        serde_json::from_str(&content).map_err(|_| {
            "Archivo auth.json corrupto. No se puede actualizar. Contactá a soporte.".to_string()
        })?
    } else {
        serde_json::Map::new()
    };

    // 3. Merge: agregar/actualizar la entry del provider.
    entries.insert(
        provider,
        serde_json::json!({
            "type": "api_key",
            "key": api_key,
        }),
    );

    // 4. Serializar.
    let serialized = serde_json::to_string_pretty(&entries)
        .map_err(|e| format!("No se puede serializar: {e}"))?;

    // 5. Atomic write: tmp + rename.
    let tmp_path = path.with_extension("json.tmp");
    tokio::fs::write(&tmp_path, &serialized)
        .await
        .map_err(|e| format!("No se puede escribir el archivo temporal: {e}"))?;

    // fsync — forzar que los datos lleguen al disco antes del rename.
    if let Ok(file) = tokio::fs::File::open(&tmp_path).await {
        let _ = file.sync_all().await;
    }

    // 6. Rename atómico.
    if let Err(e) = tokio::fs::rename(&tmp_path, &path).await {
        // Si el rename falla, intentamos borrar el tmp para no dejar basura.
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(format!("No se puede escribir la config: {e}"));
    }

    // 7. chmod 600 (owner read+write only). El formato de pi espera esto.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = tokio::fs::metadata(&path).await {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = tokio::fs::set_permissions(&path, perms).await;
        }
    }

    Ok(())
}

/// Hace un ping al provider para validar que la key funciona.
/// Retorna `Ok(())` si la key es válida, `Err(msg)` con mensaje
/// específico si falla.
#[tauri::command]
pub async fn test_api_key(provider: String, api_key: String) -> Result<(), String> {
    match provider.as_str() {
        "anthropic" => test_anthropic(&api_key).await,
        "openai" => test_openai(&api_key).await,
        "google" => test_google(&api_key).await,
        "openrouter" => test_openrouter(&api_key).await,
        "groq" => test_groq(&api_key).await,
        "opencode-go" => test_opencode_go(&api_key).await,
        "deepseek" => test_deepseek(&api_key).await,
        _ => Err(format!("Provider no soportado: {provider}")),
    }
}

// ──────────────────────────────────────────────────────────
// Tests por provider. Cada uno:
// 1. Hace el HTTP request al endpoint "ligero" que valida la key.
// 2. Interpreta el status code y retorna el mensaje específico.
// 3. Timeout 5s para no colgar la app.

const TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Lee el cuerpo de la respuesta de error del provider y extrae un
/// mensaje legible. Si el body no parsea o está vacío, retorna el
/// status code como fallback.
async fn extract_error_body(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    // Truncar el body a 200 chars para no loguear cosas gigantes.
    let truncated: String = body.chars().take(200).collect();
    if truncated.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {truncated}")
    }
}

/// Convierte un status code en un mensaje amigable para el user.
/// 401/403 → key inválida. 429 → rate limit. Otros → mensaje genérico.
fn interpret_status(status: reqwest::StatusCode) -> Result<(), String> {
    match status.as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err("API key inválida".to_string()),
        429 => Err("Rate limit. Esperá unos minutos.".to_string()),
        500..=599 => Err("El provider tuvo un error. Intentá de nuevo.".to_string()),
        _ => Err(format!("Error del provider (HTTP {})", status.as_u16())),
    }
}

/// Helper compartido para los providers que usan Bearer auth en un
/// endpoint GET. Centraliza el patrón: armar request, enviar,
/// timeout, interpretar status.
async fn test_bearer_get(url: &str, api_key: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(TEST_TIMEOUT)
        .build()
        .map_err(|e| format!("No se puede crear el cliente HTTP: {e}"))?;

    let response = match client.get(url).bearer_auth(api_key).send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return Err("No se pudo conectar al provider (timeout)".to_string());
        }
        Err(e) if e.is_connect() || e.is_request() => {
            return Err("No se pudo conectar al provider (sin red)".to_string());
        }
        Err(e) => return Err(format!("Error de red: {e}")),
    };

    let status = response.status();
    if status.is_success() {
        Ok(())
    } else if matches!(status.as_u16(), 401 | 403) {
        Err("API key inválida".to_string())
    } else if status.as_u16() == 429 {
        Err("Rate limit. Esperá unos minutos.".to_string())
    } else {
        // Leer el body para tener un mensaje más rico.
        Err(extract_error_body(response).await)
    }
}

async fn test_anthropic(key: &str) -> Result<(), String> {
    // Anthropic no tiene un endpoint "listar models" — usa /v1/messages
    // con un body mínimo (count_tokens es 0-cost).
    let client = reqwest::Client::builder()
        .timeout(TEST_TIMEOUT)
        .build()
        .map_err(|e| format!("No se puede crear el cliente HTTP: {e}"))?;

    let response = match client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-haiku-4-5",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return Err("No se pudo conectar al provider (timeout)".to_string());
        }
        Err(e) if e.is_connect() || e.is_request() => {
            return Err("No se pudo conectar al provider (sin red)".to_string());
        }
        Err(e) => return Err(format!("Error de red: {e}")),
    };

    interpret_status(response.status())
}

async fn test_openai(key: &str) -> Result<(), String> {
    test_bearer_get("https://api.openai.com/v1/models", key).await
}

async fn test_google(key: &str) -> Result<(), String> {
    // Google Gemini usa `?key=` en vez de Bearer header.
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models?key={key}");
    let client = reqwest::Client::builder()
        .timeout(TEST_TIMEOUT)
        .build()
        .map_err(|e| format!("No se puede crear el cliente HTTP: {e}"))?;

    let response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return Err("No se pudo conectar al provider (timeout)".to_string());
        }
        Err(e) if e.is_connect() || e.is_request() => {
            return Err("No se pudo conectar al provider (sin red)".to_string());
        }
        Err(e) => return Err(format!("Error de red: {e}")),
    };

    interpret_status(response.status())
}

async fn test_openrouter(key: &str) -> Result<(), String> {
    test_bearer_get("https://openrouter.ai/api/v1/auth/key", key).await
}

async fn test_groq(key: &str) -> Result<(), String> {
    test_bearer_get("https://api.groq.com/openai/v1/models", key).await
}

async fn test_opencode_go(key: &str) -> Result<(), String> {
    test_bearer_get("https://api.opencode.ai/v1/models", key).await
}

async fn test_deepseek(key: &str) -> Result<(), String> {
    test_bearer_get("https://api.deepseek.com/v1/models", key).await
}
