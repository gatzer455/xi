//! xi-terminal — Sidecar de terminal para xi.
//!
//! Protocolo stdin/stdout JSONL:
//!   → {"cmd":"spawn","shell":"bash","cwd":"/path"}
//!   ← {"event":"spawned","pid":0}
//!   → {"cmd":"write","data":"ls\n"}
//!   ← {"event":"data","data":"\u001b[32m..."}
//!   → {"cmd":"resize","cols":80,"rows":24}
//!   → {"cmd":"kill"}
//!   ← {"event":"exit","code":0}

use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::mpsc;
use std::thread;

#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
enum Command {
    Spawn {
        shell: Option<String>,
        cwd: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
    },
    Write {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    Kill,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
enum Event {
    Spawned,
    Data { data: String },
    Exit { code: i32 },
    Error { msg: String },
}

/// Estado global: un solo shell a la vez.
struct State {
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    kill_tx: mpsc::Sender<()>,
}

fn main() {
    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());
    let mut state: Option<State> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let cmd: Command = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(e) => {
                emit(&Event::Error {
                    msg: format!("JSON inválido: {e}"),
                });
                continue;
            }
        };

        match cmd {
            Command::Spawn {
                shell,
                cwd,
                cols,
                rows,
            } => {
                if state.is_some() {
                    emit(&Event::Error {
                        msg: "Ya hay un shell corriendo".into(),
                    });
                    continue;
                }

                let shell_cmd = shell.unwrap_or_else(|| {
                    std::env::var("SHELL").unwrap_or_else(|_| "bash".into())
                });

                let size = PtySize {
                    rows: rows.unwrap_or(24),
                    cols: cols.unwrap_or(80),
                    pixel_width: 0,
                    pixel_height: 0,
                };

                match spawn_shell(&shell_cmd, cwd.as_deref(), size) {
                    Ok(s) => {
                        emit(&Event::Spawned);
                        state = Some(s);
                    }
                    Err(e) => {
                        emit(&Event::Error { msg: e });
                    }
                }
            }

            Command::Write { data } => {
                if let Some(ref mut s) = state {
                    if let Err(e) = s.writer.write_all(data.as_bytes()) {
                        emit(&Event::Error {
                            msg: format!("write error: {e}"),
                        });
                    }
                    // flush para que el shell reciba la data inmediatamente
                    let _ = s.writer.flush();
                } else {
                    emit(&Event::Error {
                        msg: "No hay shell corriendo. Usá spawn primero.".into(),
                    });
                }
            }

            Command::Resize { cols, rows } => {
                if let Some(ref s) = state {
                    let size = PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    };
                    if let Err(e) = s.master.resize(size) {
                        emit(&Event::Error {
                            msg: format!("resize error: {e}"),
                        });
                    }
                }
            }

            Command::Kill => {
                if let Some(mut s) = state.take() {
                    let _ = s.kill_tx.send(());
                    let _ = s.child.wait();
                    // exit code no disponible en todas las plataformas
                    emit(&Event::Exit { code: 0 });
                }
                break;
            }
        }
    }
}

fn spawn_shell(
    shell: &str,
    cwd: Option<&str>,
    size: PtySize,
) -> Result<State, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("openpty: {e}"))?;

    let mut cmd = CommandBuilder::new(shell);
    cmd.args(["-i".to_string()]); // interactive mode
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;

    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {e}"))?;

    let master = pair.master;

    let (kill_tx, kill_rx) = mpsc::channel::<()>();

    // Thread: lee stdout del PTY → emite eventos
    thread::spawn(move || {
        let mut buf = vec![0u8; 4096];
        loop {
            if kill_rx.try_recv().is_ok() {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                    emit(&Event::Data { data: text });
                }
                Err(_) => break,
            }
        }
    });

    Ok(State {
        writer,
        child,
        master,
        kill_tx,
    })
}

fn emit(event: &Event) {
    if let Ok(json) = serde_json::to_string(event) {
        println!("{json}");
    }
}
