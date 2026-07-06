// bash.rs — Execute shell commands cross-platform.
//
// Instead of running brush-core in-process (which makes it impossible to
// kill orphaned child processes), this spawns `xi-tools exec` as a
// subprocess inside a processkit ProcessGroup. The group ensures that
// on timeout or drop, the ENTIRE process tree is killed — no orphans.
//
// processkit uses the OS native containment primitive on each platform:
//   - Windows → Job Object (KILL_ON_JOB_CLOSE)
//   - Linux   → cgroup v2 (falls back to POSIX process group)
//   - macOS/BSD → POSIX process group

use std::io::Read;
use std::time::Duration;

use processkit::{Command as PkCommand, Stdin};

/// Returns `Ok(exit_code)` where 0 = success, non-zero = command error.
/// Returns `Err(msg)` for internal errors (timeout, spawn failure, etc.).
pub fn execute(timeout_secs: Option<u32>, cwd: Option<&str>) -> Result<i32, String> {
    // Read the command from stdin
    let mut command = String::new();
    std::io::stdin()
        .read_to_string(&mut command)
        .map_err(|e| format!("failed to read stdin: {e}"))?;

    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("empty command".into());
    }

    // Find our own path to spawn `xi-tools exec`
    let self_path = std::env::current_exe()
        .map_err(|e| format!("failed to get current executable path: {e}"))?;

    // Build a one-shot processkit Command.
    //
    // Every processkit::Command run gets automatic containment:
    // a private ProcessGroup that kills the whole tree on drop/timeout.
    // This replaces the old tokio::time::timeout which cancelled the
    // Rust future but left OS child processes running.
    let mut cmd = PkCommand::new(self_path)
        .arg("exec")
        .stdin(Stdin::from_string(&command));

    if let Some(dir) = cwd {
        cmd = cmd.current_dir(dir);
    }

    if let Some(secs) = timeout_secs {
        cmd = cmd.timeout(Duration::from_secs(secs as u64));
    }

    // processkit is async (tokio-based). We wrap it in a single-threaded
    // runtime, same as brush-core before.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("failed to create runtime: {e}"))?;

    let result = rt
        .block_on(cmd.output_string())
        .map_err(|e| format!("process error: {e}"))?;

    // Print captured stdout (processkit already captured it)
    if !result.stdout().is_empty() {
        print!("{}", result.stdout());
    }
    if !result.stderr().is_empty() {
        eprint!("{}", result.stderr());
    }

    // Propagate the real exit code.
    // exec.rs exits with the command's actual code, and processkit captures
    // it via output_string(). We forward it so main.rs can exit with the
    // same code, and the TypeScript side sees the real exit code.
    match result.code() {
        Some(code) => Ok(code),
        None => Err("command timed out or was killed".into()),
    }
}
