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

    // Open PDF document — reads metadata and page sizes only.
    // The Document handle here is used only for the open() call; actual
    // rendering/indexing uses per-thread Document instances.
    let doc = PdfDocument::open(file_path)?;
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
pub fn get_outline(
    state: State<'_, AppState>,
) -> Result<Vec<OutlineItem>, String> {
    let doc = state.document.read();
    let doc = doc.as_ref().ok_or("No document open")?;
    doc.get_outline()
}

#[tauri::command]
pub fn get_document_properties(
    state: State<'_, AppState>,
) -> Result<DocumentMetadata, String> {
    let doc = state.document.read();
    let doc = doc.as_ref().ok_or("No document open")?;
    Ok(doc.metadata.clone())
}
