use mupdf::{text_page::TextBlockType, Document, TextPageFlags};
use parking_lot::RwLock;
use serde::Serialize;
use std::sync::Arc;

/// Per-character bounding box — used for precise search highlight positioning.
/// Each entry corresponds to one character in the parent TextBlock's `text` string.
#[derive(Debug, Clone, Serialize)]
pub struct CharPosition {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// A text block with position info — used for search highlight positioning
#[derive(Debug, Clone, Serialize)]
pub struct TextBlock {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    /// Per-character bounding boxes. Length matches `text.chars().count()`.
    pub char_positions: Vec<CharPosition>,
}

/// A full page text extraction result
#[derive(Debug, Clone, Serialize)]
pub struct PageText {
    pub page_num: usize,
    pub blocks: Vec<TextBlock>,
    pub full_text: String,
}

/// Extract text from a single page using a shared Arc<RwLock<Document>>.
/// Only call this from the thread that owns the document context.
pub fn extract_page_text(doc: &Arc<RwLock<Document>>, page_num: usize) -> Result<PageText, String> {
    let doc = doc.read();
    extract_page_text_from_doc(&doc, page_num)
}

/// Extract text from a single page using a direct reference to a Document.
/// Use this when the Document is already owned by the calling thread (e.g.
/// background indexer thread that opened its own Document).
pub fn extract_page_text_from_doc(doc: &Document, page_num: usize) -> Result<PageText, String> {
    let page = doc
        .load_page(page_num as i32)
        .map_err(|e| format!("Failed to load page {}: {}", page_num, e))?;

    let text_page = page
        .to_text_page(TextPageFlags::empty())
        .map_err(|e| format!("Failed to extract text from page {}: {}", page_num, e))?;

    let mut blocks = Vec::new();
    let mut full_text = String::new();

    for block in text_page.blocks() {
        if block.r#type() == TextBlockType::Text {
            for line in block.lines() {
                // Collect characters and their quads in one pass
                let mut line_text = String::new();
                let mut char_positions = Vec::new();

                for c in line.chars() {
                    if let Some(ch) = c.char() {
                        let q = c.quad();
                        // Compute axis-aligned bounding box from the quad
                        let cx = q.ul.x.min(q.ll.x);
                        let cy = q.ul.y.min(q.ur.y);
                        let cw = q.ur.x.max(q.lr.x) - cx;
                        let ch_height = q.ll.y.max(q.lr.y) - cy;
                        char_positions.push(CharPosition {
                            x: cx,
                            y: cy,
                            width: cw,
                            height: ch_height,
                        });
                        line_text.push(ch);
                    }
                }

                if !line_text.trim().is_empty() {
                    // Compute the overall line bounding box from char quads
                    let (x, y, width, height) = if !char_positions.is_empty() {
                        let min_x = char_positions
                            .iter()
                            .map(|p| p.x)
                            .fold(f32::INFINITY, f32::min);
                        let min_y = char_positions
                            .iter()
                            .map(|p| p.y)
                            .fold(f32::INFINITY, f32::min);
                        let max_x = char_positions
                            .iter()
                            .map(|p| p.x + p.width)
                            .fold(f32::NEG_INFINITY, f32::max);
                        let max_y = char_positions
                            .iter()
                            .map(|p| p.y + p.height)
                            .fold(f32::NEG_INFINITY, f32::max);
                        (min_x, min_y, max_x - min_x, max_y - min_y)
                    } else {
                        (0.0, 0.0, 0.0, 0.0)
                    };

                    blocks.push(TextBlock {
                        text: line_text.clone(),
                        x,
                        y,
                        width,
                        height,
                        char_positions,
                    });
                    full_text.push_str(&line_text);
                    full_text.push('\n');
                }
            }
        }
    }

    Ok(PageText {
        page_num,
        blocks,
        full_text,
    })
}

/// Extract text from all pages — returns results for batch indexing.
/// Only call from the thread that owns `doc`.
pub fn extract_all_text(
    doc: &Arc<RwLock<Document>>,
    page_count: usize,
) -> Vec<Result<PageText, String>> {
    let mut results = Vec::with_capacity(page_count);
    for i in 0..page_count {
        results.push(extract_page_text(doc, i));
    }
    results
}
