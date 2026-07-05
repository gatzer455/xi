// bash.rs — Execute shell commands cross-platform.
//
// Uses brush-core: a POSIX/bash-compatible shell embedded directly in xi-tools.
// Runs bash scripts natively on Linux, macOS, and Windows without requiring
// any external shell or Git Bash.

use std::io::Read;
use std::time::Duration;

use brush_core::{
    ExecutionParameters, ProfileLoadBehavior, RcLoadBehavior, Shell, SourceInfo,
    extensions::DefaultShellExtensions,
};

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

    // Create a single-threaded tokio runtime for brush's async API.
    // This wraps brush's async calls in a sync function.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("failed to create runtime: {e}"))?;

    rt.block_on(async {
        // Build a minimal non-interactive shell
        // - Skip profile and rc files (no .bashrc loading)
        // - Exit after one command
        // - No editing, no interactive features
        let mut shell = Shell::builder_with_extensions::<DefaultShellExtensions>()
            .profile(ProfileLoadBehavior::Skip)
            .rc(RcLoadBehavior::Skip)
            .exit_after_one_command(true)
            .no_editing(true)
            .build()
            .await
            .map_err(|e| format!("failed to initialize shell: {e}"))?;

        // Set working directory if provided
        // (brush handles cd; we set the process cwd before spawning brush)
        if let Some(dir) = cwd {
            let _ = std::env::set_current_dir(dir);
        }

        // Setup execution parameters
        let params = ExecutionParameters::default();

        // Handle timeout
        let result = if let Some(secs) = timeout_secs {
            let dur = Duration::from_secs(secs as u64);
            let timeout_fut = tokio::time::timeout(dur, async {
                shell
                    .run_string(command, &SourceInfo::from("[stdin]"), &params)
                    .await
            });
            match timeout_fut.await {
                Ok(Ok(result)) => result,
                Ok(Err(e)) => return Err(format!("execution error: {e}")),
                Err(_) => {
                    eprintln!("[timeout: {secs}s]");
                    return Err("command timed out".into());
                }
            }
        } else {
            shell
                .run_string(command, &SourceInfo::from("[stdin]"), &params)
                .await
                .map_err(|e| format!("execution error: {e}"))?
        };

        let exit_code = u8::from(result.exit_code);
        if exit_code != 0 {
            eprintln!("[exit code: {exit_code}]");
            return Err(format!("command exited with code {exit_code}"));
        }

        Ok(())
    })
}