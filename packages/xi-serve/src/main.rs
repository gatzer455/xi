// xi-serve — Daemon que expone pi via WebSocket.
//
// Uso:
//   xi-serve                    # puerto 9876, pi del PATH
//   XI_SERVE_PORT=8080 xi-serve # puerto custom
//   XI_SERVE_PI=/usr/bin/pi     # ruta custom a pi
//
// Para probar desde el celular (mismo tailnet):
//   ws ws://homeserver:9876/ws

use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tracing::{error, info, warn};

struct PiHandle {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl PiHandle {
    fn new() -> Self {
        Self { child: None, stdin: None }
    }

    async fn spawn(&mut self, cwd: &str) -> Result<(), String> {
        self.kill().await;
        let pi_bin = std::env::var("XI_SERVE_PI").unwrap_or_else(|_| "pi".to_string());
        let mut child = tokio::process::Command::new(&pi_bin)
            .args(["--mode", "rpc", "--no-themes"])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("No se pudo spawnear pi: {e}"))?;
        let stdin = child.stdin.take().ok_or("stdin no disponible")?;
        info!("pi spawned (pid={:?})", child.id());
        self.child = Some(child);
        self.stdin = Some(stdin);
        Ok(())
    }

    async fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.kill().await.ok();
            child.wait().await.ok();
            self.stdin = None;
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()))
        .init();

    let port: u16 = std::env::var("XI_SERVE_PORT")
        .ok().and_then(|p| p.parse().ok())
        .unwrap_or(9876);

    let state = Arc::new(Mutex::new(PiHandle::new()));
    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    info!("xi-serve en ws://127.0.0.1:{port}");
    info!("Celular: ws://<tailscale-ip>:{port}/ws");

    while let Ok((stream, addr)) = listener.accept().await {
        let state = state.clone();
        tokio::spawn(async move {
            info!("Conexión desde {addr}");
            match accept_async(stream).await {
                Ok(ws) => proxy(ws, state).await,
                Err(e) => warn!("Handshake WS falló desde {addr}: {e}"),
            }
        });
    }
}

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

/// Pipe bidireccional: WebSocket ↔ pi stdin/stdout.
async fn proxy(
    ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    state: Arc<Mutex<PiHandle>>,
) {
    let (mut ws_tx, mut ws_rx) = ws.split();

    // Spawnear pi si no está vivo
    let cwd = std::env::current_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    {
        let mut pi = state.lock().await;
        if pi.child.is_none() {
            pi.spawn(&cwd).await.unwrap_or_else(|e| error!("Error spawnendo pi: {e}"));
        }
    }

    // Canal para pasar líneas de stdout → WS
    let (line_tx, mut line_rx) = mpsc::channel::<String>(256);

    // Pipe pi stdout → canal
    {
        let mut pi = state.lock().await;
        if let Some(stdout) = pi.child.as_mut().and_then(|c| c.stdout.take()) {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line_tx.send(line).await.is_err() { break; }
                }
            });
        }
    }

    // Pipe pi stderr → log
    {
        let mut pi = state.lock().await;
        if let Some(stderr) = pi.child.as_mut().and_then(|c| c.stderr.take()) {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    warn!("[pi stderr] {line}");
                }
            });
        }
    }

    // Loop principal: leer del canal (stdout) y del WS
    loop {
        tokio::select! {
            Some(line) = line_rx.recv() => {
                if ws_tx.send(Message::Text(line)).await.is_err() { break; }
            }
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let mut pi = state.lock().await;
                        if let Some(stdin) = pi.stdin.as_mut() {
                            let _ = stdin.write_all(text.as_bytes()).await;
                            let _ = stdin.write_all(b"\n").await;
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Err(e)) => { warn!("Error en WS: {e}"); break; }
                    None => break,
                    _ => {}
                }
            }
        }
    }

    info!("Cliente desconectado");
}
