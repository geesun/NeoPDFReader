use tauri::State;
use tauri::ipc::Response;
use crate::state::AppState;
use crate::pdf::renderer::RenderPriority;

/// priority: 0 = visible (default), 1 = prefetch, 2 = thumbnail
#[tauri::command]
pub async fn render_page(
    page_num: usize,
    scale: f32,
    rotation: i32,
    priority: Option<u8>,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let file_path = {
        let doc = state.document.read();
        doc.as_ref()
            .ok_or("No document open")?
            .file_path
            .to_string_lossy()
            .to_string()
    };

    if let Some(cached) = state.bitmap_cache.get(&file_path, page_num, scale, rotation) {
        return Ok(Response::new(cached));
    }

    let prio = match priority.unwrap_or(0) {
        1 => RenderPriority::Prefetch,
        2 => RenderPriority::Thumbnail,
        _ => RenderPriority::Visible,
    };

    let png_data = match prio {
        RenderPriority::Visible => {
            state.render_pool.render_visible(file_path.clone(), page_num, scale, rotation).await?
        }
        RenderPriority::Prefetch => {
            state.render_pool.render_prefetch(file_path.clone(), page_num, scale, rotation).await?
        }
        RenderPriority::Thumbnail => {
            state.render_pool.thumbnail(file_path.clone(), page_num, 150).await?
        }
    };

    state.bitmap_cache.put(&file_path, page_num, scale, rotation, png_data.clone());

    Ok(Response::new(png_data))
}

#[tauri::command]
pub async fn get_thumbnail(
    page_num: usize,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    let file_path = {
        let doc = state.document.read();
        doc.as_ref()
            .ok_or("No document open")?
            .file_path
            .to_string_lossy()
            .to_string()
    };

    // Cache check for thumbnails too
    let thumb_scale = 0.0_f32; // sentinel: scale=0 means "thumbnail slot"
    if let Some(cached) = state.bitmap_cache.get(&file_path, page_num, thumb_scale, 0) {
        return Ok(Response::new(cached));
    }

    let png_data = state
        .render_pool
        .thumbnail(file_path.clone(), page_num, 150)
        .await?;

    state.bitmap_cache.put(&file_path, page_num, thumb_scale, 0, png_data.clone());

    Ok(Response::new(png_data))
}
