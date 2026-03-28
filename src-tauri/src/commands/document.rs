use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tauri::Emitter;

use crate::state::AppState;
use crate::pdf::PdfDocument;
use crate::pdf::document::{DocumentMetadata, PageSize, OutlineItem};
use crate::search::SearchIndexer;
use crate::scheduler::TaskScheduler;

#[derive(serde::Serialize)]
pub struct DocumentInfo {
    pub metadata: DocumentMetadata,
    /// Page sizes for the first batch of pages (immediately available).
    /// Remaining pages arrive via "page-sizes-chunk" events.
    pub page_sizes: Vec<PageSize>,
}

/// Emitted for every chunk of page sizes after the first batch.
#[derive(serde::Serialize, Clone)]
struct PageSizesChunk {
    /// 0-based index of the first page in this chunk
    start: usize,
    sizes: Vec<PageSize>,
}

#[tauri::command]
pub async fn open_pdf(
    path: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<DocumentInfo, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    // ── Phase 1: read metadata + first EAGER_PAGES page sizes on a blocking
    // thread so open_pdf can return and the frontend can start rendering the
    // visible pages immediately.
    //
    // The remaining page sizes are streamed via "page-sizes-chunk" events from
    // a background thread so virtual scrolling can build its full layout
    // without blocking the initial render.
    const EAGER_PAGES: usize = 16; // read immediately; covers any realistic initial viewport

    let path_owned = path.clone();
    let (doc, eager_sizes, page_count) = tokio::task::spawn_blocking(move || {
        PdfDocument::open_partial(Path::new(&path_owned), EAGER_PAGES)
    })
    .await
    .map_err(|e| format!("open task panicked: {}", e))??;

    let info = DocumentInfo {
        metadata: doc.metadata.clone(),
        page_sizes: eager_sizes,
    };

    let doc = Arc::new(doc);

    // Clear old caches
    state.bitmap_cache.clear();

    // Create new search indexer
    let indexer = Arc::new(SearchIndexer::new(page_count)?);

    // Store document and indexer in state
    {
        let mut doc_state = state.document.write();
        *doc_state = Some(doc.clone());
    }
    {
        let mut indexer_state = state.indexer.write();
        *indexer_state = Some(indexer.clone());
    }

    // Pre-warm render pool: open the document on each worker so the first
    // render_page call doesn't pay the Document::open cost.
    state.render_pool.prewarm(path.clone());

    // ── Phase 2 (background): stream remaining page sizes, then start indexer.
    // Delaying the indexer until page sizes are streamed keeps I/O contention
    // away from the initial render burst.
    if page_count > EAGER_PAGES {
        let path2 = path.clone();
        let app2 = app_handle.clone();
        let indexer2 = indexer.clone();
        let app3 = app_handle.clone();

        tokio::task::spawn_blocking(move || {
            // Stream remaining page sizes in chunks of 64
            const CHUNK: usize = 64;
            use mupdf::Document;
            let doc = match Document::open(&path2) {
                Ok(d) => d,
                Err(e) => {
                    log::error!("page-size stream: failed to open doc: {}", e);
                    return;
                }
            };

            let mut start = EAGER_PAGES;
            while start < page_count {
                let end = (start + CHUNK).min(page_count);
                let mut sizes = Vec::with_capacity(end - start);
                for i in start..end {
                    if let Ok(page) = doc.load_page(i as i32) {
                        if let Ok(b) = page.bounds() {
                            sizes.push(PageSize { width: b.x1 - b.x0, height: b.y1 - b.y0 });
                            continue;
                        }
                    }
                    // Fallback: use A4 size
                    sizes.push(PageSize { width: 595.0, height: 842.0 });
                }
                let chunk = PageSizesChunk { start, sizes };
                let _ = app2.emit("page-sizes-chunk", &chunk);
                start = end;
            }

            // Start indexing only after all page sizes are streamed so the
            // initial I/O burst for page bounds doesn't race with text extraction.
            TaskScheduler::spawn_index_task(path2, page_count, indexer2, app3);
        });
    } else {
        // Small document: all page sizes already eager-loaded, start indexer now.
        TaskScheduler::spawn_index_task(path.clone(), page_count, indexer, app_handle);
    }

    Ok(info)
}

#[tauri::command]
pub async fn get_outline(
    state: State<'_, AppState>,
) -> Result<Vec<OutlineItem>, String> {
    let file_path = {
        let doc = state.document.read();
        doc.as_ref()
            .ok_or("No document open")?
            .file_path
            .to_string_lossy()
            .to_string()
    };
    tokio::task::spawn_blocking(move || {
        use mupdf::Document;
        let doc = Document::open(&file_path)
            .map_err(|e| format!("Failed to open document for outline: {}", e))?;
        let outline = doc.outlines()
            .map_err(|e| format!("Failed to get outline: {}", e))?;
        fn convert(items: &[mupdf::Outline]) -> Vec<OutlineItem> {
            items.iter().map(|item| OutlineItem {
                title: item.title.clone(),
                page: item.dest.map(|d| d.loc.page_number as i32).unwrap_or(-1),
                children: convert(&item.down),
            }).collect()
        }
        Ok(convert(&outline))
    })
    .await
    .map_err(|e| format!("outline task panicked: {}", e))?
}

#[tauri::command]
pub fn get_document_properties(
    state: State<'_, AppState>,
) -> Result<DocumentMetadata, String> {
    let doc = state.document.read();
    let doc = doc.as_ref().ok_or("No document open")?;
    Ok(doc.metadata.clone())
}
