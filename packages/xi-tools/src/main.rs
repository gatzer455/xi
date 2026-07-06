// xi-tools — Herramientas nativas para pi
//
// Subcommands: bash, grep, find, ls, read, write, edit.
// Each matches the contract of pi's built-in tool with the same name.

mod bash;
mod edit;
mod exec;
mod find;
mod grep;
mod ls;
mod read;
mod write;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "xi-tools", about = "Native tools for pi coding agent")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Execute a shell command (reads command from stdin)
    Bash {
        /// Timeout in seconds
        #[arg(long)]
        timeout: Option<u32>,
        /// Working directory
        #[arg(long)]
        cwd: Option<String>,
    },
    /// Internal subprocess: run brush-core (used by 'bash' via processkit)
    Exec {},
    /// Search file contents with regex
    Grep {
        /// Search pattern (regex or literal)
        #[arg(long)]
        pattern: String,
        /// Directory or file to search
        #[arg(long)]
        path: Option<String>,
        /// Filter files by glob pattern
        #[arg(long)]
        glob: Option<String>,
        /// Case-insensitive search
        #[arg(long)]
        ignore_case: bool,
        /// Treat pattern as literal string
        #[arg(long)]
        literal: bool,
        /// Lines of context around matches
        #[arg(long)]
        context: Option<usize>,
        /// Maximum matches to return
        #[arg(long, default_value = "100")]
        limit: usize,
    },
    /// Find files by glob pattern
    Find {
        /// Glob pattern
        #[arg(long)]
        pattern: String,
        /// Directory to search in
        #[arg(long)]
        path: Option<String>,
        /// Maximum results
        #[arg(long, default_value = "1000")]
        limit: usize,
    },
    /// List directory contents
    Ls {
        /// Directory to list
        #[arg(long)]
        path: Option<String>,
        /// Maximum entries
        #[arg(long, default_value = "500")]
        limit: usize,
    },
    /// Read file contents (with optional offset/limit)
    Read {
        /// File path
        #[arg(long)]
        path: String,
        /// Start line (1-indexed)
        #[arg(long)]
        offset: Option<usize>,
        /// Maximum lines to read
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Write content to a file (reads content from stdin)
    Write {
        /// File path
        #[arg(long)]
        path: String,
    },
    /// Apply text replacements to a file (reads JSON edits[] from stdin)
    Edit {
        /// File path
        #[arg(long)]
        path: String,
    },
}

fn main() {
    let cli = Cli::parse();

    // bash returns Ok(exit_code) to propagate the real exit code.
    // Other commands follow the standard Ok(()) / Err(msg) pattern.
    let result = match cli.command {
        Command::Bash { timeout, cwd } => {
            match bash::execute(timeout, cwd.as_deref()) {
                Ok(code) => std::process::exit(code),
                Err(e) => {
                    eprintln!("xi-tools error: {e}");
                    std::process::exit(124); // timeout exit code
                }
            }
        }
        Command::Exec { .. } => exec::execute(),
        Command::Grep {
            pattern,
            path,
            glob,
            ignore_case,
            literal,
            context,
            limit,
        } => grep::execute(
            &pattern,
            path.as_deref(),
            glob.as_deref(),
            ignore_case,
            literal,
            context,
            limit,
        ),
        Command::Find {
            pattern,
            path,
            limit,
        } => find::execute(&pattern, path.as_deref(), limit),
        Command::Ls { path, limit } => ls::execute(path.as_deref(), limit),
        Command::Read {
            path,
            offset,
            limit,
        } => read::execute(&path, offset, limit),
        Command::Write { path } => write::execute(&path),
        Command::Edit { path } => edit::execute(&path),
    };

    if let Err(e) = result {
        eprintln!("xi-tools error: {e}");
        std::process::exit(1);
    }
}
