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

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Path al archivo auth.json de pi. Estructura: ~/.pi/agent/auth.json.
/// Si `PI_AUTH_PATH` está seteado (override para tests), se usa ese.
fn auth_path() -> PathBuf {
    if let Ok(custom) = std::env::var("PI_AUTH_PATH") {
        return PathBuf::from(custom);
    }

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi").join("agent").join("auth.json")
}

/// Info de un provider configurado en auth.json. Lo retornado por
/// get_auth_status para que la UI pueda mostrar masked keys sin
/// pedir la key completa (que solo se envía on-demand via get_api_key).
///
/// `has_key` es true si la entry es de tipo "api_key" (con una key
/// que podemos mostrar/editar). false si es "oauth" (no se puede
/// editar desde la UI, el user tiene que usar `pi login`).
///
/// `last4` son los últimos 4 caracteres del key (si es api_key).
/// Sirve para mostrar `sk-***1234` en la UI. La key completa NUNCA
/// viaja al frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub has_key: bool,
    pub last4: Option<String>,
}

/// Lee el auth.json y retorna la lista de providers con su info.
/// Si el archivo no existe, retorna `vec![]` (no es un error — el
/// user simplemente no configuró nada todavía).
#[tauri::command]
pub async fn get_auth_status() -> Result<Vec<ProviderInfo>, String> {
    let path = auth_path();
    let map = read_auth_map(&path).await?;

    Ok(map
        .into_iter()
        .map(|(id, value)| provider_info_from_value(&id, &value))
        .collect())
}

/// Lee auth.json y parsea el contenido. Helper compartido por
/// get_auth_status y delete_api_key. Si el archivo no
/// existe, retorna un Map vacío (no es error).
async fn read_auth_map(path: &PathBuf) -> Result<serde_json::Map<String, Value>, String> {
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }

    let content = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("No se puede leer la config de pi: {e}"))?;

    let parsed: Value = serde_json::from_str(&content)
        .map_err(|_| "Archivo auth.json corrupto. Contactá a soporte.".to_string())?;

    parsed
        .as_object()
        .cloned()
        .ok_or_else(|| "auth.json no es un objeto JSON".to_string())
}

/// Extrae la info pública de un provider. Si la entry es de tipo
/// "api_key" y tiene un key, computa el last4. Si es "oauth",
/// has_key=false (la key no se puede editar desde xi).
fn provider_info_from_value(id: &str, value: &Value) -> ProviderInfo {
    let obj = match value.as_object() {
        Some(o) => o,
        None => {
            return ProviderInfo {
                id: id.to_string(),
                has_key: false,
                last4: None,
            };
        }
    };

    let entry_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if entry_type != "api_key" {
        return ProviderInfo {
            id: id.to_string(),
            has_key: false,
            last4: None,
        };
    }

    let key = obj.get("key").and_then(|v| v.as_str()).unwrap_or("");
    let last4 = if key.len() >= 4 {
        Some(key[key.len() - 4..].to_string())
    } else if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    };

    ProviderInfo {
        id: id.to_string(),
        has_key: true,
        last4,
    }
}

/// Elimina la entry de un provider de auth.json. Atomic write +
/// chmod 600. Si el provider no existe, no es error (es idempotente).
#[tauri::command]
pub async fn delete_api_key(provider: String) -> Result<(), String> {
    let path = auth_path();
    let mut map = read_auth_map(&path).await?;

    if !map.contains_key(&provider) {
        // Idempotente: si el provider no estaba, no hacemos nada.
        return Ok(());
    }

    map.remove(&provider);
    write_auth_map(&path, &map).await
}

/// Helper compartido: serializa el map y hace atomic write + chmod 600.
/// Usado por set_api_key y delete_api_key.
async fn write_auth_map(path: &Path, map: &serde_json::Map<String, Value>) -> Result<(), String> {
    super::atomic::write_json(path, map, Some(0o600), Some(0o700)).await
}

/// Escribe (o actualiza) la API key de un provider en auth.json.
/// Atomic write: escribe a auth.json.tmp, fsync, rename. Si el
/// rename falla, intenta borrar el tmp.
#[tauri::command]
pub async fn set_api_key(provider: String, api_key: String) -> Result<(), String> {
    let path = auth_path();
    let mut entries = read_auth_map(&path).await?;

    // Merge: agregar/actualizar la entry del provider.
    entries.insert(
        provider,
        serde_json::json!({
            "type": "api_key",
            "key": api_key,
        }),
    );

    write_auth_map(&path, &entries).await
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
