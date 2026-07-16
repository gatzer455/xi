mod config;
mod extensions;
mod files;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;
use std::process::Stdio;
use tracing::{error, info, warn};

use clap::Parser;

#[derive(Parser)]
struct Args {
    #[arg(long, env = "XI_SERVE_PORT", default_value_t = 9876)]
    port: u16,

    #[arg(long, env = "XI_SERVE_BIND", default_value = "127.0.0.1")]
    bind: String,

    #[arg(long, env = "XI_SERVE_PI", default_value = "pi")]
    pi: String,

    #[arg(long, env = "XI_SERVE_PI_SESSIONS", default_value = "pi-sessions")]
    pi_sessions: String,

    #[arg(long, env = "XI_SERVE_CWD")]
    cwd: Option<String>,
}

struct PiHandle {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl PiHandle {
    fn new() -> Self {
        Self { child: None, stdin: None }
    }

    async fn spawn(
        &mut self,
        cwd: &str,
        pi_bin: &str,
        session_path: Option<&str>,
    ) -> Result<tokio::process::ChildStdout, String> {
        self.kill().await;
        info!("▶ spawn pi_bin={pi_bin} cwd={cwd} session={session_path:?}");
        let mut args = vec!["--mode".to_string(), "rpc".to_string(), "--no-themes".to_string()];
        if let Some(sp) = session_path {
            args.push("--session".to_string());
            args.push(sp.to_string());
        }
        let mut child = tokio::process::Command::new(pi_bin)
            .args(&args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("No se pudo spawnear pi: {e}"))?;
        let stdin = child.stdin.take().ok_or("stdin no disponible")?;
        let stdout = child.stdout.take().ok_or("stdout no disponible")?;
        info!("pi spawned (pid={:?}, cwd={})", child.id(), cwd);
        self.child = Some(child);
        self.stdin = Some(stdin);
        Ok(stdout)
    }

    async fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            info!("matando pi (pid={:?})", child.id());
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        self.stdin = None;
    }
}

struct AppState {
    pi: PiHandle,
    cwd: String,
    pi_bin: String,
    pi_sessions_bin: String,
    token: String,
    roots: Vec<PathBuf>,
    approve_timeout_secs: u64,
    /// Líneas de stdout de pi, difundidas a todos los clientes conectados.
    broadcast_tx: broadcast::Sender<String>,
    /// `extension_ui_request` pendientes de respuesta, por id — se re-entregan
    /// a un cliente que (re)conecta y se auto-deniegan por timeout.
    pending_ui: HashMap<String, Value>,
}

impl AppState {
    fn new(cwd: String, pi_bin: String, pi_sessions_bin: String, cfg: config::Config) -> Self {
        let (broadcast_tx, _) = broadcast::channel(256);
        Self {
            pi: PiHandle::new(),
            cwd,
            pi_bin,
            pi_sessions_bin,
            token: cfg.token,
            roots: cfg.roots,
            approve_timeout_secs: cfg.approve_timeout_secs,
            broadcast_tx,
            pending_ui: HashMap::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct XiStatus {
    running: bool,
    cwd: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()))
        .init();

    if let Err(e) = extensions::ensure_extensions() {
        error!("{e}");
        std::process::exit(1);
    }

    let args = Args::parse();
    let addr = format!(
        "{bind}:{port}",
        bind = if args.bind.contains(':') { format!("[{}]", args.bind) } else { args.bind },
        port = args.port
    );

    let cfg = match config::load_or_create(args.cwd.as_deref()) {
        Ok(c) => c,
        Err(e) => {
            error!("No se pudo cargar la config: {e}");
            std::process::exit(1);
        }
    };

    let cwd = args.cwd.clone().unwrap_or_else(|| {
        cfg.roots
            .first()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| {
                std::env::current_dir().unwrap_or_default().to_string_lossy().to_string()
            })
    });

    let state = Arc::new(Mutex::new(AppState::new(cwd.clone(), args.pi, args.pi_sessions, cfg)));

    let listener = TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        panic!("No se pudo bindear {addr}: {e}");
    });
    info!("xi-serve en ws://{addr}");
    info!("CWD inicial: {cwd}");

    if let Err(e) = spawn_pi(state.clone(), cwd, None).await {
        error!("Error spawneando pi: {e}");
    }

    accept_loop(listener, state).await;
}

