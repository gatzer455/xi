// pi_version.rs — Commands para obtener la versión del sidecar pi y
// la última versión upstream de pi.dev.
//
// Por qué existe:
// - El user necesita ver en settings qué versión de pi está usando
//   (junto con la versión de xi, formato 'xi vX — pi vY').
// - El dev necesita ver en el debug panel si pi upstream tiene una
//   versión más nueva (señal para hacer un release de xi).
//
// Decisiones de diseño (ver .develop/02-design/pi-version.md):
// - D2: el sidecar retorna la versión real (gracias al fix de
//   build-pi.sh + PI_PACKAGE_DIR en pi_process.rs).
// - D4: endpoint upstream es pi.dev/api/latest-version (texto plano).
// - D7: timeout 5s en ambos commands para no colgar la app.

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

/// Retorna la versión del sidecar pi (la que viene embebida en el
/// binario compilado con bun). Si el sidecar no responde, retorna
/// error con un mensaje descriptivo para que el frontend pueda
/// mostrar "pi desconocida".
#[tauri::command]
pub async fn get_pi_version(app: AppHandle) -> Result<String, String> {
    // El sidecar se invoca con --version, igual que en la terminal.
    // Capturamos stdout via los eventos del Receiver.
    let (mut rx, _child) = app
        .shell()
        .sidecar("pi")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args(["--version"])
        .spawn()
        .map_err(|e| format!("Failed to spawn pi: {e}"))?;

    // Leemos el primer chunk de stdout (la línea de --version).
    // No esperamos el cierre del proceso porque pi --version a
    // veces no termina solo (queda escuchando). Leemos hasta el
    // primer newline y matamos.
    let mut version = String::new();
    let timeout = tokio::time::Duration::from_secs(5);

    tokio::time::timeout(timeout, async {
        while let Some(event) = rx.recv().await {
            use tauri_plugin_shell::process::CommandEvent;
            if let CommandEvent::Stdout(line) = event {
                version = String::from_utf8_lossy(&line).trim().to_string();
                if !version.is_empty() {
                    break;
                }
            }
        }
    })
    .await
    .map_err(|_| "Timeout waiting for pi --version".to_string())?;

    if version.is_empty() {
        return Err("pi --version returned empty output".to_string());
    }
    Ok(version)
}

/// Retorna la última versión de pi upstream (de `pi.dev`).
/// Si el endpoint falla, retorna error. El frontend lo loguea en
/// el debug panel y sigue. El user nunca ve este error.
#[tauri::command]
pub async fn get_pi_upstream_version() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .get("https://pi.dev/api/latest-version")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch pi.dev: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("pi.dev returned HTTP {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    let version = body.trim().to_string();
    if version.is_empty() {
        return Err("pi.dev returned empty body".to_string());
    }
    Ok(version)
}
