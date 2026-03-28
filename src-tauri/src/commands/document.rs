use std::path::Path;
use std::sync::Arc;
use tauri::State;

use crate::state::AppState;
use crate::pdf::PdfDocument;
use crate::pdf::document::{DocumentMetadata, PageSize, OutlineItem};
use crate::search::SearchIndexer;
use crate::scheduler::TaskScheduler;

#[derive(serde::Serialize)]
pub struct DocumentInfo {
    pub metadata: DocumentMetadata,
    pub page_sizes: Vec<PageSize>,
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

    // Open PDF document on a blocking thread — the page-size loop calls mupdf
    // load_page/bounds for every page which is CPU-bound and must not block a
    // tokio async worker.
    let path_owned = path.clone();
    let doc = tokio::task::spawn_blocking(move || {
        PdfDocument::open(Path::new(&path_owned))
    })
    .await
    .map_err(|e| format!("open task panicked: {}", e))??;
    let page_count = doc.page_count();
    let info = DocumentInfo {
        metadata: doc.metadata.clone(),
        page_sizes: doc.page_sizes.clone(),
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

    // Spawn background indexing — passes the file path so the indexer can
    // open its own mupdf::Document on the background thread.
    TaskScheduler::spawn_index_task(
        path.clone(),
        page_count,
        indexer,
        app_handle,
    );

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
    // Outline parsing opens a fresh mupdf Document — do it off the async thread.
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
