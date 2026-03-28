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
    /// Open a PDF file, read metadata and all page sizes, then discard the
    /// mupdf handle.  Fast for most PDFs because MediaBox is in the xref table.
    pub fn open(path: &Path) -> Result<Self, String> {
        let file_size = std::fs::metadata(path)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?
            .len();

        let doc = Document::open(path.to_str().unwrap_or(""))
            .map_err(|e| format!("Failed to open PDF: {}", e))?;

        let page_count =
            doc.page_count()
                .map_err(|e| format!("Failed to get page count: {}", e))? as usize;

        // Extract metadata
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

        // Pre-compute all page sizes for virtual scrolling — only reads MediaBox, fast.
        let mut page_sizes = Vec::with_capacity(page_count);
        for i in 0..page_count {
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

        // `doc` is dropped here — the mupdf handle is released.
        Ok(PdfDocument {
            metadata,
            page_sizes,
            file_path: path.to_owned(),
        })
    }

    pub fn page_count(&self) -> usize {
        self.metadata.page_count
    }

    /// Get PDF outline/bookmarks by opening a fresh Document on this thread.
    pub fn get_outline(&self) -> Result<Vec<OutlineItem>, String> {
        let path = self.file_path.to_str().unwrap_or("");
        let doc = Document::open(path)
            .map_err(|e| format!("Failed to open document for outline: {}", e))?;

        let outline = doc
            .outlines()
            .map_err(|e| format!("Failed to get outline: {}", e))?;

        fn convert_outline(items: &[mupdf::Outline]) -> Vec<OutlineItem> {
            items
                .iter()
                .map(|item| OutlineItem {
                    title: item.title.clone(),
                    page: item.dest.map(|d| d.loc.page_number as i32).unwrap_or(-1),
                    children: convert_outline(&item.down),
                })
                .collect()
        }

        Ok(convert_outline(&outline))
    }
}

// PdfDocument is Send + Sync: it contains no mupdf handles, only plain Rust
// data (PathBuf, Strings, Vecs) and i64/f32 values.
unsafe impl Send for PdfDocument {}
unsafe impl Sync for PdfDocument {}
