// read.rs — Read file contents with optional hashline annotations.
//
// When --hashline is set, each line is prefixed with a 4-char content hash:
//   aB3x|fn main() {
//   xYz9|    let x = 1;
//
// Hash: xxhash32(normalized line) → 4-char base64url (24-bit entropy).
// This enables hash-anchored editing with zero ambiguity.

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
    // Truncation warning
    let max_bytes = 50 * 1024;
    if size > max_bytes {
        content.truncate(max_bytes);
        let trunc_note = format!(
            "\n[truncated — {size} bytes total, showing first {max_bytes} bytes. Use offset/limit to read more.]"
        );
        content.push_str(&trunc_note);
    }

    let all_lines: Vec<&str> = content.lines().collect();
    let start = offset.unwrap_or(0);
    let max = limit.unwrap_or(2000);
    let selected: Vec<&str> = all_lines.iter().skip(start).take(max).copied().collect();

    // File hash (for stale detection on edits)
    let file_hash = compute_file_hash(&all_lines);

    if selected.is_empty() {
        println!("(empty file)");
        if hashline {
            println!("--- file_hash: {file_hash}");
        }
        return Ok(());
    }

    // If truncated, warn
    if start > 0 || selected.len() < all_lines.len() {
        eprintln!(
            "[truncated — lines {start}-{} of {}, {size}B. Use offset/limit to read more.]",
            start + selected.len(),
            all_lines.len()
        );
    }

    for (i, line) in selected.iter().enumerate() {
        let line_num = start + i + 1;
        if hashline {
            let hash = compute_line_hash(line_num, line);
            println!("{hash}|{line_num}|{line}");
        } else {
            println!("{line}");
        }
    }

    if hashline {
        println!("--- file_hash: {file_hash}");
    }

    Ok(())
}

/// Compute a file-level hash over normalized lines (used for stale detection).
pub fn compute_file_hash(lines: &[&str]) -> String {
    let mut hasher = xxhash_rust::xxh32::Xxh32::new(0);
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    let hash = hasher.digest();
    hash_to_base64url(hash)
}

/// Compute a 4-char hash for a single line (used for hash-anchored editing).
pub fn compute_line_hash(line_num: usize, content: &str) -> String {
    // Normalize: trim trailing whitespace, normalize whitespace to single spaces
    let normalized = normalize_line(content);
    // Use line number as discriminator for repeated content
    let input = format!("L{line_num}:{normalized}");
    let hash = xxh32(input.as_bytes(), 0);
    hash_to_base64url(hash)
}

/// Normalize a line for hashing: trim trailing whitespace.
fn normalize_line(line: &str) -> String {
    line.trim_end().to_string()
}

/// Encode a 32-bit hash as 4-char URL-safe base64.
fn hash_to_base64url(hash: u32) -> String {
    let mut out = String::with_capacity(4);
    for i in 0..4 {
        let idx = ((hash >> (18 - i * 6)) & 0x3F) as usize;
        out.push(BASE64URL[idx] as char);
    }
    out
}