/// (Re)spawnea pi para `cwd` (+ `session_path` opcional) y arranca el lector
/// de stdout de fondo, que difunde cada línea a `broadcast_tx` e intercepta
/// `extension_ui_request` para la cola de pendientes.
async fn spawn_pi(
    state: Arc<Mutex<AppState>>,
    cwd: String,
    session_path: Option<String>,
) -> Result<(), String> {
    let pi_bin = state.lock().await.pi_bin.clone();
    let mut stdout = {
        let mut app = state.lock().await;
        let out = app.pi.spawn(&cwd, &pi_bin, session_path.as_deref()).await?;
        app.cwd = cwd;
        out
    };

    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut reader = tokio::io::BufReader::new(&mut stdout);
        let mut buf = String::new();
        loop {
            buf.clear();
            match reader.read_line(&mut buf).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = buf.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    intercept_extension_ui(trimmed, &state).await;
                    let tx = state.lock().await.broadcast_tx.clone();
                    let _ = tx.send(trimmed.to_string());
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

/// Métodos de `ctx.ui` que esperan una respuesta humana (ver `ExtensionUIContext`
/// en xi-flow/ask.ts). Otros métodos (`notify`, `setStatus`, ...) son
/// fire-and-forget — nadie los responde, así que no se encolan ni se
/// re-entregan al reconectar (si no, se redisparan en cada reconexión).
const INTERACTIVE_UI_METHODS: &[&str] = &["select", "confirm", "input", "editor"];

/// Si `line` es un `extension_ui_request` interactivo, lo guarda en
/// `pending_ui` y programa un auto-deny a los `approve_timeout_secs`. No
/// consume la línea: se sigue difundiendo tal cual a los clientes.
async fn intercept_extension_ui(line: &str, state: &Arc<Mutex<AppState>>) {
    let Ok(val) = serde_json::from_str::<Value>(line) else { return };
    if val.get("type").and_then(|v| v.as_str()) != Some("extension_ui_request") {
        return;
    }
    let (Some(id), Some(method)) = (
        val.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
        val.get("method").and_then(|v| v.as_str()),
    ) else {
        return;
    };
    if !INTERACTIVE_UI_METHODS.contains(&method) {
        return;
    }

    let timeout_secs = {
        let mut app = state.lock().await;
        app.pending_ui.insert(id.clone(), val.clone());
        app.approve_timeout_secs
    };

    let state = state.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(timeout_secs)).await;
        let mut app = state.lock().await;
        if app.pending_ui.remove(&id).is_some() {
            warn!("extension_ui_request {id} sin respuesta tras {timeout_secs}s — denegando");
            let deny = serde_json::json!({"type": "extension_ui_response", "id": id, "cancelled": true});
            if let Some(stdin) = app.pi.stdin.as_mut() {
                let _ = stdin.write_all(deny.to_string().as_bytes()).await;
                let _ = stdin.write_all(b"\n").await;
            }
        }
    });
}

async fn accept_loop(listener: TcpListener, state: Arc<Mutex<AppState>>) {
    loop {
        let (tcp, addr) = match listener.accept().await {
            Ok(x) => x,
            Err(e) => {
                warn!("Error accept: {e}");
                continue;
            }
        };
        let state = state.clone();
        tokio::spawn(async move {
            let expected_token = state.lock().await.token.clone();
            let callback = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
                let query = req.uri().query().unwrap_or("");
                let provided = config::token_from_query(query).unwrap_or("");
                if config::token_matches(provided, &expected_token) {
                    Ok(resp)
                } else {
                    let mut rejected = ErrorResponse::new(Some("token inválido o ausente".into()));
                    *rejected.status_mut() = StatusCode::UNAUTHORIZED;
                    Err(rejected)
                }
            };
            match accept_hdr_async(tcp, callback).await {
                Ok(ws) => {
                    info!("Conexión autenticada desde {addr}");
                    proxy(ws, state).await;
                    info!("Cliente desconectado ({addr})");
                }
                Err(e) => warn!("Handshake/auth rechazado desde {addr}: {e}"),
            }
        });
    }
}

