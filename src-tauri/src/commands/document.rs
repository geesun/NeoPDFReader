use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tauri::Emitter;
use tauri::Manager;

use crate::state::AppState;
use crate::pdf::PdfDocument;
use crate::pdf::document::{DocumentMetadata, PageSize, OutlineItem};
use crate::search::SearchIndexer;
use crate::scheduler::TaskScheduler;
use crate::history;

#[derive(serde::Serialize)]
pub struct DocumentInfo {
    pub metadata: DocumentMetadata,
    /// Page sizes for the first batch of pages (immediately available).
    /// Remaining pages arrive via "page-sizes-chunk" events.
    pub page_sizes: Vec<PageSize>,
    /// Last page the user was on when this file was previously closed.
    /// 0 means the file has not been opened before (or was last seen at page 0).
    pub last_page: usize,
    /// Pre-rendered PNG of `last_page` (base64-encoded), so the frontend can
    /// display it immediately without a separate render_page IPC call.
    /// None if pre-rendering failed (frontend falls back to render_page).
    pub initial_page_png: Option<String>,
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
    // We also look up reading history *before* spawning so we can pass
    // initial_page into open_partial and pre-render that page on the same
    // thread — eliminating one full render_page IPC round-trip.
    const EAGER_PAGES: usize = 16;

    // Read history on the async thread (fast — tiny JSON file).
    let last_page = match app_handle.path().app_data_dir() {
        Ok(data_dir) => history::get_last_page(&data_dir, &path),
        Err(_) => 0,
    };

    let path_owned = path.clone();
    let (doc, eager_sizes, page_count, initial_page_png_bytes) =
        tokio::task::spawn_blocking(move || {
            PdfDocument::open_partial(Path::new(&path_owned), EAGER_PAGES, last_page)
        })
        .await
        .map_err(|e| format!("open task panicked: {}", e))??;

    // Encode the pre-rendered PNG as base64 for JSON transport.
    let initial_page_png = initial_page_png_bytes.as_ref().map(|bytes| {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    });

    let info = DocumentInfo {
        metadata: doc.metadata.clone(),
        page_sizes: eager_sizes,
        last_page,
        initial_page_png,
    };

    let doc = Arc::new(doc);

    // Clear old caches
    state.bitmap_cache.clear();

    // Store the pre-rendered PNG in the bitmap cache so a subsequent
    // render_page(last_page, scale=1.0, rotation=0) call returns instantly.
    if let Some(png_bytes) = initial_page_png_bytes {
        state.bitmap_cache.put(&path, last_page, 1.0, 0, png_bytes);
    }

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

/// Persist the last-viewed page for a file so it can be restored on reopen.
/// Called from the frontend (debounced) whenever the visible page changes.
#[tauri::command]
pub fn save_last_page(
    path: String,
    page: usize,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    history::set_last_page(&data_dir, &path, page);
    Ok(())
}
