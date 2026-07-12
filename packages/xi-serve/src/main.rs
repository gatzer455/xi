// xi-serve — Daemon que expone pi via WebSocket.
//
// Uso:
//   xi-serve                          # localhost:9876, pi del PATH
//   xi-serve --port 8080              # puerto custom
//   xi-serve --bind 0.0.0.0           # exponer a la red (ej: tailnet)
//   xi-serve --pi /usr/bin/pi         # ruta custom a pi
//   XI_SERVE_PORT=8080 xi-serve       # fallback env var
//
// Para probar desde el celular (mismo tailnet):
//   ws ws://<tailscale-ip>:9876/ws

use clap::Parser;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tracing::{error, info, warn};

/// Daemon que expone pi via WebSocket para acceso remoto.
#[derive(Parser)]
#[command(name = "xi-serve", version, about)]
struct Args {
    /// Puerto de escucha (default: 9876, o XI_SERVE_PORT)
    #[arg(long, default_value_t = 9876)]
    port: u16,

    /// Dirección IP a la que bindear (default: 127.0.0.1, o XI_SERVE_BIND)
    #[arg(long, default_value = "127.0.0.1")]
    bind: String,

    /// Ruta al binario de pi (default: "pi", o XI_SERVE_PI)
    #[arg(long, default_value = "pi")]
    pi: String,
}

struct PiHandle {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

impl PiHandle {
    fn new() -> Self {
        Self { child: None, stdin: None }
    }

    async fn spawn(&mut self, cwd: &str, pi_bin: &str) -> Result<(), String> {
        self.kill().await;
        let mut child = tokio::process::Command::new(pi_bin)
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

    let args = Args::parse();

    // Env vars como fallback
    let port: u16 = std::env::var("XI_SERVE_PORT")
        .ok().and_then(|p| p.parse().ok())
        .unwrap_or(args.port);
    let bind = std::env::var("XI_SERVE_BIND").unwrap_or(args.bind);
    let pi_bin = std::env::var("XI_SERVE_PI").unwrap_or(args.pi);

    let addr = format!("{bind}:{port}");
    let state = Arc::new(Mutex::new(PiHandle::new()));
    let listener = TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        panic!("No se pudo bindear {addr}: {e}");
    });

    info!("xi-serve en ws://{addr}");
    info!("Conectar desde el celular: ws://<tailscale-ip>:{port}/ws");

    while let Ok((stream, addr)) = listener.accept().await {
        let state = state.clone();
        let pi_bin = pi_bin.clone();
        tokio::spawn(async move {
            info!("Conexión desde {addr}");
            match accept_async(stream).await {
                Ok(ws) => proxy(ws, state, &pi_bin).await,
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
    pi_bin: &str,
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
            pi.spawn(&cwd, pi_bin).await.unwrap_or_else(|e| error!("Error spawnendo pi: {e}"));
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