async fn proxy(
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    state: Arc<Mutex<AppState>>,
) {
    let (mut ws_tx, mut ws_rx) = ws.split();

    let mut line_rx = state.lock().await.broadcast_tx.subscribe();

    // Re-entregar extension_ui_request pendientes al (re)conectar.
    {
        let app = state.lock().await;
        for pending in app.pending_ui.values() {
            let _ = ws_tx.send(Message::Text(pending.to_string())).await;
        }
    }

    loop {
        tokio::select! {
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(val) = serde_json::from_str::<Value>(&text) {
                            if let Some(method) = val.get("method").and_then(|v| v.as_str()) {
                                if method.starts_with("xi_") {
                                    let id = val.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                                    let params = val.get("params").cloned();
                                    handle_xi_command(method, params, id, &mut ws_tx, &state).await;
                                    continue;
                                }
                            }
                            if val.get("type").and_then(|v| v.as_str()) == Some("extension_ui_response") {
                                if let Some(rid) = val.get("id").and_then(|v| v.as_str()) {
                                    state.lock().await.pending_ui.remove(rid);
                                }
                            }
                        }
                        let mut app = state.lock().await;
                        if let Some(stdin) = app.pi.stdin.as_mut() {
                            if let Err(e) = stdin.write_all(text.as_bytes()).await {
                                warn!("Error escribiendo a pi stdin: {e}");
                            }
                            if let Err(e) = stdin.write_all(b"\n").await {
                                warn!("Error escribiendo newline a pi stdin: {e}");
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Err(e)) => { warn!("Error en WS: {e}"); break; }
                    None => break,
                    _ => {}
                }
            }

            line = line_rx.recv() => {
                match line {
                    Ok(text) => {
                        if let Err(e) = ws_tx.send(Message::Text(text)).await {
                            warn!("Error enviando a WS: {e}");
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!("Cliente atrasado, se perdieron {n} líneas");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn handle_xi_command(
    method: &str,
    params: Option<Value>,
    id: i64,
    ws_tx: &mut (impl SinkExt<Message> + Unpin),
    state: &Arc<Mutex<AppState>>,
) {
    match method {
        "xi_get_status" => {
            let app = state.lock().await;
            let status = XiStatus {
                running: app.pi.child.is_some(),
                cwd: app.cwd.clone(),
            };
            respond(ws_tx, id, serde_json::to_value(status).unwrap_or_default()).await;
        }
        "xi_list_projects" => {
            let app = state.lock().await;
            let projects: Vec<String> =
                app.roots.iter().map(|p| p.to_string_lossy().to_string()).collect();
            respond(ws_tx, id, serde_json::json!({"projects": projects})).await;
        }
        "xi_set_project" => {
            let path = param_str(&params, "path");
            if path.is_empty() {
                respond_err(ws_tx, id, "Se requiere params.path").await;
                return;
            }
            let roots = state.lock().await.roots.clone();
            let canonical = match config::validate_in_roots(&path, &roots) {
                Ok(p) => p,
                Err(e) => {
                    respond_err(ws_tx, id, &e).await;
                    return;
                }
            };
            let cwd = canonical.to_string_lossy().to_string();
            match spawn_pi(state.clone(), cwd.clone(), None).await {
                Ok(()) => respond(ws_tx, id, serde_json::json!({"ok": true, "cwd": cwd})).await,
                Err(e) => respond_err(ws_tx, id, &e).await,
            }
        }
        "xi_open_session" => {
            let path = param_str(&params, "path");
            if path.is_empty() {
                respond_err(ws_tx, id, "Se requiere params.path").await;
                return;
            }
            let (roots, cwd) = {
                let app = state.lock().await;
                (app.roots.clone(), app.cwd.clone())
            };
            let validated = match config::validate_session_path(&path, &roots) {
                Ok(p) => p,
                Err(e) => {
                    respond_err(ws_tx, id, &e).await;
                    return;
                }
            };
            let session_path = validated.to_string_lossy().to_string();
            match spawn_pi(state.clone(), cwd, Some(session_path.clone())).await {
                Ok(()) => respond(ws_tx, id, serde_json::json!({"ok": true, "path": session_path})).await,
                Err(e) => respond_err(ws_tx, id, &e).await,
            }
        }
        "xi_list_sessions" => {
            let cwd = {
                let requested = param_str(&params, "cwd");
                if requested.is_empty() { state.lock().await.cwd.clone() } else { requested }
            };
            let (roots, pi_sessions_bin) = {
                let app = state.lock().await;
                (app.roots.clone(), app.pi_sessions_bin.clone())
            };
            if let Err(e) = config::validate_in_roots(&cwd, &roots) {
                respond_err(ws_tx, id, &e).await;
                return;
            }
            match run_pi_sessions(&pi_sessions_bin, &["list", &cwd]).await {
                Ok(stdout) => match serde_json::from_str::<Value>(&stdout) {
                    Ok(val) => respond(ws_tx, id, val).await,
                    Err(e) => respond_err(ws_tx, id, &format!("pi-sessions devolvió JSON inválido: {e}")).await,
                },
                Err(e) => respond_err(ws_tx, id, &e).await,
            }
        }
        "xi_list_files" => {
            let path = param_str(&params, "path");
            let roots = state.lock().await.roots.clone();
            match config::validate_in_roots(&path, &roots) {
                Ok(dir) => match files::list_files(&dir) {
                    Ok(entries) => respond(ws_tx, id, serde_json::to_value(entries).unwrap_or_default()).await,
                    Err(e) => respond_err(ws_tx, id, &e).await,
                },
                Err(e) => respond_err(ws_tx, id, &e).await,
            }
        }
        "xi_read_file" => {
            let path = param_str(&params, "path");
            let roots = state.lock().await.roots.clone();
            match config::validate_in_roots(&path, &roots) {
                Ok(file) => match files::read_file(&file) {
                    Ok(content) => respond(ws_tx, id, Value::String(content)).await,
                    Err(e) => respond_err(ws_tx, id, &e).await,
                },
                Err(e) => respond_err(ws_tx, id, &e).await,
            }
        }
        "xi_get_pi_version" => {
            let pi_bin = state.lock().await.pi_bin.clone();
            let output = tokio::process::Command::new(&pi_bin).arg("--version").output().await;
            match output {
                Ok(out) => {
                    let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    respond(ws_tx, id, serde_json::json!({"version": ver})).await;
                }
                Err(e) => respond_err(ws_tx, id, &format!("{e}")).await,
            }
        }
        "xi_get_auth_status" => {
            let auth_path = dirs::home_dir().map(|h| h.join(".pi").join("agent").join("auth.json"));
            let providers: Vec<Value> = match auth_path {
                Some(path) if path.exists() => match std::fs::read_to_string(&path) {
                    Ok(contents) => serde_json::from_str::<serde_json::Map<String, Value>>(&contents)
                        .ok()
                        .map(|map| {
                            map.iter()
                                .map(|(name, info)| {
                                    let has_key = info
                                        .get("key")
                                        .and_then(|v| v.as_str())
                                        .map(|s| !s.is_empty())
                                        .unwrap_or(false);
                                    let last4 = info
                                        .get("key")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| s.len() >= 4)
                                        .map(|s| s[s.len() - 4..].to_string());
                                    serde_json::json!({"id": name, "hasKey": has_key, "last4": last4})
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                    Err(_) => vec![],
                },
                _ => vec![],
            };
            respond(ws_tx, id, serde_json::to_value(providers).unwrap_or_default()).await;
        }
        _ => {
            respond_err(ws_tx, id, &format!("Comando desconocido: {method}")).await;
        }
    }
}

// ── Helpers ──

fn param_str(params: &Option<Value>, key: &str) -> String {
    params
        .as_ref()
        .and_then(|p| p.get(key).and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string()
}

async fn respond(ws_tx: &mut (impl SinkExt<Message> + Unpin), id: i64, value: Value) {
    let msg = serde_json::json!({"id": id, "result": value});
    let _ = ws_tx.send(Message::Text(msg.to_string())).await;
}

async fn respond_err(ws_tx: &mut (impl SinkExt<Message> + Unpin), id: i64, error: &str) {
    let msg = serde_json::json!({"id": id, "error": error});
    let _ = ws_tx.send(Message::Text(msg.to_string())).await;
}

/// Ejecuta `pi-sessions <args>` y devuelve su stdout. El JSON que emite ya
/// está en el shape que el frontend espera (camelCase) — se pasa tal cual,
/// sin reparsearlo a un struct propio.
async fn run_pi_sessions(bin: &str, args: &[&str]) -> Result<String, String> {
    let fut = tokio::process::Command::new(bin).args(args).output();
    let output = match tokio::time::timeout(Duration::from_secs(20), fut).await {
        Err(_) => return Err("pi-sessions: timeout".to_string()),
        Ok(Err(e)) => return Err(format!("pi-sessions: no se pudo ejecutar: {e}")),
        Ok(Ok(out)) => out,
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("pi-sessions salió con código {:?}", output.status.code())
        } else {
            stderr
        });
    }
    String::from_utf8(output.stdout).map_err(|e| format!("pi-sessions: salida no es UTF-8: {e}"))
}
