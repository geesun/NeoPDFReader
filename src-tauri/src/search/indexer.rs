use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tantivy::schema::*;
use tantivy::{doc, Index, IndexWriter};

use crate::pdf::text::{PageText, TextBlock};

/// Full-text search indexer backed by tantivy.
///
/// Design: a single `IndexWriter` is created once and reused across all
/// `index_pages` calls.  tantivy recommends keeping the writer alive and
/// committing infrequently — creating a new writer per batch is expensive
/// because tantivy allocates a 50 MB heap budget each time and performs
/// segment merges on every commit.
pub struct SearchIndexer {
    index: Index,
    schema: Schema,
    page_num_field: Field,
    content_field: Field,
    /// Stores text blocks per page for highlight position lookup.
    /// Write lock is held only while inserting a single page's data (Vec swap),
    /// not for the full batch, so readers are not blocked for long.
    text_blocks: RwLock<Vec<Option<Vec<TextBlock>>>>,
    /// Persistent writer — reused across index_pages calls.
    writer: Mutex<IndexWriter>,
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

        let index = Index::create_in_ram(schema.clone());
        // 50 MB heap budget — created once, amortised across all batches.
        let writer = index
            .writer(50_000_000)
            .map_err(|e| format!("Failed to create index writer: {}", e))?;

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
            writer: Mutex::new(writer),
            indexed_count: AtomicUsize::new(0),
            total_pages: AtomicUsize::new(page_count),
            is_complete: AtomicBool::new(false),
        })
    }

    /// Add a batch of pages to the index.
    ///
    /// Documents are added to the persistent writer.  A commit is issued once
    /// per batch so that newly indexed pages become searchable quickly, but the
    /// writer is NOT recreated — this avoids the expensive tantivy writer setup
    /// and segment merge that happens on every `Index::writer()` call.
    pub fn index_pages(&self, pages: &[PageText]) -> Result<(), String> {
        // Collect text-block data for this batch first (outside the writer lock)
        // so we hold the RwLock write for the minimum time.
        let mut block_updates: Vec<(usize, Vec<TextBlock>)> = Vec::with_capacity(pages.len());
        for page in pages {
            block_updates.push((page.page_num, page.blocks.clone()));
        }

        // Add documents to the persistent writer.
        {
            let mut writer = self
                .writer
                .lock()
                .map_err(|_| "writer lock poisoned".to_string())?;
            for page in pages {
                writer
                    .add_document(doc!(
                        self.page_num_field => page.page_num as u64,
                        self.content_field => page.full_text.clone(),
                    ))
                    .map_err(|e| format!("Failed to add document: {}", e))?;
            }
            // Commit once per batch — makes newly indexed pages searchable.
            writer
                .commit()
                .map_err(|e| format!("Failed to commit index: {}", e))?;
        }

        // Update text-block store.  Take the write lock once for the whole
        // batch rather than once per page.
        {
            let mut blocks = self.text_blocks.write();
            for (page_num, page_blocks) in block_updates {
                if page_num < blocks.len() {
                    blocks[page_num] = Some(page_blocks);
                }
            }
        }

        self.indexed_count.fetch_add(pages.len(), Ordering::Relaxed);

        Ok(())
    }

    /// Mark indexing as complete.
    pub fn mark_complete(&self) {
        self.is_complete.store(true, Ordering::Relaxed);
    }

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

    pub fn get_text_blocks(&self, page_num: usize) -> Option<Vec<TextBlock>> {
        let blocks = self.text_blocks.read();
        blocks.get(page_num).and_then(|b| b.clone())
    }
}
