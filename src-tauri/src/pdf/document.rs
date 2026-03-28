use mupdf::{Colorspace, Document, ImageFormat, Matrix, MetadataName};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct DocumentMetadata {
    pub title: String,
    pub author: String,
    pub subject: String,
    pub creator: String,
    pub producer: String,
    pub page_count: usize,
    pub file_path: String,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageSize {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutlineItem {
    pub title: String,
    pub page: i32,
    pub children: Vec<OutlineItem>,
}

/// Lightweight PDF document descriptor.
///
/// Stores only metadata and page sizes (computed at open time), plus the file
/// path so that rendering and indexing operations can open their own
/// `mupdf::Document` on their respective threads.
///
/// mupdf's `fz_context` is per-thread — never share a `Document` across
/// threads.  All mupdf operations happen on the thread that opened the
/// Document.
pub struct PdfDocument {
    pub metadata: DocumentMetadata,
    pub page_sizes: Vec<PageSize>,
    pub file_path: PathBuf,
}

impl PdfDocument {
    /// Open a PDF file, read metadata and ALL page sizes, then discard the
    /// mupdf handle.
    pub fn open(path: &Path) -> Result<Self, String> {
        let (doc, _page_sizes, _, _) = Self::open_partial(path, usize::MAX, 0)?;
        Ok(doc)
    }

    /// Open a PDF file and read metadata + up to `eager_pages` page sizes
    /// immediately.  Also pre-renders `initial_page` (the page to show first,
    /// which is either page 0 or the last-viewed page from reading history)
    /// using the same Document that is already open, so the caller gets a PNG
    /// it can display without a second render_page IPC round-trip.
    ///
    /// Returns `(PdfDocument, eager_sizes, total_page_count, initial_page_png)`.
    /// `initial_page_png` is None only if rendering failed (non-fatal).
    pub fn open_partial(
        path: &Path,
        eager_pages: usize,
        initial_page: usize,
    ) -> Result<(Self, Vec<PageSize>, usize, Option<Vec<u8>>), String> {
        let file_size = std::fs::metadata(path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?
            .len();

        let doc = Document::open(path.to_str().unwrap_or(""))
            .map_err(|e| format!("Failed to open PDF: {}", e))?;

        let page_count =
            doc.page_count()
                .map_err(|e| format!("Failed to get page count: {}", e))? as usize;

        let metadata = DocumentMetadata {
            title: doc.metadata(MetadataName::Title).unwrap_or_default(),
            author: doc.metadata(MetadataName::Author).unwrap_or_default(),
            subject: doc.metadata(MetadataName::Subject).unwrap_or_default(),
            creator: doc.metadata(MetadataName::Creator).unwrap_or_default(),
            producer: doc.metadata(MetadataName::Producer).unwrap_or_default(),
            page_count,
            file_path: path.to_string_lossy().to_string(),
            file_size,
        };

        // Ensure initial_page is within the eager batch so its size is also
        // included.  The eager window starts at 0; if initial_page is beyond
        // it we extend the window to cover it.
        let eager_end = eager_pages.max(initial_page + 1).min(page_count);
        let mut page_sizes = Vec::with_capacity(eager_end);
        for i in 0..eager_end {
            let page = doc
                .load_page(i as i32)
                .map_err(|e| format!("Failed to load page {}: {}", i, e))?;
            let bounds = page
                .bounds()
                .map_err(|e| format!("Failed to get page {} bounds: {}", i, e))?;
            page_sizes.push(PageSize {
                width: bounds.x1 - bounds.x0,
                height: bounds.y1 - bounds.y0,
            });
        }

        // Pre-render initial_page while the Document is still open here.
        // This costs nothing extra — the Document + page tree are already
        // loaded; we just rasterise one page and PNG-encode it.
        // Failures are non-fatal: the frontend will fall back to render_page().
        let initial_page_png = if initial_page < page_count {
            match render_page_png(&doc, initial_page) {
                Ok(png) => Some(png),
                Err(e) => {
                    log::warn!("pre-render page {}: {}", initial_page, e);
                    None
                }
            }
        } else {
            None
        };

        // doc is dropped here — the mupdf handle is released.
        let pdf_doc = PdfDocument {
            metadata,
            // page_sizes field intentionally empty for the partial case;
            // the full sizes are streamed separately.
            page_sizes: Vec::new(),
            file_path: path.to_owned(),
        };

        Ok((pdf_doc, page_sizes, page_count, initial_page_png))
    }

    pub fn page_count(&self) -> usize {
        self.metadata.page_count
    }
}

/// Render a single page to PNG bytes using scale=1.0, rotation=0.
/// Extracted here so open_partial can call it without depending on renderer.rs.
fn render_page_png(doc: &Document, page_num: usize) -> Result<Vec<u8>, String> {
    let page = doc
        .load_page(page_num as i32)
        .map_err(|e| format!("load_page {}: {}", page_num, e))?;

    let matrix = Matrix::new_scale(1.0, 1.0);
    let pixmap = page
        .to_pixmap(&matrix, &Colorspace::device_rgb(), false, true)
        .map_err(|e| format!("to_pixmap {}: {}", page_num, e))?;

    let mut buf = Vec::new();
    pixmap
        .write_to(&mut buf, ImageFormat::PNG)
        .map_err(|e| format!("write_to PNG {}: {}", page_num, e))?;

    Ok(buf)
}

/// Convert mupdf outline items to our serializable OutlineItem type.
pub fn convert_outline(items: &[mupdf::Outline]) -> Vec<OutlineItem> {
    items
        .iter()
        .map(|item| OutlineItem {
            title: item.title.clone(),
            page: item.dest.map(|d| d.loc.page_number as i32).unwrap_or(-1),
            children: convert_outline(&item.down),
        })
        .collect()
}

// PdfDocument is Send + Sync: it contains no mupdf handles, only plain Rust
// data (PathBuf, Strings, Vecs) and i64/f32 values.
unsafe impl Send for PdfDocument {}
unsafe impl Sync for PdfDocument {}
