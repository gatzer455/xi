// read.rs — Read file contents with optional offset/limit.
// Supports text files (UTF-8) and images (png, jpg, gif, webp, bmp).
// Images are returned as JSON: {"_type":"image","mimeType":"...","data":"base64..."}

use std::fs;
use std::io::Read;
use base64::Engine;

const IMAGE_MIME_PNG: &str = "image/png";
const IMAGE_MIME_JPEG: &str = "image/jpeg";
const IMAGE_MIME_GIF: &str = "image/gif";
const IMAGE_MIME_WEBP: &str = "image/webp";
const IMAGE_MIME_BMP: &str = "image/bmp";

/// Supported image extensions
fn is_image_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
}

/// Detect image MIME type from magic bytes. Returns None if not a known image.
fn detect_mime_from_magic(path: &str) -> Option<&'static str> {
    let mut file = fs::File::open(path).ok()?;

    // Read enough bytes for all supported formats (WebP needs 12)
    let mut buf = [0u8; 12];
    file.read_exact(&mut buf).ok()?;

    // Read remaining bytes if needed (we already have 12)
    match &buf {
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ..] => Some(IMAGE_MIME_PNG),
        // JPEG: FF D8 FF
        [0xFF, 0xD8, 0xFF, ..] => Some(IMAGE_MIME_JPEG),
        // GIF87a: GIF87a
        [0x47, 0x49, 0x46, 0x38, 0x37, 0x61, ..] => Some(IMAGE_MIME_GIF),
        // GIF89a: GIF89a
        [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ..] => Some(IMAGE_MIME_GIF),
        // BMP: BM
        [0x42, 0x4D, ..] => Some(IMAGE_MIME_BMP),
        // WebP: RIFF .... WEBP
        // buf[0..4] = "RIFF", buf[4..8] = file size, buf[8..12] = "WEBP"
        [0x52, 0x49, 0x46, 0x46, _, _, _, _, 0x57, 0x45, 0x42, 0x50] => Some(IMAGE_MIME_WEBP),
        _ => None,
    }
}

/// Read an image file and output JSON with base64-encoded data.
fn read_image(path: &str, mime: &str) -> Result<(), String> {
    let data = fs::read(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);

    // Single JSON line — TypeScript wrapper parses this
    let output = serde_json::json!({
        "_type": "image",
        "mimeType": mime,
        "data": encoded,
    });
    println!("{output}");
    Ok(())
}

pub fn execute(
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<(), String> {
    // Check if it's an image by extension + magic bytes
    if is_image_extension(path) {
        if let Some(mime) = detect_mime_from_magic(path) {
            return read_image(path, mime);
        }
        // Has image extension but magic bytes don't match — fall through
        // to text reading, which will fail with a UTF-8 error.
    }

    let mut file = fs::File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let mut content = String::new();
    let size = file
        .read_to_string(&mut content)
        .map_err(|e| format!("cannot read {path}: {e}"))?;

    let total_lines = content.lines().count();
    let max_bytes: usize = 50 * 1024;
    let truncated = size > max_bytes;
    if truncated {
        content.truncate(max_bytes);
    }

    let display_lines: Vec<&str> = content.lines().collect();
    let start = offset.unwrap_or(0);
    let max = limit.unwrap_or(2000);
    let selected: Vec<&&str> = display_lines.iter().skip(start).take(max).collect();

    if selected.is_empty() {
        println!("(empty file)");
        return Ok(());
    }

    if truncated || start > 0 || selected.len() < total_lines {
        eprintln!(
            "[truncated — lines {start}-{} of {total_lines}, {size}B. Use offset/limit to read more.]",
            start + selected.len(),
        );
    }

    for line in selected {
        println!("{line}");
    }

    Ok(())
}
