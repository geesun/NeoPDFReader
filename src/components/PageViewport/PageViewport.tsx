import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { bytesToBlobUrl } from "../../services/tauriApi";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import "./PageViewport.css";

// ─── PageCanvas ───────────────────────────────────────────────────────────────

interface PageCanvasProps {
  pageNum: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  documentId: number;
  /** 0 = visible (highest), 1 = prefetch, 2 = thumbnail */
  priority: 0 | 1 | 2;
}

// Highlights are split into a separate component so search-result navigation
// only re-renders the highlight overlay, not the image.
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

const PageCanvas = memo(function PageCanvas({
  pageNum,
  width,
  height,
  scale,
  rotation,
  documentId,
  priority,
}: PageCanvasProps) {
  // `displayedSrc` is what is currently shown — it persists across re-fetches
  // so the old image stays visible while the new one loads (no blank flash).
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const prevBlobUrl = useRef<string | null>(null);
  // Track the priority used to originally fetch the current image so we know
  // when we genuinely need a re-fetch (scale/rotation/doc change) vs. just a
  // priority reclassification (overscan → visible).
  const fetchedKey = useRef<string>("");

  const displayWidth = width * scale;
  const displayHeight = height * scale;

  useEffect(() => {
    // Key identifies *what* to render — priority is intentionally excluded.
    // A priority change only affects queue ordering, not the rendered content.
    const key = `${documentId}:${pageNum}:${scale}:${rotation}`;
    if (fetchedKey.current === key && displayedSrc !== null) {
      // Already have the correct image for this key — nothing to do.
      return;
    }

    let cancelled = false;
    // Show loading indicator only if we don't have any image yet.
    // If we already have an image (e.g. scale changed), keep showing it
    // until the new one arrives — no blank flash.
    if (displayedSrc === null) setLoading(true);

    invoke<ArrayBuffer>("render_page", {
      pageNum,
      scale,
      rotation,
      priority,
    })
      .then((buf) => {
        if (cancelled) return;
        // Revoke the old blob URL only after the new image is ready.
        if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
        const url = bytesToBlobUrl(buf);
        prevBlobUrl.current = url;
        fetchedKey.current = key;
        setDisplayedSrc(url);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(`Failed to render page ${pageNum}:`, err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `priority` deliberately omitted from deps — a priority change only
    // affects queue ordering, not which image we render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, scale, rotation, documentId]);

  useEffect(
    () => () => {
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    },
    []
  );

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
      {/* Spinner overlaid on top — only shown while loading AND no image yet */}
      {loading && displayedSrc === null && (
        <div className="page-loading">
          <div className="page-loading-spinner" />
        </div>
      )}
      <PageHighlights pageNum={pageNum} scale={scale} />
      <div className="page-number-label">{pageNum + 1}</div>
    </div>
  );
});

// ─── PageViewport ─────────────────────────────────────────────────────────────

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
  } = useDocumentStore();

  // containerRef is ALWAYS attached to the same outermost div.
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  // Track the latest raf handle so we can cancel if needed
  const rafRef = useRef<number | null>(null);

  // Observe container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Reset scroll on new document
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [documentId]);

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

  // Throttle scroll handler with requestAnimationFrame to avoid 60 React
  // state updates per second.
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!containerRef.current) return;
      const st = containerRef.current.scrollTop;
      setScrollTop(st);

      if (pageOffsets.length === 0) return;
      let lo = 0,
        hi = pageOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (pageOffsets[mid] <= st) lo = mid;
        else hi = mid - 1;
      }
      if (lo !== currentPage) setCurrentPage(lo);
    });
  }, [pageOffsets, currentPage, setCurrentPage]);

  const scrollToPage = useCallback(
    (pageNum: number) => {
      if (!containerRef.current || pageOffsets.length === 0) return;
      const top = pageOffsets[Math.min(pageNum, pageOffsets.length - 1)] ?? 0;
      containerRef.current.scrollTo({ top, behavior: "smooth" });
    },
    [pageOffsets]
  );

  useEffect(() => {
    (window as any).__scrollToPage = scrollToPage;
    return () => {
      delete (window as any).__scrollToPage;
    };
  }, [scrollToPage]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      switch (e.key) {
        case "PageDown":
          e.preventDefault();
          scrollToPage(Math.min(currentPage + 1, pageCount - 1));
          break;
        case "PageUp":
          e.preventDefault();
          scrollToPage(Math.max(currentPage - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          scrollToPage(0);
          break;
        case "End":
          e.preventDefault();
          scrollToPage(pageCount - 1);
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentPage, pageCount, scrollToPage]);

  // Compute visible + overscan page range using binary search.
  const { visibleStart, visibleEnd, renderStart, renderEnd } = useMemo(() => {
    if (pageOffsets.length === 0)
      return { visibleStart: 0, visibleEnd: -1, renderStart: 0, renderEnd: -1 };

    const overscan = 3;
    const viewBottom = scrollTop + viewportHeight;

    let lo = 0,
      hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    const firstVisible = lo;

    lo = firstVisible;
    hi = pageOffsets.length - 1;
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
              // Pages in the visible viewport get priority=0, overscan pages get priority=1
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
