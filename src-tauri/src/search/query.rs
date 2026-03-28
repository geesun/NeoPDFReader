use serde::Serialize;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::Value;
use tantivy::TantivyDocument;

use crate::search::indexer::SearchIndexer;

#[derive(Debug, Clone, Serialize)]
pub struct SearchHighlight {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub page_num: usize,
    pub snippet: String,
    pub highlights: Vec<SearchHighlight>,
    pub match_count: usize,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub max_results: usize,
}

impl Default for SearchOptions {
    fn default() -> Self {
        SearchOptions {
            case_sensitive: false,
            whole_word: false,
            max_results: 1000,
        }
    }
}

/// Round a byte offset DOWN to the nearest valid UTF-8 char boundary.
fn floor_char_boundary(s: &str, mut idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    // Walk backwards until we land on a char boundary
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

/// Round a byte offset UP to the nearest valid UTF-8 char boundary.
fn ceil_char_boundary(s: &str, mut idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

/// Perform a search query against the index
pub fn search(
    indexer: &SearchIndexer,
    query_str: &str,
    options: &SearchOptions,
) -> Result<Vec<SearchResult>, String> {
    let reader = indexer
        .index()
        .reader()
        .map_err(|e| format!("Failed to create reader: {}", e))?;

    let searcher = reader.searcher();

    let query_parser = QueryParser::for_index(indexer.index(), vec![indexer.content_field()]);
    let query = query_parser
        .parse_query(query_str)
        .map_err(|e| format!("Failed to parse query: {}", e))?;

    let top_docs = searcher
        .search(&query, &TopDocs::with_limit(options.max_results))
        .map_err(|e| format!("Search failed: {}", e))?;

    let mut results: Vec<SearchResult> = Vec::new();

    let search_lower = if !options.case_sensitive {
        query_str.to_lowercase()
    } else {
        query_str.to_string()
    };

    for (_score, doc_address) in top_docs {
        let doc: TantivyDocument = searcher
            .doc(doc_address)
            .map_err(|e| format!("Failed to retrieve document: {}", e))?;

        let page_num = doc
            .get_first(indexer.page_num_field())
            .and_then(|v: &tantivy::schema::OwnedValue| v.as_u64())
            .unwrap_or(0) as usize;

        let content = doc
            .get_first(indexer.content_field())
            .and_then(|v: &tantivy::schema::OwnedValue| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();

        // Generate snippet: find first match and extract surrounding context
        let content_search = if !options.case_sensitive {
            content.to_lowercase()
        } else {
            content.clone()
        };

        let snippet = if let Some(pos) = content_search.find(&search_lower) {
            // `pos` is a byte offset into `content_search` (lowercased).
            // We need char-boundary-safe offsets into `content` (original case).
            // Both strings have the same byte length (to_lowercase is byte-stable
            // for ASCII; for non-ASCII we snap to boundaries).
            let raw_start = if pos > 40 { pos - 40 } else { 0 };
            let raw_end = std::cmp::min(pos + search_lower.len() + 40, content.len());
            let start = floor_char_boundary(&content, raw_start);
            let end = ceil_char_boundary(&content, raw_end);
            let mut s = String::new();
            if start > 0 {
                s.push_str("...");
            }
            s.push_str(&content[start..end]);
            if end < content.len() {
                s.push_str("...");
            }
            s
        } else {
            content.chars().take(80).collect()
        };

        // Find highlight positions from text blocks
        let highlights = find_highlights(indexer, page_num, query_str, options);

        let match_count = content_search.matches(&search_lower).count();

        results.push(SearchResult {
            page_num,
            snippet,
            highlights,
            match_count,
        });
    }

    // Sort by page number
    results.sort_by_key(|r| r.page_num);

    Ok(results)
}

/// Find text highlight rectangles for a search query on a specific page
fn find_highlights(
    indexer: &SearchIndexer,
    page_num: usize,
    query_str: &str,
    options: &SearchOptions,
) -> Vec<SearchHighlight> {
    let mut highlights = Vec::new();

    if let Some(blocks) = indexer.get_text_blocks(page_num) {
        let query_lower = query_str.to_lowercase();
        for block in &blocks {
            let block_text = if options.case_sensitive {
                block.text.clone()
            } else {
                block.text.to_lowercase()
            };

            let search_str = if options.case_sensitive {
                query_str.to_string()
            } else {
                query_lower.clone()
            };

            if block_text.contains(&search_str) {
                highlights.push(SearchHighlight {
                    x: block.x,
                    y: block.y,
                    width: block.width,
                    height: block.height,
                });
            }
        }
    }

    highlights
}
