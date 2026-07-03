// grep.rs — Search file contents with regex, gitignore-aware.
//
// Uses `regex` for pattern matching and `ignore::WalkBuilder` for traversal.
// Supports optional --context for surrounding lines.

use globset::Glob;
use ignore::WalkBuilder;
use regex::Regex;
use std::fs::File;
use std::io::{BufRead, BufReader};

pub fn execute(
    pattern: &str,
    path: Option<&str>,
    glob: Option<&str>,
    ignore_case: bool,
    literal: bool,
    context: Option<usize>,
    limit: usize,
) -> Result<(), String> {
    let ctx = context.unwrap_or(0);
    let re_str = if literal {
        regex::escape(pattern)
    } else {
        pattern.to_string()
    };
    let re_str = if ignore_case {
        format!("(?i){re_str}")
    } else {
        re_str
    };
    let re = Regex::new(&re_str).map_err(|e| format!("invalid pattern: {e}"))?;

    // Compile glob matcher if provided
    let glob_matcher = if let Some(g) = glob {
        Some(
            Glob::new(g)
                .map_err(|e| format!("invalid glob '{g}': {e}"))?
                .compile_matcher(),
        )
    } else {
        None
    };

    let search_path = path.unwrap_or(".");
    let mut matches = 0usize;

    let mut builder = WalkBuilder::new(search_path);
    builder
        .git_ignore(true)
        .hidden(false)
        .require_git(false)
        .threads(1);

    for result in builder.build() {
        if matches >= limit {
            break;
        }
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }

        let file_path = entry.path();

        // Apply glob filter to relative path
        if let Some(ref matcher) = glob_matcher {
            let relative = file_path
                .strip_prefix(search_path)
                .unwrap_or(file_path);
            if !matcher.is_match(relative) {
                continue;
            }
        }

        let file = match File::open(file_path) {
            Ok(f) => f,
            Err(e) => {
                eprintln!("grep: cannot open {}: {e}", file_path.display());
                continue;
            }
        };

        if ctx > 0 {
            // Context mode: load entire file into memory
            let lines: Vec<String> = BufReader::new(file)
                .lines()
                .filter_map(|l| l.ok())
                .collect();
            let mut last_printed = 0usize;
            for (i, line) in lines.iter().enumerate() {
                if matches >= limit {
                    break;
                }
                if re.is_match(line) {
                    let start = i.saturating_sub(ctx);
                    let end = (i + ctx + 1).min(lines.len());
                    if start > last_printed && last_printed > 0 {
                        println!("--");
                    }
                    for j in start..end {
                        if j < last_printed {
                            continue;
                        }
                        println!("{}:{}:{}", file_path.display(), j + 1, lines[j]);
                    }
                    last_printed = end;
                    matches += 1;
                }
            }
        } else {
            // No context: stream line by line (more memory efficient)
            let reader = BufReader::new(file);
            for (line_num, line_res) in reader.lines().enumerate() {
                if matches >= limit {
                    break;
                }
                let line = match line_res {
                    Ok(l) => l,
                    Err(e) => {
                        eprintln!("grep: read error in {}: {e}", file_path.display());
                        break;
                    }
                };
                if re.is_match(&line) {
                    println!("{}:{}:{}", file_path.display(), line_num + 1, line);
                    matches += 1;
                }
            }
        }
    }

    Ok(())
}
