use crate::search::query::{self, SearchOptions, SearchResult};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn search_text(
    query_str: String,
    options: Option<SearchOptions>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let indexer = state.indexer.read();
    let indexer = indexer.as_ref().ok_or("No search index available")?;

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
    let indexer = state.indexer.read();
    let indexer = indexer.as_ref().ok_or("No search index available")?;

    Ok(IndexStatus {
        progress: indexer.progress(),
        is_complete: indexer.is_complete(),
        indexed_count: indexer.indexed_count(),
    })
}
