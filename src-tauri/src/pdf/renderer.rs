use mupdf::{Colorspace, Document, ImageFormat, Matrix};
use std::sync::mpsc::{self, SyncSender};
use tokio::sync::oneshot;

/// A render request sent to a worker thread.
struct RenderTask {
    file_path: String,
    page_num: usize,
    scale: f32,
    rotation: i32,
    thumbnail_max_width: Option<u32>, // Some(w) = thumbnail, None = full render
    reply: oneshot::Sender<Result<Vec<u8>, String>>,
}

/// Pool of permanent render worker threads.
/// Each thread owns its Document cache (a plain local variable, not TLS),
/// so there is no TLS-destruction-order problem on thread exit — these
/// threads never exit.
pub struct RenderPool {
    tx: SyncSender<RenderTask>,
}

impl RenderPool {
    /// Spawn `num_threads` permanent worker threads.
    pub fn new(num_threads: usize) -> Self {
        // Bounded channel: limit queued tasks to avoid unbounded memory use
        let (tx, rx) = mpsc::sync_channel::<RenderTask>(num_threads * 4);
        let rx = std::sync::Arc::new(std::sync::Mutex::new(rx));

        for _ in 0..num_threads {
            let rx = rx.clone();
            std::thread::spawn(move || {
                // Per-thread document cache: (file_path, Document).
                // Stored as a plain local — never goes through TLS destruction.
                let mut cached: Option<(String, Document)> = None;

                loop {
                    let task: RenderTask = match rx.lock().unwrap().recv() {
                        Ok(t) => t,
                        Err(_) => break, // sender dropped, exit
                    };

                    // Evict cache if file changed
                    if let Some((ref path, _)) = cached {
                        if *path != task.file_path {
                            cached = None;
                        }
                    }

                    // Open document if not cached
                    if cached.is_none() {
                        eprintln!("[render_pool] opening document: {}", task.file_path);
                        match Document::open(&task.file_path) {
                            Ok(doc) => {
                                eprintln!("[render_pool] document opened ok");
                                cached = Some((task.file_path.clone(), doc))
                            },
                            Err(e) => {
                                eprintln!("[render_pool] FAILED to open document: {}", e);
                                let _ = task.reply.send(Err(format!(
                                    "Failed to open document: {}", e
                                )));
                                continue;
                            }
                        }
                    }

                    let doc = &cached.as_ref().unwrap().1;
                    let result = if let Some(max_w) = task.thumbnail_max_width {
                        render_thumbnail_inner(doc, task.page_num, max_w)
                    } else {
                        render_page_inner(doc, task.page_num, task.scale, task.rotation)
                    };

                    let _ = task.reply.send(result);
                }
            });
        }

        RenderPool { tx }
    }

    /// Submit a page render request, await result asynchronously.
    pub async fn render(
        &self,
        file_path: String,
        page_num: usize,
        scale: f32,
        rotation: i32,
    ) -> Result<Vec<u8>, String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RenderTask {
                file_path,
                page_num,
                scale,
                rotation,
                thumbnail_max_width: None,
                reply: reply_tx,
            })
            .map_err(|_| "Render pool is shut down".to_string())?;
        reply_rx
            .await
            .map_err(|_| "Render worker dropped reply".to_string())?
    }

    /// Submit a thumbnail render request, await result asynchronously.
    pub async fn thumbnail(
        &self,
        file_path: String,
        page_num: usize,
        max_width: u32,
    ) -> Result<Vec<u8>, String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(RenderTask {
                file_path,
                page_num,
                scale: 1.0,
                rotation: 0,
                thumbnail_max_width: Some(max_width),
                reply: reply_tx,
            })
            .map_err(|_| "Render pool is shut down".to_string())?;
        reply_rx
            .await
            .map_err(|_| "Render worker dropped reply".to_string())?
    }
}

// RenderPool is Send+Sync: the SyncSender is Send+Sync, and the worker
// threads handle all mupdf access internally on their own threads.
unsafe impl Send for RenderPool {}
unsafe impl Sync for RenderPool {}

// ── Internal render helpers (called on worker threads only) ──────────────────

fn render_page_inner(
    doc: &Document,
    page_num: usize,
    scale: f32,
    rotation: i32,
) -> Result<Vec<u8>, String> {
    eprintln!("[render] page={} scale={} rotation={}", page_num, scale, rotation);
    let page = doc
        .load_page(page_num as i32)
        .map_err(|e| format!("Failed to load page {}: {}", page_num, e))?;

    let mut matrix = Matrix::new_scale(scale, scale);
    if rotation != 0 {
        matrix.concat(Matrix::new_rotate(rotation as f32));
    }

    // alpha=false → white background, no transparency artifacts
    let pixmap = page
        .to_pixmap(&matrix, &Colorspace::device_rgb(), false, true)
        .map_err(|e| format!("Failed to render page {}: {}", page_num, e))?;

    let mut png_buf: Vec<u8> = Vec::new();
    pixmap
        .write_to(&mut png_buf, ImageFormat::PNG)
        .map_err(|e| format!("Failed to encode page {} to PNG: {}", page_num, e))?;

    eprintln!("[render] page={} done, {} bytes", page_num, png_buf.len());
    Ok(png_buf)
}

fn render_thumbnail_inner(
    doc: &Document,
    page_num: usize,
    max_width: u32,
) -> Result<Vec<u8>, String> {
    let page = doc
        .load_page(page_num as i32)
        .map_err(|e| format!("Failed to load page {} for thumbnail: {}", page_num, e))?;

    let bounds = page
        .bounds()
        .map_err(|e| format!("Failed to get page {} bounds: {}", page_num, e))?;

    let page_width = (bounds.x1 - bounds.x0).max(1.0);
    let scale = max_width as f32 / page_width;
    let matrix = Matrix::new_scale(scale, scale);

    let pixmap = page
        .to_pixmap(&matrix, &Colorspace::device_rgb(), false, true)
        .map_err(|e| format!("Failed to render thumbnail for page {}: {}", page_num, e))?;

    let mut png_buf: Vec<u8> = Vec::new();
    pixmap
        .write_to(&mut png_buf, ImageFormat::PNG)
        .map_err(|e| format!("Failed to encode thumbnail for page {}: {}", page_num, e))?;

    Ok(png_buf)
}


