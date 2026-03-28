use mupdf::{Colorspace, Document, ImageFormat, Matrix};
use std::sync::{Arc, Condvar, Mutex};
use std::collections::BinaryHeap;
use std::cmp::Reverse;
use tokio::sync::oneshot;

/// Priority levels — lower number = higher priority.
/// Workers always pick the task with the lowest priority number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RenderPriority {
    /// Currently visible pages — render immediately
    Visible = 0,
    /// Overscan pages (±3 around visible) — render next
    Prefetch = 1,
    /// Sidebar thumbnails — render last
    Thumbnail = 2,
}

/// A render request sent to a worker thread.
struct RenderTask {
    priority: RenderPriority,
    /// Monotonically increasing sequence number for FIFO ordering within same priority.
    seq: u64,
    file_path: String,
    page_num: usize,
    scale: f32,
    rotation: i32,
    thumbnail_max_width: Option<u32>,
    reply: oneshot::Sender<Result<Vec<u8>, String>>,
}

// BinaryHeap is a max-heap; we want min-heap on (priority, seq).
impl PartialEq for RenderTask {
    fn eq(&self, other: &Self) -> bool {
        (self.priority, self.seq) == (other.priority, other.seq)
    }
}
impl Eq for RenderTask {}
impl PartialOrd for RenderTask {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for RenderTask {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Reverse so BinaryHeap gives us the *lowest* (priority, seq) first.
        Reverse((self.priority, self.seq)).cmp(&Reverse((other.priority, other.seq)))
    }
}

struct SharedQueue {
    heap: Mutex<(BinaryHeap<RenderTask>, u64, bool)>, // (tasks, next_seq, shutdown)
    condvar: Condvar,
}

/// Pool of permanent render worker threads with a priority queue.
/// Visible-page renders always preempt overscan and thumbnail renders.
pub struct RenderPool {
    queue: Arc<SharedQueue>,
}

impl RenderPool {
    pub fn new(num_threads: usize) -> Self {
        let queue = Arc::new(SharedQueue {
            heap: Mutex::new((BinaryHeap::new(), 0, false)),
            condvar: Condvar::new(),
        });

        for _ in 0..num_threads {
            let q = queue.clone();
            std::thread::spawn(move || {
                let mut cached: Option<(String, Document)> = None;

                loop {
                    // Wait for a task
                    let task = {
                        let mut guard = q.heap.lock().unwrap();
                        loop {
                            if let Some(t) = guard.0.pop() {
                                break t;
                            }
                            if guard.2 {
                                return; // shutdown
                            }
                            guard = q.condvar.wait(guard).unwrap();
                        }
                    };

                    // Evict per-thread doc cache if file changed
                    if let Some((ref path, _)) = cached {
                        if *path != task.file_path {
                            cached = None;
                        }
                    }

                    if cached.is_none() {
                        match Document::open(&task.file_path) {
                            Ok(doc) => cached = Some((task.file_path.clone(), doc)),
                            Err(e) => {
                                let _ = task.reply.send(Err(format!("Failed to open document: {}", e)));
                                continue;
                            }
                        }
                    }

                    // If the reply channel is already closed (caller cancelled), skip render.
                    if task.reply.is_closed() {
                        continue;
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

        RenderPool { queue }
    }

    fn enqueue(
        &self,
        priority: RenderPriority,
        file_path: String,
        page_num: usize,
        scale: f32,
        rotation: i32,
        thumbnail_max_width: Option<u32>,
    ) -> tokio::sync::oneshot::Receiver<Result<Vec<u8>, String>> {
        let (reply_tx, reply_rx) = oneshot::channel();
        let mut guard = self.queue.heap.lock().unwrap();
        let seq = guard.1;
        guard.1 += 1;
        guard.0.push(RenderTask {
            priority,
            seq,
            file_path,
            page_num,
            scale,
            rotation,
            thumbnail_max_width,
            reply: reply_tx,
        });
        drop(guard);
        self.queue.condvar.notify_one();
        reply_rx
    }

    /// Submit a visible-page render (highest priority).
    pub async fn render_visible(
        &self,
        file_path: String,
        page_num: usize,
        scale: f32,
        rotation: i32,
    ) -> Result<Vec<u8>, String> {
        self.enqueue(RenderPriority::Visible, file_path, page_num, scale, rotation, None)
            .await
            .map_err(|_| "Render worker dropped reply".to_string())?
    }

    /// Submit a prefetch render (overscan pages, medium priority).
    pub async fn render_prefetch(
        &self,
        file_path: String,
        page_num: usize,
        scale: f32,
        rotation: i32,
    ) -> Result<Vec<u8>, String> {
        self.enqueue(RenderPriority::Prefetch, file_path, page_num, scale, rotation, None)
            .await
            .map_err(|_| "Render worker dropped reply".to_string())?
    }

    /// Submit a thumbnail render (lowest priority).
    pub async fn thumbnail(
        &self,
        file_path: String,
        page_num: usize,
        max_width: u32,
    ) -> Result<Vec<u8>, String> {
        self.enqueue(RenderPriority::Thumbnail, file_path, page_num, 1.0, 0, Some(max_width))
            .await
            .map_err(|_| "Render worker dropped reply".to_string())?
    }
}

// RenderPool is Send+Sync: Arc<SharedQueue> is Send+Sync; workers own all mupdf handles.
unsafe impl Send for RenderPool {}
unsafe impl Sync for RenderPool {}

// ── Internal render helpers (called on worker threads only) ──────────────────

fn render_page_inner(
    doc: &Document,
    page_num: usize,
    scale: f32,
    rotation: i32,
) -> Result<Vec<u8>, String> {
    let page = doc
        .load_page(page_num as i32)
        .map_err(|e| format!("Failed to load page {}: {}", page_num, e))?;

    let mut matrix = Matrix::new_scale(scale, scale);
    if rotation != 0 {
        matrix.concat(Matrix::new_rotate(rotation as f32));
    }

    let pixmap = page
        .to_pixmap(&matrix, &Colorspace::device_rgb(), false, true)
        .map_err(|e| format!("Failed to render page {}: {}", page_num, e))?;

    let mut png_buf: Vec<u8> = Vec::new();
    pixmap
        .write_to(&mut png_buf, ImageFormat::PNG)
        .map_err(|e| format!("Failed to encode page {} to PNG: {}", page_num, e))?;

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
