// edit.rs — Hash-anchored file editing for LLM agents.
//
// Reads a JSON object from stdin. Supports two formats:
//
// 1. Hashline (new): uses content hashes to target lines. No text matching needed.
//    {"path": "...", "file_hash": "aB3c", "edits": [
//      {"op": "replace", "start_hash": "aB3x", "end_hash": "aB3x", "lines": ["new"]},
//      {"op": "delete", "start_hash": "xYz9", "end_hash": "pQr1"},
//      {"op": "insert_after", "hash": "jK5e", "lines": ["added"]}
//    ]}
//
// 2. Legacy (pi-compatible): uses oldText/newText matching.
//    {"path": "...", "edits": [{"oldText": "...", "newText": "..."}]}
//
// The hashline approach eliminates the main LLM edit failure modes:
//   - No ambiguity: content hashes are unique per line
//   - Stale detection: file_hash mismatch → immediate rejection
//   - No text matching: the LLM doesn't need to reproduce old text exactly

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use xxhash_rust::xxh32::xxh32;

#[derive(Deserialize)]
struct EditInput {
    path: String,
    #[serde(rename = "file_hash")]
    file_hash: Option<String>,
    edits: Vec<EditOp>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum EditOp {
    Hashline {
        op: String,
        #[serde(rename = "start_hash")]
        start_hash: Option<String>,
        #[serde(rename = "end_hash")]
        end_hash: Option<String>,
        hash: Option<String>,
        lines: Option<Vec<String>>,
    },
    Legacy {
        #[serde(rename = "oldText")]
        old_text: String,
        #[serde(rename = "newText")]
        new_text: String,
    },
}

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn execute(path: &str) -> Result<(), String> {
    // Read JSON from stdin
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| format!("failed to read stdin: {e}"))?;

    let parsed: EditInput =
        serde_json::from_str(&input).map_err(|e| format!("invalid JSON: {e}"))?;

    let file_path = if parsed.path.is_empty() {
        path
    } else {
        &parsed.path
    };
    let file_path = if file_path.is_empty() {
        path
    } else {
        file_path
    };

    // Detect format: reject mixed batches (silent data loss otherwise)
    let has_legacy = parsed
        .edits
        .iter()
        .any(|e| matches!(e, EditOp::Legacy { .. }));
    let has_hashline = parsed
        .edits
        .iter()
        .any(|e| matches!(e, EditOp::Hashline { .. }));

    if has_legacy && has_hashline {
        return Err(
            "No mezcles ediciones legacy (oldText/newText) y hashline en la misma petición.".into(),
        );
    }

    if has_legacy {
        return execute_legacy(file_path, &parsed.edits);
    }

    execute_hashline(file_path, &parsed.file_hash, &parsed.edits)
}

// ── Hashline editing ───────────────────────────────────────────────────────

