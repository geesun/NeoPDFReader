use mupdf::{Document, MetadataName};
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
        let (doc, page_sizes, _) = Self::open_partial(path, usize::MAX)?;
        Ok(doc)
    }

    /// Open a PDF file and read metadata + up to `eager_pages` page sizes
    /// immediately.  Returns `(PdfDocument, eager_sizes, total_page_count)`.
    /// The returned `PdfDocument` stores only the metadata; page_sizes in the
    /// struct is left empty — callers are responsible for streaming the rest.
    pub fn open_partial(
        path: &Path,
        eager_pages: usize,
    ) -> Result<(Self, Vec<PageSize>, usize), String> {
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

        // Read eager_pages page sizes immediately.
        let eager_count = eager_pages.min(page_count);
        let mut page_sizes = Vec::with_capacity(eager_count);
        for i in 0..eager_count {
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

        // doc is dropped here — the mupdf handle is released.
        let pdf_doc = PdfDocument {
            metadata,
            // page_sizes is intentionally empty for the partial case;
            // the full sizes are streamed separately.
            page_sizes: Vec::new(),
            file_path: path.to_owned(),
        };

        Ok((pdf_doc, page_sizes, page_count))
    }

    pub fn page_count(&self) -> usize {
        self.metadata.page_count
    }
}

// PdfDocument is Send + Sync: it contains no mupdf handles, only plain Rust
// data (PathBuf, Strings, Vecs) and i64/f32 values.
unsafe impl Send for PdfDocument {}
unsafe impl Sync for PdfDocument {}
