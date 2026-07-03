// write.rs — Write content to a file, creating parent directories.
// Content is read from stdin.

use std::fs;
use std::io::Read;
use std::path::Path;

pub fn execute(path: &str) -> Result<(), String> {
    let mut content = String::new();
    std::io::stdin()
        .read_to_string(&mut content)
        .map_err(|e| format!("failed to read stdin: {e}"))?;

    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create parent dir {}: {e}", parent.display()))?;
    }

    fs::write(p, &content).map_err(|e| format!("cannot write {path}: {e}"))?;
    println!("Wrote {} bytes to {path}", content.len());
    Ok(())
}