fn execute_hashline(
    path: &str,
    file_hash: &Option<String>,
    edits: &[EditOp],
) -> Result<(), String> {
    let content = fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    // Detect line ending style — preserve CRLF on Windows
    let line_ending = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

    // Verify file hash
    if let Some(expected_hash) = file_hash {
        let actual_hash = file_hash_for(&lines);
        if actual_hash != *expected_hash {
            return Err(format!(
                "⚠️  STALE EDIT — el archivo cambió desde que lo leíste.\n\
                 file_hash esperado: {expected_hash}\n\
                 file_hash actual:   {actual_hash}\n\
                 Vuelve a leer el archivo con read --hashline y usa el nuevo file_hash."
            ));
        }
    }

    // Build line_hash → line_number map
    let mut hash_to_line: HashMap<String, usize> = HashMap::new();
    for (i, line) in lines.iter().enumerate() {
        let h = compute_line_hash(i + 1, line);
        if hash_to_line.contains_key(&h) {
            return Err(format!(
                "edits: colisión de hash en línea {} — el hash '{}' ya existe.                  Archivo demasiado corto o líneas idénticas.",
                i + 1, h
            ));
        }
        hash_to_line.insert(h, i);
    }

    // Parse and validate edits
    struct ResolvedEdit {
        op: String,
        start_line: usize, // 0-indexed
        end_line: usize,   // 0-indexed, inclusive
        insert_after: bool,
        new_lines: Vec<String>,
    }

    let mut resolved: Vec<ResolvedEdit> = Vec::new();
    for (idx, edit) in edits.iter().enumerate() {
        match edit {
            EditOp::Hashline {
                op,
                start_hash,
                end_hash,
                hash,
                lines: new_lines,
            } => {
                let new_lines = new_lines.clone().unwrap_or_default();
                match op.as_str() {
                    "replace" => {
                        let start = start_hash
                            .as_ref()
                            .and_then(|h| hash_to_line.get(h))
                            .copied()
                            .ok_or_else(|| {
                                format!(
                                    "edits[{idx}]: start_hash '{}' no encontrado en el archivo. \
                                     ¿Usaste el file_hash correcto?",
                                    start_hash.as_deref().unwrap_or("?")
                                )
                            })?;
                        let end = match end_hash.as_ref().and_then(|h| hash_to_line.get(h)).copied()
                        {
                            Some(e) => e,
                            None => {
                                if end_hash.is_some() {
                                    return Err(format!(
                                        "edits[{idx}]: end_hash '{}' no encontrado en el archivo.                                          Vuelve a leer el archivo con read --hashline.",
                                        end_hash.as_deref().unwrap_or("?")
                                    ));
                                }
                                start
                            }
                        };
                        resolved.push(ResolvedEdit {
                            op: "replace".into(),
                            start_line: start,
                            end_line: end,
                            insert_after: false,
                            new_lines,
                        });
                    }
                    "delete" => {
                        let start = start_hash
                            .as_ref()
                            .and_then(|h| hash_to_line.get(h))
                            .copied()
                            .ok_or_else(|| {
                                format!(
                                    "edits[{idx}]: start_hash '{}' no encontrado",
                                    start_hash.as_deref().unwrap_or("?")
                                )
                            })?;
                        let end = match end_hash.as_ref().and_then(|h| hash_to_line.get(h)).copied()
                        {
                            Some(e) => e,
                            None => {
                                if end_hash.is_some() {
                                    return Err(format!(
                                        "edits[{idx}]: end_hash '{}' no encontrado en el archivo.                                          Vuelve a leer el archivo con read --hashline.",
                                        end_hash.as_deref().unwrap_or("?")
                                    ));
                                }
                                start
                            }
                        };
                        resolved.push(ResolvedEdit {
                            op: "delete".into(),
                            start_line: start,
                            end_line: end,
                            insert_after: false,
                            new_lines: vec![],
                        });
                    }
                    "insert_after" | "insert_before" => {
                        let target_hash = hash.as_ref().ok_or_else(|| {
                            format!("edits[{idx}]: falta 'hash' para insert_after/insert_before")
                        })?;
                        let target = hash_to_line.get(target_hash).copied().ok_or_else(|| {
                            format!("edits[{idx}]: hash '{target_hash}' no encontrado")
                        })?;
                        resolved.push(ResolvedEdit {
                            op: "insert".into(),
                            start_line: target,
                            end_line: target,
                            insert_after: op == "insert_after",
                            new_lines,
                        });
                    }
                    other => {
                        return Err(format!("edits[{idx}]: operación '{other}' no soportada. Usa: replace, delete, insert_after, insert_before"));
                    }
                }
            }
            _ => unreachable!(),
        }
    }

    // Sort edits by position (reverse for safe application)
    resolved.sort_by(|a, b| b.start_line.cmp(&a.start_line));

    // Apply edits
    let mut result = lines;
    for edit in &resolved {
        match edit.op.as_str() {
            "replace" => {
                result.splice(edit.start_line..=edit.end_line, edit.new_lines.clone());
            }
            "delete" => {
                result.splice(edit.start_line..=edit.end_line, std::iter::empty());
            }
            "insert" => {
                let pos = if edit.insert_after {
                    edit.start_line + 1
                } else {
                    edit.start_line
                };
                for (i, line) in edit.new_lines.iter().enumerate() {
                    result.insert(pos + i, line.clone());
                }
            }
            _ => {}
        }
    }

    // Write result (preserve line endings and trailing newline)
    let mut output = result.join(line_ending);
    if content.ends_with(line_ending) {
        output.push_str(line_ending);
    }
    if output == content {
        return Err("No changes made — el resultado es idéntico al original.".into());
    }
    fs::write(path, &output).map_err(|e| format!("cannot write {path}: {e}"))?;

    // Show new hashes for changed region
    let new_file_hash = file_hash_for(&result);
    println!("Applied {} edit(s) to {path}", resolved.len());
    println!("--- new file_hash: {new_file_hash}");

    Ok(())
}

