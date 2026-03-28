import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { bytesToBlobUrl } from "../../services/tauriApi";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import "./PageViewport.css";
// ─── Front-end page image cache ───────────────────────────────────────────────
//
// Stores blob URLs for pages that have already been rendered.
// Key: `${documentId}:${pageNum}:${scaleKey}:${rotation}`
// When a PageCanvas mounts and its key is already in this map, it shows the
// image immediately with zero loading flash.
// When a new document is opened (documentId changes) the old entries are
// revoked and cleared.

const pageImageCache = new Map<string, string>();
let cachedDocumentId = -1;

function makeImageKey(documentId: number, pageNum: number, scale: number, rotation: number) {
  // Round scale to 3 decimal places so tiny float noise doesn't create duplicate entries.
  return `${documentId}:${pageNum}:${scale.toFixed(3)}:${rotation}`;
}

function clearImageCacheForDoc(documentId: number) {
  if (cachedDocumentId === documentId) return;
  // Revoke all old blob URLs to free browser memory.
  for (const url of pageImageCache.values()) {
    URL.revokeObjectURL(url);
  }
  pageImageCache.clear();
  cachedDocumentId = documentId;
}

// ─── PageHighlights ───────────────────────────────────────────────────────────

const PageHighlights = memo(function PageHighlights({
  pageNum,
  scale,
}: {
  pageNum: number;
  scale: number;
}) {
  const results = useSearchStore((s) => s.results);
  const currentResultIndex = useSearchStore((s) => s.currentResultIndex);

  const pageHighlights = useMemo(
    () => results.filter((r) => r.page_num === pageNum),
    [results, pageNum]
  );

  if (pageHighlights.length === 0) return null;

  const isCurrentResultPage =
    currentResultIndex >= 0 && results[currentResultIndex]?.page_num === pageNum;

  return (
    <div className="highlight-overlay">
      {pageHighlights.map((result, ri) =>
        result.highlights.map((hl, hi) => (
          <div
            key={`${ri}-${hi}`}
            className={`search-highlight ${isCurrentResultPage ? "current" : ""}`}
            style={{
              left: hl.x * scale,
              top: hl.y * scale,
              width: hl.width * scale,
              height: hl.height * scale,
            }}
          />
        ))
      )}
    </div>
  );
});

// ─── PageCanvas ───────────────────────────────────────────────────────────────

interface PageCanvasProps {
  pageNum: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  documentId: number;
  /** 0 = visible (highest priority), 1 = prefetch */
  priority: 0 | 1;
}

