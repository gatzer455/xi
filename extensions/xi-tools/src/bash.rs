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

    // Detect shell configuration
    let shell_cfg = detect_shell();

    // Build the process
    let mut cmd = Command::new(&shell_cfg.path);
    for arg in &shell_cfg.args {
        cmd.arg(arg);
    }

    if shell_cfg.raw_cmd {
        // cmd.exe on Windows: use raw_arg to bypass Rust's auto-escaping
        // Rust docs: "This is useful for passing arguments to cmd.exe /c"
        // Pattern: cmd /Q /S /C "command"  → /S forces outer-quote stripping
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.raw_arg(&format!("\"{}\"", command));
        }
        cmd.stdin(Stdio::null());
    } else {
        // sh -c / pwsh -Command: pass command as argument (safe)
        cmd.arg(&command);
        cmd.stdin(Stdio::null());
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    // Spawn
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", shell_cfg.path))?;

    let mut stdout_reader = child.stdout.take().unwrap();
    let mut stderr_reader = child.stderr.take().unwrap();

    // Drain output in a separate thread while waiting
    let stdout_handle = std::thread::spawn(move || {
        let mut out = String::new();
        stdout_reader.read_to_string(&mut out).unwrap_or_default();
        out
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut err = String::new();
        stderr_reader.read_to_string(&mut err).unwrap_or_default();
        err
    });

    // Wait with optional timeout
    let mut timed_out = false;
    let exit = if let Some(secs) = timeout_secs {
        let dur = Duration::from_secs(secs as u64);
        let start = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {
                    if start.elapsed() >= dur {
                        let _ = child.kill();
                        let _ = child.wait();
                        eprintln!("[timeout: {secs}s]");
                        timed_out = true;
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

    // Collect output from reader threads
    let stdout = stdout_handle
        .join()
        .unwrap_or_else(|_| String::from("[stdout reader panicked]"));
    let stderr = stderr_handle
        .join()
        .unwrap_or_else(|_| String::from("[stderr reader panicked]"));

    // Print output
    print!("{stdout}");
    if !stderr.is_empty() {
        eprint!("{stderr}");
    }

    // Timeout → error
    if timed_out {
        return Err(format!(
            "command timed out after {}s",
            timeout_secs.unwrap()
        ));
    }

    // Propagate exit code: non-zero exits → error so callers see it
    if let Some(status) = exit {
        if !status.success() {
            let code = status.code().unwrap_or(-1);
            eprintln!("[exit code: {code}]");
            return Err(format!("command exited with code {code}"));
        }
    }

    Ok(())
}

struct ShellConfig {
    path: String,
    args: Vec<String>,
    /// On Windows for cmd.exe: use raw_arg to bypass Rust's auto-escaping
    /// (sh -c and pwsh use normal arg() which handles \" correctly)
    raw_cmd: bool,
}

#[cfg(unix)]
fn detect_shell() -> ShellConfig {
    ShellConfig {
        path: "/bin/sh".into(),
        args: vec!["-c".into()],
        raw_cmd: false,
    }
}

#[cfg(windows)]
fn detect_shell() -> ShellConfig {
    // PowerShell 5 (built-in) no soporta &&, solo usar pwsh (v7+)
    let pwsh = detect_pwsh();
    if let Some(ps) = pwsh {
        ShellConfig {
            path: ps,
            args: vec!["-NoProfile".into(), "-Command".into()],
            raw_cmd: false,
        }
    } else {
        // cmd.exe: use raw_arg to bypass Rust's broken auto-escaping
        // Rust escapes \" → cmd.exe doesn't understand it
        // raw_arg passes the text verbatim without any quoting/escaping
        // Combined with /S /C, outer quotes are stripped by cmd.exe:
        //   cmd /Q /S /C "echo \"hola\" && whoami"
        //   → cmd strips outer quotes → echo "hola" && whoami
        ShellConfig {
            path: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()),
            args: vec!["/Q".into(), "/S".into(), "/C".into()],
            raw_cmd: true,
        }
    }
}

#[cfg(windows)]
fn detect_pwsh() -> Option<String> {
    if let Ok(comspec) = std::env::var("COMSPEC") {
        let dir = std::path::Path::new(&comspec).parent()?;
        let candidate = dir.join("pwsh.exe");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into());
        }
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join("pwsh.exe");
            if candidate.exists() {
                Some(candidate.to_string_lossy().into())
            } else {
                None
            }
        })
    })
}
