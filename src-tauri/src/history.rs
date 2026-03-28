/// Persistent reading history: remembers the last page viewed for each file.
///
/// Data is stored in `{app_data_dir}/history.json` as a flat JSON object:
///   { "/path/to/file.pdf": 42, ... }
///
/// Reads and writes are synchronous (called from blocking contexts or startup).
/// The file is small (one entry per opened PDF) so locking is not needed.
use std::collections::HashMap;
use std::path::PathBuf;

/// Load the history map from disk.  Returns an empty map on any error
/// (missing file, parse failure, etc.) so callers never need to handle errors.
pub fn load(data_dir: &PathBuf) -> HashMap<String, usize> {
    let path = data_dir.join("history.json");
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Persist the history map to disk.  Errors are logged but not propagated.
pub fn save(data_dir: &PathBuf, map: &HashMap<String, usize>) {
    let path = data_dir.join("history.json");
    // Ensure the directory exists
    if let Err(e) = std::fs::create_dir_all(data_dir) {
        log::warn!("history: failed to create data dir: {}", e);
        return;
    }
    match serde_json::to_vec(map) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, &bytes) {
                log::warn!("history: failed to write {}: {}", path.display(), e);
            }
        }
        Err(e) => log::warn!("history: failed to serialize: {}", e),
    }
}

/// Get the last page for a given file path.  Returns 0 if not found.
pub fn get_last_page(data_dir: &PathBuf, file_path: &str) -> usize {
    load(data_dir).get(file_path).copied().unwrap_or(0)
}

/// Update the last page for a given file path and persist immediately.
pub fn set_last_page(data_dir: &PathBuf, file_path: &str, page: usize) {
    let mut map = load(data_dir);
    map.insert(file_path.to_string(), page);
    save(data_dir, &map);
}