const PageCanvas = memo(function PageCanvas({
  pageNum,
  width,
  height,
  scale,
  rotation,
  documentId,
  priority,
}: PageCanvasProps) {
  const imageKey = makeImageKey(documentId, pageNum, scale, rotation);

  // Initialise directly from the front-end cache so the first render already
  // has an image — no loading flash for previously seen pages.
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(
    () => pageImageCache.get(imageKey) ?? null
  );

  // The key we last successfully fetched.  Stored in a ref so priority changes
  // (overscan → visible) don't trigger a redundant re-fetch.
  const fetchedKey = useRef<string>(displayedSrc ? imageKey : "");

  const displayWidth = width * scale;
  const displayHeight = height * scale;

  useEffect(() => {
    // If this key is already in the front-end cache, we're done.
    if (pageImageCache.has(imageKey)) {
      const cached = pageImageCache.get(imageKey)!;
      if (displayedSrc !== cached) setDisplayedSrc(cached);
      fetchedKey.current = imageKey;
      return;
    }

    // Already fetching this exact key from a previous render — skip.
    if (fetchedKey.current === imageKey) return;

    let cancelled = false;

    invoke<ArrayBuffer>("render_page", { pageNum, scale, rotation, priority })
      .then((buf) => {
        if (cancelled) return;
        const url = bytesToBlobUrl(buf);
        pageImageCache.set(imageKey, url);
        fetchedKey.current = imageKey;
        setDisplayedSrc(url);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(`Failed to render page ${pageNum}:`, err);
      });

    return () => {
      cancelled = true;
    };
    // priority intentionally excluded — only affects queue ordering, not output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, scale, rotation, documentId]);

  return (
    <div
      className="page-canvas"
      style={{ width: displayWidth, height: displayHeight, position: "relative" }}
    >
      {displayedSrc && (
        <img
          src={displayedSrc}
          alt={`Page ${pageNum + 1}`}
          style={{ width: "100%", height: "100%", display: "block" }}
          draggable={false}
        />
      )}
      {/* No spinner — white background shows while rendering, image fades in naturally */}
      <PageHighlights pageNum={pageNum} scale={scale} />
      <div className="page-number-label">{pageNum + 1}</div>
    </div>
  );
});

// ─── PageViewport ─────────────────────────────────────────────────────────────

// Debounce delay (ms) for saving the last-viewed page to the backend.
// Short enough to be timely, long enough not to thrash disk on fast scrolling.
const SAVE_DEBOUNCE_MS = 800;

export default function PageViewport() {
  const {
    isOpen,
    pageSizes,
    pageCount,
    scale,
    rotation,
    currentPage,
    setCurrentPage,
    documentId,
    initialPage,
  } = useDocumentStore();

  // Clear the front-end image cache whenever a new document is opened.
  clearImageCacheForDoc(documentId);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const rafRef = useRef<number | null>(null);
  // Keep a ref to pageOffsets so effects can read the latest value without
  // needing to be in their dependency arrays.
  const pageOffsetsRef = useRef<number[]>([]);
  // Debounce timer for save_last_page
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Observe container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const gap = 12;

  // Pre-compute cumulative page offsets
  const { pageOffsets, totalHeight } = useMemo(() => {
    const offsets: number[] = [];
    let y = 0;
    for (const ps of pageSizes) {
      offsets.push(y);
      y += ps.height * scale + gap;
    }
    return { pageOffsets: offsets, totalHeight: y };
  }, [pageSizes, scale]);

  // Keep the ref in sync so scroll-restoration effect can read latest offsets.
  pageOffsetsRef.current = pageOffsets;

  // Restore scroll position when a new document is opened.
  // We run this effect whenever documentId changes *and* pageOffsets has been
  // populated (length > 0). The ref ensures we always read the latest offsets.
  useEffect(() => {
    if (!containerRef.current) return;
    if (initialPage === 0) {
      // First page or no history — just reset to top.
      containerRef.current.scrollTop = 0;
      setScrollTop(0);
    } else {
      // Restore saved position. pageOffsetsRef.current is already up-to-date
      // because it's set synchronously before this effect fires.
      const offsets = pageOffsetsRef.current;
      const top = offsets[Math.min(initialPage, offsets.length - 1)] ?? 0;
      containerRef.current.scrollTop = top;
      setScrollTop(top);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // RAF-throttled scroll handler
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!containerRef.current) return;
      const st = containerRef.current.scrollTop;
      setScrollTop(st);
      if (pageOffsetsRef.current.length === 0) return;
      const offsets = pageOffsetsRef.current;
      let lo = 0, hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= st) lo = mid;
        else hi = mid - 1;
      }
      if (lo !== currentPage) {
        setCurrentPage(lo);
        // Debounced persist of reading position
        if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          const path = useDocumentStore.getState().filePath;
          if (path) {
            invoke("save_last_page", { path, page: lo }).catch(() => {/* non-critical */});
          }
        }, SAVE_DEBOUNCE_MS);
      }
    });
  }, [currentPage, setCurrentPage]);

  const scrollToPage = useCallback(
    (pageNum: number) => {
      if (!containerRef.current || pageOffsetsRef.current.length === 0) return;
      const top = pageOffsetsRef.current[Math.min(pageNum, pageOffsetsRef.current.length - 1)] ?? 0;
      // Instant jump — no scroll animation.  The image cache ensures the page
      // appears immediately; a smooth scroll would only add perceived delay.
      containerRef.current.scrollTop = top;
    },
    []
  );

  useEffect(() => {
    (window as any).__scrollToPage = scrollToPage;
    return () => { delete (window as any).__scrollToPage; };
  }, [scrollToPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      switch (e.key) {
        case "PageDown": e.preventDefault(); scrollToPage(Math.min(currentPage + 1, pageCount - 1)); break;
        case "PageUp":   e.preventDefault(); scrollToPage(Math.max(currentPage - 1, 0)); break;
        case "Home":     e.preventDefault(); scrollToPage(0); break;
        case "End":      e.preventDefault(); scrollToPage(pageCount - 1); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, currentPage, pageCount, scrollToPage]);

  // Compute visible + overscan range
  const { visibleStart, visibleEnd, renderStart, renderEnd } = useMemo(() => {
    if (pageOffsets.length === 0)
      return { visibleStart: 0, visibleEnd: -1, renderStart: 0, renderEnd: -1 };

    const overscan = 3;
    const viewBottom = scrollTop + viewportHeight;

    let lo = 0, hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    const firstVisible = lo;

    lo = firstVisible; hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] < viewBottom) lo = mid;
      else hi = mid - 1;
    }
    const lastVisible = lo;

    return {
      visibleStart: firstVisible,
      visibleEnd: lastVisible,
      renderStart: Math.max(0, firstVisible - overscan),
      renderEnd: Math.min(pageOffsets.length - 1, lastVisible + overscan),
    };
  }, [pageOffsets, scrollTop, viewportHeight]);

  return (
    <div
      ref={containerRef}
      className={`page-viewport${!isOpen ? " empty" : ""}`}
      onScroll={isOpen ? handleScroll : undefined}
    >
      {!isOpen ? (
        <div className="empty-message">
          <h2>neoPdfReader</h2>
          <p>Open a PDF file to get started</p>
          <p className="shortcut-hint">Ctrl+O to open file</p>
        </div>
      ) : (
        <div className="page-scroll-container" style={{ height: totalHeight }}>
          {renderEnd >= renderStart &&
            Array.from({ length: renderEnd - renderStart + 1 }, (_, idx) => {
              const pageNum = renderStart + idx;
              const ps = pageSizes[pageNum];
              const top = pageOffsets[pageNum];
              const isVisible = pageNum >= visibleStart && pageNum <= visibleEnd;
              const priority: 0 | 1 = isVisible ? 0 : 1;
              return (
                <div
                  key={`${documentId}-${pageNum}`}
                  className="page-wrapper"
                  style={{ position: "absolute", top, left: 0, right: 0 }}
                >
                  <PageCanvas
                    pageNum={pageNum}
                    width={ps.width}
                    height={ps.height}
                    scale={scale}
                    rotation={rotation}
                    documentId={documentId}
                    priority={priority}
                  />
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
