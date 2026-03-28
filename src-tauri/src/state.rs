use parking_lot::RwLock;
use std::sync::Arc;

use crate::cache::BitmapCache;
use crate::pdf::document::OutlineItem;
use crate::pdf::renderer::RenderPool;
use crate::pdf::PdfDocument;
use crate::search::SearchIndexer;

/// Global application state managed by Tauri
pub struct AppState {
    pub document: RwLock<Option<Arc<PdfDocument>>>,
    pub indexer: RwLock<Option<Arc<SearchIndexer>>>,
    pub bitmap_cache: BitmapCache,
    /// Cached outline (bookmarks) for the currently open document.
    /// Populated during open_pdf — reading it is instant, no extra Document::open.
    pub outline: RwLock<Vec<OutlineItem>>,
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
            document: RwLock::new(None),
            indexer: RwLock::new(None),
            bitmap_cache: BitmapCache::new(200),
            outline: RwLock::new(Vec::new()),
            render_pool: RenderPool::new(num_threads),
        }
    }
}
