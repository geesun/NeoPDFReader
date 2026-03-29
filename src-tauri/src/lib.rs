mod pdf;
mod search;
mod cache;
mod commands;
mod scheduler;
mod state;
mod history;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::document::open_pdf,
            commands::document::get_outline,
            commands::document::get_document_properties,
            commands::document::get_page_links,
            commands::document::get_page_text_lines,
            commands::document::save_last_page,
            commands::render::render_page,
            commands::render::get_thumbnail,
            commands::search::search_text,
            commands::search::get_index_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
