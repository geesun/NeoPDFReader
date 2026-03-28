use tauri::State;
use crate::state::AppState;

#[tauri::command]
pub async fn render_page(
    page_num: usize,
    scale: f32,
    rotation: i32,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let file_path = {
        let doc = state.document.read();
        doc.as_ref()
            .ok_or("No document open")?
            .file_path
            .to_string_lossy()
            .to_string()
    };

    eprintln!("[cmd] render_page page={} scale={} file={}", page_num, scale, file_path);

    if let Some(cached) = state.bitmap_cache.get(&file_path, page_num, scale, rotation) {
        eprintln!("[cmd] render_page page={} cache HIT", page_num);
        return Ok(cached);
    }

    let png_data = state
        .render_pool
        .render(file_path.clone(), page_num, scale, rotation)
        .await?;

    state.bitmap_cache.put(&file_path, page_num, scale, rotation, png_data.clone());

    Ok(png_data)
}

#[tauri::command]
pub async fn get_thumbnail(
    page_num: usize,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let file_path = {
        let doc = state.document.read();
        doc.as_ref()
            .ok_or("No document open")?
            .file_path
            .to_string_lossy()
            .to_string()
    };

    state
        .render_pool
        .thumbnail(file_path, page_num, 150)
        .await
}
