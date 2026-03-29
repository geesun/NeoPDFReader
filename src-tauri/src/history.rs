use serde::{Deserialize, Serialize};
/// Persistent reading history: remembers the last page viewed for each file,
/// and maintains a list of recently opened files (ordered by last-opened time).
///
/// Data is stored in `{app_data_dir}/`:
///   - `history.json`:  `{ "/path/to/file.pdf": 42, ... }` (page tracking)
///   - `recent.json`:   `[{ "path": "...", "name": "...", "last_opened": epoch_secs }, ...]`
///
/// Reads and writes are synchronous (called from blocking contexts or startup).
use std::collections::HashMap;
use std::path::PathBuf;

/// A single entry in the recent files list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    /// Unix timestamp (seconds) when the file was last opened.
    pub last_opened: u64,
}

/// Maximum number of recent files to keep.
const MAX_RECENT: usize = 10;

// ── Page history ────────────────────────────────────────────────────────────

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

// ── Recent files ────────────────────────────────────────────────────────────

/// Load the recent files list from disk.
pub fn load_recent(data_dir: &PathBuf) -> Vec<RecentFile> {
    let path = data_dir.join("recent.json");
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Save the recent files list to disk.
fn save_recent(data_dir: &PathBuf, list: &[RecentFile]) {
    let path = data_dir.join("recent.json");
    if let Err(e) = std::fs::create_dir_all(data_dir) {
        log::warn!("recent: failed to create data dir: {}", e);
        return;
    }
    match serde_json::to_vec_pretty(list) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, &bytes) {
                log::warn!("recent: failed to write {}: {}", path.display(), e);
            }
        }
        Err(e) => log::warn!("recent: failed to serialize: {}", e),
    }
}

/// Record that a file was just opened.  Moves it to the front of the list
/// (or inserts it) and trims to MAX_RECENT entries.
pub fn touch_recent(data_dir: &PathBuf, file_path: &str) {
    let mut list = load_recent(data_dir);

    // Remove any existing entry for this path.
    list.retain(|r| r.path != file_path);

    // Extract just the filename for display.
    let name = std::path::Path::new(file_path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Insert at front (most recent first).
    list.insert(
        0,
        RecentFile {
            path: file_path.to_string(),
            name,
            last_opened: now,
        },
    );

    // Trim to max.
    list.truncate(MAX_RECENT);

    save_recent(data_dir, &list);
}
