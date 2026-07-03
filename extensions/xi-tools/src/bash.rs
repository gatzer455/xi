// bash.rs — Execute shell commands cross-platform.
//
// Uses the system's default shell:
//   Unix: /bin/sh
//   Windows: PowerShell or cmd.exe
//
// In the future, this will use brush-shell for true cross-platform POSIX execution.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Duration;

pub fn execute(timeout_secs: Option<u32>, cwd: Option<&str>) -> Result<(), String> {
    // Read the command from stdin
    let mut command = String::new();
    std::io::stdin()
        .read_to_string(&mut command)
        .map_err(|e| format!("failed to read stdin: {e}"))?;

    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("empty command".into());
    }

    // Detect shell
    let (shell, shell_arg) = detect_shell();

    // Build the process
    let mut cmd = Command::new(&shell);
    cmd.arg(shell_arg)
        .arg(&command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    // Spawn
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn {shell}: {e}"))?;

    // Wait with optional timeout
    let exit = if let Some(secs) = timeout_secs {
        let dur = Duration::from_secs(secs as u64);
        // Simple polling approach for timeout
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {
                    if start.elapsed() >= dur {
                        let _ = child.kill();
                        let _ = child.wait();
                        eprintln!("[timeout: {secs}s]");
                        break None;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("wait error: {e}")),
            }
        }
    } else {
        child.wait().ok()
    };

    // Collect output
    let stdout = child.stdout.as_mut().unwrap();
    let mut out = String::new();
    stdout
        .read_to_string(&mut out)
        .unwrap_or_default();

    let stderr = child.stderr.as_mut().unwrap();
    let mut err = String::new();
    stderr
        .read_to_string(&mut err)
        .unwrap_or_default();

    // Print output
    print!("{out}");
    if !err.is_empty() {
        eprint!("{err}");
    }

    if let Some(status) = exit {
        if !status.success() {
            eprintln!("[exit code: {}]", status.code().unwrap_or(-1));
        }
    }

    Ok(())
}

#[cfg(unix)]
fn detect_shell() -> (String, String) {
    // Use /bin/sh (POSIX standard, available on all Unix systems)
    ("/bin/sh".into(), "-c".into())
}

#[cfg(windows)]
fn detect_shell() -> (String, String) {
    // On Windows, prefer PowerShell if available
    let pwsh = which("pwsh.exe").or_else(|| which("powershell.exe"));
    if let Some(ps) = pwsh {
        (ps, "-Command".into())
    } else {
        (std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()), "/c".into())
    }
}

#[cfg(windows)]
fn which(name: &str) -> Option<String> {
    // Search in COMSPEC directory first, then PATH
    if let Ok(comspec) = std::env::var("COMSPEC") {
        let dir = std::path::Path::new(&comspec).parent()?;
        let candidate = dir.join(name);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into());
        }
    }
    // Search PATH
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(name);
            if candidate.exists() {
                Some(candidate.to_string_lossy().into())
            } else {
                None
            }
        })
    })
}
