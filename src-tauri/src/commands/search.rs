use crate::search::query::{self, SearchOptions, SearchResult};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn search_text(
    query_str: String,
    options: Option<SearchOptions>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let path = state.active_file_path()?;
    let docs = state.documents.read();
    let entry = docs.get(&path).ok_or("No search index available")?;
    let indexer = &entry.indexer;

    let opts = options.unwrap_or_default();
    query::search(indexer, &query_str, &opts)
}

#[derive(serde::Serialize)]
pub struct IndexStatus {
    pub progress: f64,
    pub is_complete: bool,
    pub indexed_count: usize,
}

#[tauri::command]
pub fn get_index_status(state: State<'_, AppState>) -> Result<IndexStatus, String> {
    let path = state.active_file_path()?;
    let docs = state.documents.read();
    let entry = docs.get(&path).ok_or("No search index available")?;
    let indexer = &entry.indexer;

    Ok(IndexStatus {
        progress: indexer.progress(),
        is_complete: indexer.is_complete(),
        indexed_count: indexer.indexed_count(),
    })
}