// ── Legacy editing (pi-compatible) ─────────────────────────────────────────

fn execute_legacy(path: &str, edits: &[EditOp]) -> Result<(), String> {
    let mut content = fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;

    // Extract legacy edits
    let legacy_edits: Vec<(&str, &str)> = edits
        .iter()
        .filter_map(|e| match e {
            EditOp::Legacy { old_text, new_text } => Some((old_text.as_str(), new_text.as_str())),
            _ => None,
        })
        .collect();

    // Preflight: all oldText must exist and be unique
    for (i, (old, _)) in legacy_edits.iter().enumerate() {
        if old.is_empty() {
            return Err(format!("edits[{i}]: oldText no puede estar vacío"));
        }
        if !content.contains(*old) {
            let preview = if old.len() > 200 {
                format!("{}…", &old[..200])
            } else {
                old.to_string()
            };
            return Err(format!(
                "edits[{i}]: oldText no encontrado en {path}.\n```\n{preview}\n```\n\
                 Sugerencia: usa read --hashline para obtener hashes y el nuevo formato de edit."
            ));
        }
        let count = content.matches(*old).count();
        if count > 1 {
            return Err(format!(
                "edits[{i}]: oldText aparece {count} veces en {path}. Debe ser único.\n\
                 Agrega más contexto o usa read --hashline + formato hashline."
            ));
        }
    }

    // Apply replacements (reverse order to preserve offsets)
    let mut applied = 0;
    for (old, new) in &legacy_edits {
        if let Some(pos) = content.find(*old) {
            let end = pos + old.len();
            content.replace_range(pos..end, new);
            applied += 1;
        }
    }

    fs::write(path, &content).map_err(|e| format!("cannot write {path}: {e}"))?;
    println!("Applied {applied} edit(s) to {path}");

    // Offer hashline migration hint
    let lines: Vec<&str> = content.lines().collect();
    let fh = file_hash_for_strs(&lines);
    println!("--- hint: usa read --hashline para edición más confiable (file_hash: {fh})");

    Ok(())
}

// ── Hashing helpers ────────────────────────────────────────────────────────

fn compute_line_hash(line_num: usize, content: &str) -> String {
    let normalized = content.trim_end();
    let input = format!("L{line_num}:{normalized}");
    let hash = xxh32(input.as_bytes(), 0);
    hash_to_base64url(hash)
}

fn file_hash_for(lines: &[String]) -> String {
    let strs: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    file_hash_for_strs(&strs)
}

fn file_hash_for_strs(lines: &[&str]) -> String {
    let mut hasher = xxhash_rust::xxh32::Xxh32::new(0);
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    hash_to_base64url(hasher.digest())
}

fn hash_to_base64url(hash: u32) -> String {
    let mut out = String::with_capacity(4);
    for i in 0..4 {
        let idx = ((hash >> (18 - i * 6)) & 0x3F) as usize;
        out.push(BASE64URL[idx] as char);
    }
    out
}
