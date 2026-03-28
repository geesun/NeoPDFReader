use mupdf::{text_page::TextBlockType, Document, TextPageFlags};
use parking_lot::RwLock;
use serde::Serialize;
use std::sync::Arc;

/// A text block with position info — used for search highlight positioning
#[derive(Debug, Clone, Serialize)]
pub struct TextBlock {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
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
                let line_text: String = line.chars().filter_map(|c| c.char()).collect();
                if !line_text.trim().is_empty() {
                    let first_char = line.chars().next();
                    let last_char = line.chars().last();

                    let (x, y, width, height) = match (first_char, last_char) {
                        (Some(fc), Some(lc)) => {
                            let fc_origin = fc.origin();
                            let lc_quad = lc.quad();
                            (
                                fc_origin.x,
                                fc_origin.y - 12.0, // approximate ascent
                                lc_quad.ur.x - fc_origin.x,
                                14.0, // approximate line height
                            )
                        }
                        _ => (0.0, 0.0, 0.0, 0.0),
                    };

                    blocks.push(TextBlock {
                        text: line_text.clone(),
                        x,
                        y,
                        width,
                        height,
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
