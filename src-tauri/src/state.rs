use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

use crate::cache::BitmapCache;
use crate::pdf::document::OutlineItem;
use crate::pdf::renderer::RenderPool;
use crate::pdf::PdfDocument;
use crate::search::SearchIndexer;

/// Per-document state kept in memory so tab-switching is instant.
pub struct DocumentEntry {
    pub document: Arc<PdfDocument>,
    pub indexer: Arc<SearchIndexer>,
    pub outline: Vec<OutlineItem>,
}

/// Global application state managed by Tauri
pub struct AppState {
    /// The file path of the currently active document (the one shown in the UI).
    pub active_path: RwLock<Option<String>>,
    /// All opened documents, keyed by canonical file path.
    /// Documents stay in memory until explicitly closed.
    pub documents: RwLock<HashMap<String, DocumentEntry>>,
    pub bitmap_cache: BitmapCache,
    /// Pool of permanent render worker threads — avoids TLS destruction issues
    /// that arise when using thread_local! with mupdf::Document on tokio threads.
    pub render_pool: RenderPool,
}

impl AppState {
    pub fn new() -> Self {
        // Use num_cpus capped at 4 — mupdf rendering is CPU-bound but
        // there are diminishing returns beyond 4 threads for page rendering.
        let num_threads = std::thread::available_parallelism()
            .map(|n| n.get().min(4))
            .unwrap_or(2);

        AppState {
            active_path: RwLock::new(None),
            documents: RwLock::new(HashMap::new()),
            bitmap_cache: BitmapCache::new(200),
            render_pool: RenderPool::new(num_threads),
        }
    }

    /// Helper: get the file path of the active document.
    pub fn active_file_path(&self) -> Result<String, String> {
        self.active_path
            .read()
            .clone()
            .ok_or_else(|| "No document open".to_string())
    }

    /// Helper: get the active document entry (read lock).
    pub fn active_entry_path_and_doc(&self) -> Result<(String, Arc<PdfDocument>), String> {
        let path = self.active_file_path()?;
        let docs = self.documents.read();
        let entry = docs
            .get(&path)
            .ok_or_else(|| "Active document not found in store".to_string())?;
        Ok((path, entry.document.clone()))
    }
}
