// read.rs — Read file contents with optional offset/limit and hashline mode.
//
// When --hashline is set, each line is prefixed with a 4-char content hash:
//   aB3x|fn main() {
//   xYz9|    let x = 1;
//
// Hash: xxhash32(normalized line) → 4-char base64url (24-bit entropy).
// This enables hash-anchored editing with zero ambiguity.
//
// The file_hash and all_lines are derived from the FULL file content,
// not the truncated display buffer. This ensures offset/limit reads
// produce consistent hashes for stale-edit detection.

use std::fs;
use std::io::Read;
use xxhash_rust::xxh32::xxh32;

const BASE64URL: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn execute(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
    hashline: bool,
) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut content = String::new();
    let size = file
        .read_to_string(&mut content)
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    // Compute all_lines and file_hash from the FULL content (before truncation)
    let all_lines: Vec<String> = content.lines().map(String::from).collect();
    let file_hash = compute_file_hash(&all_lines.iter().map(String::as_str).collect::<Vec<_>>());

    // Apply truncation for display output only
    let max_bytes = 50 * 1024;
    let truncated = size > max_bytes;
    if truncated {
        content.truncate(max_bytes);
        let trunc_note = format!(
            "\n[truncated — {size} bytes total, showing first {max_bytes} bytes. Use offset/limit to read more.]"
        );
        content.push_str(&trunc_note);
    }

    // Use display lines for output, but original all_lines for line count
    let display_lines: Vec<&str> = content.lines().collect();
    let start = offset.unwrap_or(0);
    let max = limit.unwrap_or(2000);
    let selected: Vec<&str> = display_lines.iter().skip(start).take(max).copied().collect();

    if selected.is_empty() {
        println!("(empty file)");
        if hashline {
            println!("--- file_hash: {file_hash}");
        }
        return Ok(());
    }

    // If truncated, warn (compare against full line count from all_lines)
    if truncated || start > 0 || selected.len() < all_lines.len() {
        eprintln!(
            "[truncated — lines {start}-{} of {}, {size}B. Use offset/limit to read more.]",
            start + selected.len(),
            all_lines.len()
        );
    }

    if hashline {
        for &line in &selected {
            let h = compute_line_hash(&line);
            println!("{h}|{line}");
        }
    } else {
        for &line in &selected {
            println!("{line}");
        }
    }

    if hashline {
        println!("--- file_hash: {file_hash}");
    }

    Ok(())
}

fn compute_line_hash(line: &str) -> String {
    // Normalize: trim trailing whitespace, keep everything else.
    let trimmed = line.trim_end();
    let hash = xxh32(trimmed.as_bytes(), 0xED17);
    encode_hash(hash)
}

/// Generic hash for file-level staleness detection.
fn compute_file_hash(lines: &[&str]) -> String {
    let mut hasher = xxhash_rust::xxh32::Xxh32::new(0xED18);
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    let hash = hasher.digest();
    encode_hash(hash)
}

fn encode_hash(hash: u32) -> String {
    let b1 = ((hash >> 18) & 0x3F) as usize;
    let b2 = ((hash >> 12) & 0x3F) as usize;
    let b3 = ((hash >> 6) & 0x3F) as usize;
    let b4 = (hash & 0x3F) as usize;
    format!(
        "{}{}{}{}",
        BASE64URL[b1] as char,
        BASE64URL[b2] as char,
        BASE64URL[b3] as char,
        BASE64URL[b4] as char,
    )
}
