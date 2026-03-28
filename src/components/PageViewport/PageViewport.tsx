import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderPage, bytesToBlobUrl } from "../../services/tauriApi";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import "./PageViewport.css";

interface PageCanvasProps {
  pageNum: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  documentId: number;
}

function PageCanvas({ pageNum, width, height, scale, rotation, documentId }: PageCanvasProps) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevBlobUrl = useRef<string | null>(null);

  const displayWidth = width * scale;
  const displayHeight = height * scale;

  const results = useSearchStore((s) => s.results);
  const currentResultIndex = useSearchStore((s) => s.currentResultIndex);

  const pageHighlights = results.filter((r) => r.page_num === pageNum);
  const isCurrentResultPage =
    currentResultIndex >= 0 &&
    results[currentResultIndex]?.page_num === pageNum;

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setImgSrc(null);
    renderPage(pageNum, scale, rotation)
      .then((bytes) => {
        if (cancelled) return;
        if (prevBlobUrl.current) {
          URL.revokeObjectURL(prevBlobUrl.current);
        }
        const url = bytesToBlobUrl(bytes);
        prevBlobUrl.current = url;
        setImgSrc(url);
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
  }, [pageNum, scale, rotation, documentId]);

  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) {
        URL.revokeObjectURL(prevBlobUrl.current);
      }
    };
  }, []);

  return (
    <div
      className="page-canvas"
      style={{ width: displayWidth, height: displayHeight, position: "relative" }}
    >
      {loading && (
        <div className="page-loading">
          <div className="page-loading-spinner" />
        </div>
      )}
      {imgSrc && (
        <img
          ref={imgRef}
          src={imgSrc}
          alt={`Page ${pageNum + 1}`}
          style={{ width: "100%", height: "100%", display: "block" }}
          draggable={false}
        />
      )}
      {pageHighlights.length > 0 && (
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
      )}
      <div className="page-number-label">{pageNum + 1}</div>
    </div>
  );
}

export default function PageViewport() {
  const { isOpen, pageSizes, pageCount, scale, rotation, currentPage, setCurrentPage, documentId } =
    useDocumentStore();

  // containerRef is ALWAYS attached to the same outermost div — never conditionally.
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  // Observe container resize (for viewportHeight)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []); // run once — containerRef.current is stable

  // Reset scroll to top on new document
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [documentId]);

  const gap = 12;

  // Pre-compute cumulative page offsets: pageOffsets[i] = top of page i in the scroll container.
  const { pageOffsets, totalHeight } = useMemo(() => {
    const offsets: number[] = [];
    let y = 0;
    for (const ps of pageSizes) {
      offsets.push(y);
      y += ps.height * scale + gap;
    }
    return { pageOffsets: offsets, totalHeight: y };
  }, [pageSizes, scale, gap]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const st = containerRef.current.scrollTop;
    setScrollTop(st);

    // Update currentPage using binary search on pageOffsets
    if (pageOffsets.length === 0) return;
    let lo = 0, hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] <= st) lo = mid;
      else hi = mid - 1;
    }
    if (lo !== currentPage) setCurrentPage(lo);
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
    return () => { delete (window as any).__scrollToPage; };
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

  // Compute visible page range using binary search on pageOffsets
  const { renderStart, renderEnd } = useMemo(() => {
    if (pageOffsets.length === 0) return { renderStart: 0, renderEnd: -1 };
    const overscan = 3;

    // First page whose bottom edge is visible: find last page where pageOffsets[i] < scrollTop
    let lo = 0, hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    const firstVisible = lo;

    // Last page whose top edge is within viewport bottom
    const viewBottom = scrollTop + viewportHeight;
    lo = firstVisible;
    hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] < viewBottom) lo = mid;
      else hi = mid - 1;
    }
    const lastVisible = lo;

    return {
      renderStart: Math.max(0, firstVisible - overscan),
      renderEnd: Math.min(pageOffsets.length - 1, lastVisible + overscan),
    };
  }, [pageOffsets, scrollTop, viewportHeight]);

  return (
    // This single div is ALWAYS the ref target — never returned conditionally.
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
        // Absolute-position virtual scroll: totalHeight sets the real scrollbar size.
        // Each page block is absolutely positioned at its true offset — no translateY.
        <div className="page-scroll-container" style={{ height: totalHeight }}>
          {renderEnd >= renderStart &&
            Array.from({ length: renderEnd - renderStart + 1 }, (_, idx) => {
              const pageNum = renderStart + idx;
              const ps = pageSizes[pageNum];
              const top = pageOffsets[pageNum];
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
                  />
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
