// read.rs — Read file contents with optional offset and limit.

use std::fs;
use std::io::{BufRead, BufReader};

const MAX_BYTES: usize = 50_000; // 50KB limit

pub fn execute(path: &str, offset: Option<usize>, limit: Option<usize>) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let reader = BufReader::new(file);

    let skip = offset.map(|o| o.saturating_sub(1)).unwrap_or(0); // 1-indexed
    let max_lines = limit.unwrap_or(usize::MAX);
    let mut total_bytes = 0usize;
    let mut line_count = 0usize;
    let mut truncated = false;

    for (i, line_res) in reader.lines().enumerate() {
        let line = line_res.map_err(|e| format!("read error on line {}: {e}", i + 1))?;

        if i < skip {
            continue;
        }
        if line_count >= max_lines {
            truncated = true;
            break;
        }

        let bytes = line.len() + 1; // +1 for newline
        if total_bytes + bytes > MAX_BYTES {
            // Print partial content
            let remaining = MAX_BYTES.saturating_sub(total_bytes);
            if remaining > 0 {
                print!("{}", &line[..remaining.min(line.len())]);
            }
            truncated = true;
            break;
        }

        println!("{line}");
        total_bytes += bytes;
        line_count += 1;
    }

    if truncated {
        eprintln!(
            "[truncated — limit: {}/{} lines, {}KB. Use offset/limit to read more.]",
            line_count,
            limit.unwrap_or(0),
            MAX_BYTES / 1024
        );
    }

    Ok(())
}
