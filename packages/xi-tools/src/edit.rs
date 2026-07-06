// edit.rs — Exact text replacement with fuzzy matching.
//
// Reads a JSON object from stdin:
//   {"edits": [{"oldText": "before", "newText": "after"}]}
//
// Writes JSON to stdout on success:
//   {"content": "Successfully replaced N block(s) in path.",
//    "details": {"diff": "...", "patch": "...", "firstChangedLine": 1}}
//
// Writes to stderr + exit 1 on error.
//
// Design (inspired by Claude Code's Edit tool):
//   • Position-independent: locates by content, not line numbers
//   • Uniqueness constraint: oldText must match exactly once
//   • Fuzzy fallback: normalizes Unicode quotes/dashes/spaces
//   • CRLF/BOM preservation: restores original file format

use serde::{Deserialize, Serialize};
use std::fmt::Write;
use std::fs;
use std::io::Read;

// ── Input ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct EditInput {
    edits: Vec<EditOp>,
}

#[derive(Deserialize)]
struct EditOp {
    #[serde(rename = "oldText")]
    old_text: String,
    #[serde(rename = "newText")]
    new_text: String,
}

// ── Output ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct EditResult {
    content: String,
    details: EditDetails,
}

#[derive(Serialize)]
struct EditDetails {
    diff: String,
    patch: String,
    #[serde(rename = "firstChangedLine")]
    first_changed_line: Option<usize>,
}

// ── Fuzzy matching helpers ───────────────────────────────────────────────
// Ported from pi's edit-diff.js normalizeForFuzzyMatch()
// The LLM often uses smart quotes, em-dashes, or non-breaking spaces that
// look like ASCII but aren't. We normalize both the file content and the
// oldText before matching, then apply replacements against the original.

/// Normalize text for fuzzy matching:
/// 1. Strip trailing whitespace per line
/// 2. Smart quotes → ASCII
/// 3. Unicode dashes/hyphens → ASCII hyphen
/// 4. Special Unicode spaces → regular space
fn fuzzy_normalize(text: &str) -> String {
    let mut result = String::with_capacity(text.len());

    for ch in text.chars() {
        match ch {
            // Smart single quotes → '
            '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => result.push('\''),
            // Smart double quotes → "
            '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => result.push('"'),
            // Various dashes/hyphens → -
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}'
            | '\u{2014}' | '\u{2015}' | '\u{2212}' => result.push('-'),
            // Special spaces → regular space
            '\u{00A0}' | '\u{2002}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => {
                result.push(' ')
            }
            // Keep everything else as-is
            _ => result.push(ch),
        }
    }

    // Strip trailing whitespace per line
    let lines: Vec<&str> = result
        .split('\n')
        .map(|line| line.trim_end())
        .collect();
    lines.join("\n")
}

// ── Line ending / BOM ────────────────────────────────────────────────────

fn detect_line_ending(content: &str) -> &str {
    if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn strip_bom(content: &str) -> &str {
    content.strip_prefix('\u{FEFF}').unwrap_or(content)
}

fn normalize_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n")
}

fn restore_line_endings(content: &str, ending: &str) -> String {
    if ending == "\r\n" {
        content.replace('\n', "\r\n")
    } else {
        content.to_string()
    }
}

// ── Match resolution ─────────────────────────────────────────────────────

struct Match {
    index: usize,
    length: usize,
}

/// Find old_text in content. Exact match first, then fuzzy.
fn find_match(content: &str, fuzzy_content: &str, old_text: &str) -> Option<Match> {
    // 1. Exact match
    if let Some(pos) = content.find(old_text) {
        return Some(Match {
            index: pos,
            length: old_text.len(),
        });
    }

    // 2. Fuzzy match — both sides normalized
    let fuzzy_old = fuzzy_normalize(old_text);
    if let Some(pos) = fuzzy_content.find(&fuzzy_old) {
        return Some(Match {
            index: pos,
            length: fuzzy_old.len(),
        });
    }

    None
}

/// Count occurrences (for uniqueness check)
fn count_occurrences(content: &str, old_text: &str) -> usize {
    let fuzzy_content = fuzzy_normalize(content);
    let fuzzy_old = fuzzy_normalize(old_text);
    fuzzy_content.split(&fuzzy_old).count().saturating_sub(1)
}

// ── Diff generation ──────────────────────────────────────────────────────

