// exec.rs — Execute a shell command by embedding brush-core in-process.
//
// This is the inner subprocess spawned by `xi-tools bash`.
// It reads a command from stdin, runs it via brush-core, and writes
// stdout/stderr to the OS pipes. processkit in the parent handles
// containment (kill-on-drop), timeout, and output capture.
//
// Usage: xi-tools exec
//   Reads shell command from stdin (same format as pi built-in bash)
//   Runs brush-core in-process
//   Writes stdout to stdout, stderr to stderr
//   Exits with the command's exit code

use std::io::Read;

use brush_builtins::{BuiltinSet, ShellBuilderExt};
use brush_core::{
    ExecutionParameters, ProfileLoadBehavior, RcLoadBehavior, Shell, SourceInfo,
    extensions::DefaultShellExtensions,
};

pub fn execute() -> Result<(), String> {
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
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("failed to create runtime: {e}"))?;

    rt.block_on(async {
        // Build a minimal non-interactive shell
        let mut shell = Shell::builder_with_extensions::<DefaultShellExtensions>()
            .profile(ProfileLoadBehavior::Skip)
            .rc(RcLoadBehavior::Skip)
            .exit_after_one_command(true)
            .no_editing(true)
            .default_builtins(BuiltinSet::BashMode)
            .build()
            .await
            .map_err(|e| format!("failed to initialize shell: {e}"))?;

        // Working directory is inherited from the parent process
        // (set by processkit's current_dir() in bash.rs)

        // Run the command
        let params = ExecutionParameters::default();
        let result = shell
            .run_string(command, &SourceInfo::from("[stdin]"), &params)
            .await
            .map_err(|e| format!("execution error: {e}"))?;

        let exit_code = u8::from(result.exit_code);
        if exit_code != 0 {
            eprintln!("[exit code: {exit_code}]");
            // Exit with the real code so processkit in bash.rs captures it
            std::process::exit(exit_code as i32);
        }

        Ok(())
    })
}
