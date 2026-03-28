use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tantivy::schema::*;
use tantivy::{doc, Index, IndexWriter};

use crate::pdf::text::{PageText, TextBlock};

/// Full-text search indexer backed by tantivy
pub struct SearchIndexer {
    index: Index,
    schema: Schema,
    page_num_field: Field,
    content_field: Field,
    /// Stores text blocks per page for highlight position lookup
    text_blocks: RwLock<Vec<Option<Vec<TextBlock>>>>,
    /// Index building progress
    indexed_count: AtomicUsize,
    total_pages: AtomicUsize,
    is_complete: AtomicBool,
}

impl SearchIndexer {
    pub fn new(page_count: usize) -> Result<Self, String> {
        let mut schema_builder = Schema::builder();

        let page_num_field = schema_builder.add_u64_field("page_num", INDEXED | STORED);
        let content_field = schema_builder.add_text_field("content", TEXT | STORED);

        let schema = schema_builder.build();

        // Use RAM directory for speed
        let index = Index::create_in_ram(schema.clone());

        let mut text_blocks = Vec::with_capacity(page_count);
        for _ in 0..page_count {
            text_blocks.push(None);
        }

        Ok(SearchIndexer {
            index,
            schema,
            page_num_field,
            content_field,
            text_blocks: RwLock::new(text_blocks),
            indexed_count: AtomicUsize::new(0),
            total_pages: AtomicUsize::new(page_count),
            is_complete: AtomicBool::new(false),
        })
    }

    /// Add a batch of pages to the index
    pub fn index_pages(&self, pages: &[PageText]) -> Result<(), String> {
        let mut writer: IndexWriter = self
            .index
            .writer(50_000_000)
            .map_err(|e| format!("Failed to create index writer: {}", e))?;

        for page in pages {
            writer
                .add_document(doc!(
                    self.page_num_field => page.page_num as u64,
                    self.content_field => page.full_text.clone(),
                ))
                .map_err(|e| format!("Failed to add document: {}", e))?;

            // Store text blocks for highlight positioning
            let mut blocks = self.text_blocks.write();
            if page.page_num < blocks.len() {
                blocks[page.page_num] = Some(page.blocks.clone());
            }

            self.indexed_count.fetch_add(1, Ordering::Relaxed);
        }

        writer
            .commit()
            .map_err(|e| format!("Failed to commit index: {}", e))?;

        Ok(())
    }

    /// Mark indexing as complete
    pub fn mark_complete(&self) {
        self.is_complete.store(true, Ordering::Relaxed);
    }

    /// Get index progress (0.0 ~ 1.0)
    pub fn progress(&self) -> f64 {
        let total = self.total_pages.load(Ordering::Relaxed);
        if total == 0 {
            return 1.0;
        }
        self.indexed_count.load(Ordering::Relaxed) as f64 / total as f64
    }

    pub fn is_complete(&self) -> bool {
        self.is_complete.load(Ordering::Relaxed)
    }

    pub fn indexed_count(&self) -> usize {
        self.indexed_count.load(Ordering::Relaxed)
    }

    pub fn index(&self) -> &Index {
        &self.index
    }

    pub fn content_field(&self) -> Field {
        self.content_field
    }

    pub fn page_num_field(&self) -> Field {
        self.page_num_field
    }

    /// Get text blocks for a specific page (used for highlight positioning)
    pub fn get_text_blocks(&self, page_num: usize) -> Option<Vec<TextBlock>> {
        let blocks = self.text_blocks.read();
        blocks.get(page_num).and_then(|b| b.clone())
    }
}
