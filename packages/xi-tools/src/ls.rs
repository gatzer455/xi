// ls.rs — List directory contents, sorted alphabetically.

use std::fs;

pub fn execute(path: Option<&str>, limit: usize) -> Result<(), String> {
    let dir = path.unwrap_or(".");
    let mut entries: Vec<String> = Vec::new();

    let dir_entries = fs::read_dir(dir).map_err(|e| format!("cannot read {dir}: {e}"))?;

    for entry in dir_entries {
        if entries.len() >= limit {
            break;
        }
        let entry = entry.map_err(|e| format!("entry error: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type().map_err(|e| format!("stat error: {e}"))?;
        if file_type.is_dir() {
            entries.push(format!("{name}/"));
        } else {
            entries.push(name);
        }
    }

    entries.sort_by(|a, b| {
        let a_is_dir = a.ends_with('/');
        let b_is_dir = b.ends_with('/');
        if a_is_dir == b_is_dir {
            a.to_lowercase().cmp(&b.to_lowercase())
        } else if a_is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    for entry in &entries {
        println!("{entry}");
    }

    Ok(())
}