/// Simple human-readable diff with context (like pi's generateDiffString)
fn generate_diff(old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.split('\n').collect();
    let new_lines: Vec<&str> = new.split('\n').collect();
    let max_line = old_lines.len().max(new_lines.len());
    let line_width = max_line.to_string().len();

    let mut out = String::new();
    let mut old_idx = 0usize;
    let mut new_idx = 0usize;
    let mut in_hunk = false;

    while old_idx < old_lines.len() || new_idx < new_lines.len() {
        let o = old_lines.get(old_idx).copied().unwrap_or("");
        let n = new_lines.get(new_idx).copied().unwrap_or("");

        if o != n {
            if !in_hunk {
                let ctx_start = old_idx.max(1).saturating_sub(2);
                let ctx_end = (old_idx + 3).min(old_lines.len().max(new_lines.len()));
                writeln!(out, "@@ -{},{} +{},{} @@", ctx_start + 1, ctx_end - ctx_start, ctx_start + 1, ctx_end - ctx_start).ok();
                // Context lines before change
                for j in ctx_start..old_idx {
                    let line = old_lines.get(j).copied().unwrap_or("");
                    let num = format!("{:width$}", j + 1, width = line_width);
                    writeln!(out, " {} {}", num, line).ok();
                }
                in_hunk = true;
            }
            if old_idx < old_lines.len() {
                let num = format!("{:width$}", old_idx + 1, width = line_width);
                writeln!(out, "-{} {}", num, o).ok();
                old_idx += 1;
            }
            if new_idx < new_lines.len() {
                let num = format!("{:width$}", new_idx + 1, width = line_width);
                writeln!(out, "+{} {}", num, n).ok();
                new_idx += 1;
            }
        } else {
            if in_hunk {
                let num = format!("{:width$}", old_idx + 1, width = line_width);
                writeln!(out, " {} {}", num, o).ok();
                // Print up to 3 context lines, then close hunk
                let end = (old_idx + 1 + 3).min(old_lines.len());
                let mut _ctx_count = 0usize;
                for j in old_idx + 1..end {
                    let o2 = old_lines.get(j).copied().unwrap_or("");
                    let n2 = new_lines.get(j).copied().unwrap_or("");
                    if o2 == n2 {
                        let num2 = format!("{:width$}", j + 1, width = line_width);
                        writeln!(out, " {} {}", num2, o2).ok();
                        old_idx = j;
                        new_idx = j;
                        _ctx_count += 1;
                    } else {
                        break;
                    }
                }
                old_idx += 1;
                new_idx += 1;
                in_hunk = false;
            } else {
                old_idx += 1;
                new_idx += 1;
            }
        }
    }

    out.trim_end().to_string()
}

/// Standard unified patch (like pi's generateUnifiedPatch)
fn generate_patch(path: &str, old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.split('\n').collect();
    let new_lines: Vec<&str> = new.split('\n').collect();
    let mut out = format!("--- {}\n+++ {}\n", path, path);

    // Build hunks
    let mut hunks: Vec<(usize, usize, Vec<String>)> = Vec::new();
    let mut hunk_lines: Vec<String> = Vec::new();
    let mut hunk_start_old = 0usize;
    let mut hunk_start_new = 0usize;
    let mut ctx_count = 0usize;
    let mut old_i = 0usize;
    let mut new_i = 0usize;
    let _max = old_lines.len().max(new_lines.len());

    while old_i < old_lines.len() || new_i < new_lines.len() {
        let o = old_lines.get(old_i).copied().unwrap_or("");
        let n = new_lines.get(new_i).copied().unwrap_or("");

        if o != n {
            if hunk_lines.is_empty() {
                hunk_start_old = old_i.saturating_sub(3);
                hunk_start_new = new_i.saturating_sub(3);
                // Print context lines before
                for j in hunk_start_old..old_i {
                    hunk_lines.push(format!(" {}", old_lines[j]));
                }
            }
            if old_i < old_lines.len() {
                hunk_lines.push(format!("-{}", o));
                old_i += 1;
            }
            if new_i < new_lines.len() {
                hunk_lines.push(format!("+{}", n));
                new_i += 1;
            }
        } else {
            if !hunk_lines.is_empty() {
                if ctx_count < 3 {
                    hunk_lines.push(format!(" {}", o));
                    ctx_count += 1;
                } else {
                    // Close hunk
                    let hunk_old_len = old_i - hunk_start_old;
                    let hunk_new_len = new_i - hunk_start_new;
                    writeln!(out, "@@ -{},{} +{},{} @@",
                        hunk_start_old + 1, hunk_old_len + 1,
                        hunk_start_new + 1, hunk_new_len + 1).ok();
                    for line in &hunk_lines {
                        writeln!(out, "{}", line).ok();
                    }
                    hunks.push((hunk_start_old, hunk_start_new, std::mem::take(&mut hunk_lines)));
                }
            }
            old_i += 1;
            new_i += 1;
        }
    }

    // Close final hunk if open
    if !hunk_lines.is_empty() {
        let hunk_old_len = old_i - hunk_start_old;
        let hunk_new_len = new_i - hunk_start_new;
        writeln!(out, "@@ -{},{} +{},{} @@",
            hunk_start_old + 1, hunk_old_len + 1,
            hunk_start_new + 1, hunk_new_len + 1).ok();
        for line in &hunk_lines {
            writeln!(out, "{}", line).ok();
        }
    }

    out.trim_end().to_string()
}

