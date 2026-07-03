// edit.rs — Apply text replacements to a file.
// Reads a JSON object with an "edits" array from stdin.
// Each edit: {"oldText": "...", "newText": "..."}
// All edits must match exactly. If any oldText is not found, the file is not modified.

use serde::Deserialize;
use std::fs;
use std::io::Read;

#[derive(Deserialize)]
struct EditInput {
    edits: Vec<EditItem>,
}

#[derive(Deserialize)]
struct EditItem {
    #[serde(rename = "oldText")]
    old_text: String,
    #[serde(rename = "newText")]
    new_text: String,
}

pub fn execute(path: &str) -> Result<(), String> {
    // Leer JSON desde stdin
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| format!("failed to read stdin: {e}"))?;

    let parsed: EditInput =
        serde_json::from_str(&input).map_err(|e| format!("invalid JSON: {e}"))?;

    if parsed.edits.is_empty() {
        return Err("edits array is empty".into());
    }

    // Leer archivo original
    let mut content =
        fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;

    // Verificar que todos los oldText existen (preflight)
    for edit in &parsed.edits {
        if !content.contains(&edit.old_text) {
            let preview = if edit.old_text.len() > 200 {
                format!("{}…", &edit.old_text[..200])
            } else {
                edit.old_text.clone()
            };
            return Err(format!(
                "oldText not found in file:\n```\n{preview}\n```"
            ));
        }
    }

    // Aplicar reemplazos (cada uno solo en su primera ocurrencia)
    let mut applied = 0usize;
    for edit in &parsed.edits {
        // Solo reemplazar la primera ocurrencia (exact match principle)
        if let Some(pos) = content.find(&edit.old_text) {
            let end = pos + edit.old_text.len();
            content.replace_range(pos..end, &edit.new_text);
            applied += 1;
        }
    }

    fs::write(path, &content).map_err(|e| format!("cannot write {path}: {e}"))?;
    println!("Applied {applied} edit(s) to {path}");
    Ok(())
}
