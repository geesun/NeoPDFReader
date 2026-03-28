use std::sync::Arc;
use tauri::Emitter;

use crate::pdf::text;
use crate::search::SearchIndexer;

/// Progress event sent to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct IndexProgress {
    pub current: usize,
    pub total: usize,
    pub progress: f64,
}

pub struct TaskScheduler;

impl TaskScheduler {
    /// Spawn background text extraction + index building task.
    ///
    /// Processes pages in batches of 100, emitting progress events so the
    /// frontend can show a "Indexing…" status.  Opens its own mupdf::Document
    /// on the spawned thread — mupdf contexts are per-thread and must not be
    /// shared across threads.
    pub fn spawn_index_task(
        file_path: String,
        page_count: usize,
        indexer: Arc<SearchIndexer>,
        app_handle: tauri::AppHandle,
    ) {
        let batch_size = 100;

        std::thread::spawn(move || {
            // Open a private Document on this thread — safe because mupdf's
            // fz_context is thread-local; multiple Documents can open the same
            // file from different threads simultaneously.
            let doc = match mupdf::Document::open(&file_path) {
                Ok(d) => d,
                Err(e) => {
                    log::error!("Indexer: failed to open document: {}", e);
                    return;
                }
            };

            let mut batch = Vec::with_capacity(batch_size);

            for page_num in 0..page_count {
                match text::extract_page_text_from_doc(&doc, page_num) {
                    Ok(page_text) => {
                        batch.push(page_text);
                    }
                    Err(e) => {
                        log::warn!("Failed to extract text from page {}: {}", page_num, e);
                    }
                }

                // Commit batch when full or at the end
                if batch.len() >= batch_size || page_num == page_count - 1 {
                    if let Err(e) = indexer.index_pages(&batch) {
                        log::error!("Failed to index batch: {}", e);
                    }
                    batch.clear();

                    // Emit progress event to frontend
                    let progress = IndexProgress {
                        current: page_num + 1,
                        total: page_count,
                        progress: (page_num + 1) as f64 / page_count as f64,
                    };
                    let _ = app_handle.emit("index-progress", &progress);
                }

                // Yield briefly to let other threads run
                std::thread::yield_now();
            }

            indexer.mark_complete();
            let _ = app_handle.emit("index-complete", ());
            log::info!("Index building complete: {} pages indexed", page_count);
        });
    }
}