// ── Main entry point ─────────────────────────────────────────────────────

pub fn execute(path: &str) -> Result<(), String> {
    // Read stdin
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| format!("failed to read stdin: {e}"))?;

    let parsed: EditInput =
        serde_json::from_str(&input).map_err(|e| format!("invalid JSON: {e}"))?;

    let file_path = if path.is_empty() { path } else { path };

    // 1. Read file
    let raw = fs::read_to_string(file_path).map_err(|e| format!("cannot read {file_path}: {e}"))?;

    // 2. Preserve BOM
    let has_bom = raw.starts_with('\u{FEFF}');
    let content = strip_bom(&raw);

    // 3. Preserve line ending style
    let line_ending = detect_line_ending(content);

    // 4. Normalize for matching
    let normalized = normalize_line_endings(content);

    // 5. Fuzzy-match content for lookups
    let fuzzy_normalized = fuzzy_normalize(&normalized);

    // 6. Preflight: validate all edits
    for (i, edit) in parsed.edits.iter().enumerate() {
        if edit.old_text.is_empty() {
            return Err(format!(
                "edits[{i}]: oldText must not be empty in {file_path}."
            ));
        }

        let m = find_match(&normalized, &fuzzy_normalized, &edit.old_text);
        match m {
            None => {
                let preview = if edit.old_text.len() > 200 {
                    format!("{}...", &edit.old_text[..200])
                } else {
                    edit.old_text.clone()
                };
                return Err(format!(
                    "edits[{i}]: oldText not found in {file_path}.\n\
                     Provide the exact text to replace, including surrounding context.\n\
                     ```\n{preview}\n```"
                ));
            }
            Some(_) => {
                let count = count_occurrences(&normalized, &edit.old_text);
                if count > 1 {
                    return Err(format!(
                        "edits[{i}]: oldText appears {count} times in {file_path}. \
                         The text must be unique — add more surrounding context.",
                    ));
                }
            }
        }
    }

    // 7. Resolve match positions in normalized space
    struct Resolved {
        index: usize,
        length: usize,
        new_text: String,
        _used_fuzzy: bool,
    }

    let mut resolved: Vec<Resolved> = Vec::new();
    for edit in &parsed.edits {
        let m = find_match(&normalized, &fuzzy_normalized, &edit.old_text)
            .expect("preflight passed");
        resolved.push(Resolved {
            index: m.index,
            length: m.length,
            new_text: normalize_line_endings(&edit.new_text),
            _used_fuzzy: normalized[m.index..m.index + m.length] != *edit.old_text,
        });
    }

    // 8. Sort by position, check overlap
    resolved.sort_by_key(|r| r.index);
    for i in 1..resolved.len() {
        let prev_end = resolved[i - 1].index + resolved[i - 1].length;
        if prev_end > resolved[i].index {
            return Err(format!(
                "edits[{}] overlaps with edits[{}] in {file_path}. \
                 Merge them into one edit or target disjoint regions.",
                i - 1, i
            ));
        }
    }

    // 9. Apply in reverse order to maintain offsets
    let mut result = normalized.clone();
    // Track line number for first_changed_line
    let first_line = resolved.first().map(|r| {
        normalized[..r.index].chars().filter(|&c| c == '\n').count() + 1
    });

    for r in resolved.iter().rev() {
        result.replace_range(r.index..r.index + r.length, &r.new_text);
    }

    // 10. Check nothing changed
    if result == normalized {
        return Err(format!(
            "No changes made to {file_path}. The replacement produced identical content."
        ));
    }

    // 11. Restore line endings and BOM, write file
    let final_content = restore_line_endings(&result, line_ending);
    let final_content = if has_bom {
        format!("\u{FEFF}{}", final_content)
    } else {
        final_content
    };

    fs::write(file_path, &final_content)
        .map_err(|e| format!("cannot write {file_path}: {e}"))?;

    // 12. Generate diff and patch
    let diff = generate_diff(&normalized, &result);
    let patch = generate_patch(file_path, &normalized, &result);

    // 13. Output JSON result
    let plural = if parsed.edits.len() == 1 { "" } else { "s" };
    let output = EditResult {
        content: format!(
            "Successfully replaced {} block{} in {}.",
            parsed.edits.len(),
            plural,
            file_path
        ),
        details: EditDetails {
            diff,
            patch,
            first_changed_line: first_line,
        },
    };

    println!(
        "{}",
        serde_json::to_string(&output).map_err(|e| format!("JSON: {e}"))?
    );

    Ok(())
}
