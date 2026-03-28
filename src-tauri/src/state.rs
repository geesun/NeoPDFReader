use parking_lot::RwLock;
use std::sync::Arc;

use crate::cache::BitmapCache;
use crate::pdf::renderer::RenderPool;
use crate::pdf::PdfDocument;
use crate::search::SearchIndexer;

/// Global application state managed by Tauri
pub struct AppState {
    pub document: RwLock<Option<Arc<PdfDocument>>>,
    pub indexer: RwLock<Option<Arc<SearchIndexer>>>,
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
            document: RwLock::new(None),
            indexer: RwLock::new(None),
            bitmap_cache: BitmapCache::new(200),
            render_pool: RenderPool::new(num_threads),
        }
    }
}
