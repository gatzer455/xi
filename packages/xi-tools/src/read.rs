// read.rs — Read file contents with optional offset/limit.
// Clean, minimal, cross-platform.

use std::fs;
use std::io::Read;

pub fn execute(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut content = String::new();
    let size = file
        .read_to_string(&mut content)
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    let total_lines = content.lines().count();
    let max_bytes: usize = 50 * 1024;
    let truncated = size > max_bytes;
    if truncated {
        content.truncate(max_bytes);
    }

    let display_lines: Vec<&str> = content.lines().collect();
    let start = offset.unwrap_or(0);
    let max = limit.unwrap_or(2000);
    let selected: Vec<&&str> = display_lines.iter().skip(start).take(max).collect();

    if selected.is_empty() {
        println!("(empty file)");
        return Ok(());
    }

    if truncated || start > 0 || selected.len() < total_lines {
        eprintln!(
            "[truncated — lines {start}-{} of {total_lines}, {size}B. Use offset/limit to read more.]",
            start + selected.len(),
        );
    }

    for line in selected {
        println!("{line}");
    }

    Ok(())
}
