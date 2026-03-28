use lru::LruCache;
use parking_lot::Mutex;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;

/// Cache key: (file_path_hash, page_num, scale_percent, rotation)
/// Including the file hash means switching PDFs never serves stale pages.
type CacheKey = (u64, usize, u32, i32);

/// LRU cache for rendered page bitmaps (stored as PNG bytes)
pub struct BitmapCache {
    cache: Mutex<LruCache<CacheKey, Vec<u8>>>,
}

impl BitmapCache {
    pub fn new(capacity: usize) -> Self {
        BitmapCache {
            cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(50).unwrap()),
            )),
        }
    }

    fn path_hash(file_path: &str) -> u64 {
        let mut h = DefaultHasher::new();
        file_path.hash(&mut h);
        h.finish()
    }

    /// Convert float scale to integer key (150% -> 150)
    fn scale_key(scale: f32) -> u32 {
        (scale * 100.0) as u32
    }

    /// Get cached PNG bytes for a page
    pub fn get(
        &self,
        file_path: &str,
        page_num: usize,
        scale: f32,
        rotation: i32,
    ) -> Option<Vec<u8>> {
        let key = (
            Self::path_hash(file_path),
            page_num,
            Self::scale_key(scale),
            rotation,
        );
        self.cache.lock().get(&key).cloned()
    }

    /// Insert rendered PNG bytes into cache
    pub fn put(
        &self,
        file_path: &str,
        page_num: usize,
        scale: f32,
        rotation: i32,
        png_data: Vec<u8>,
    ) {
        let key = (
            Self::path_hash(file_path),
            page_num,
            Self::scale_key(scale),
            rotation,
        );
        self.cache.lock().put(key, png_data);
    }

    /// Clear all cache entries (called when opening a new file, as a safety net)
    pub fn clear(&self) {
        self.cache.lock().clear();
    }

    /// Get current cache size
    pub fn len(&self) -> usize {
        self.cache.lock().len()
    }
}
