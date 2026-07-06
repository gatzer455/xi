// find.rs — Find files by glob pattern, gitignore-aware.
//
// Uses `ignore::WalkBuilder` for traversal and `globset::GlobMatcher` for patterns.

use globset::Glob;
use ignore::WalkBuilder;

pub fn execute(pattern: &str, path: Option<&str>, limit: usize) -> Result<(), String> {
    let search_path = path.unwrap_or(".");
    let mut count = 0usize;

    let glob = Glob::new(pattern).map_err(|e| format!("invalid pattern: {e}"))?;
    let matcher = glob.compile_matcher();

    let mut builder = WalkBuilder::new(search_path);
    builder
        .git_ignore(true)
        .hidden(false)
        .require_git(false)
        .threads(1);

    for result in builder.build() {
        if count >= limit {
            break;
        }
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }
        // Match the full relative path against the glob
        let relative = entry
            .path()
            .strip_prefix(search_path)
            .unwrap_or(entry.path());
        if matcher.is_match(relative) {
            println!("{}", relative.display());
            count += 1;
        }
    }

    Ok(())
}
