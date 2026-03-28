import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";

import { invoke } from "@tauri-apps/api/core";
import { getOutline, bytesToBlobUrl } from "../../services/tauriApi";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import { useViewStore } from "../../store/viewStore";
import type { OutlineItem } from "../../types";
import "./Sidebar.css";

// ─── Thumbnail virtual scroll ─────────────────────────────────────────────────

// Fixed item dimensions (must match CSS)
const THUMB_ITEM_HEIGHT = 244; // placeholder(200) + label(20) + padding(8) + gap(8)*2 ≈ 244
const THUMB_OVERSCAN = 3;

const ThumbnailItem = memo(function ThumbnailItem({
  pageNum,
  documentId,
  isActive,
  onSelect,
}: {
  pageNum: number;
  documentId: number;
  isActive: boolean;
  onSelect: (p: number) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);

  // Fetch thumbnail on mount (component is only mounted when visible).
  // Key={documentId}-{pageNum} ensures full remount on document change,
  // so this effect always fires for a new document.
  useEffect(() => {
    let cancelled = false;
    invoke<ArrayBuffer>("get_thumbnail", { pageNum })
      .then((buf) => {
        if (cancelled) return;
        setSrc(bytesToBlobUrl(buf));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // documentId is included so that if React ever reuses this instance
  // (e.g. during dev hot-reload), the fetch still re-fires.
  }, [pageNum, documentId]);

  return (
    <div
      className={`thumbnail-item ${isActive ? "active" : ""}`}
      onClick={() => onSelect(pageNum)}
    >
      {src ? (
        <img src={src} alt={`Page ${pageNum + 1}`} draggable={false} />
      ) : (
        <div className="thumbnail-placeholder" />
      )}
      <span className="thumbnail-label">{pageNum + 1}</span>
    </div>
  );
});

function ThumbnailPanel() {
  const { pageCount, currentPage, documentId, setCurrentPage } = useDocumentStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setContainerHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rafRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
    });
  }, []);

  const totalHeight = pageCount * THUMB_ITEM_HEIGHT;

  const { renderStart, renderEnd } = useMemo(() => {
    const first = Math.floor(scrollTop / THUMB_ITEM_HEIGHT);
    const last = Math.min(
      pageCount - 1,
      Math.floor((scrollTop + containerHeight) / THUMB_ITEM_HEIGHT)
    );
    return {
      renderStart: Math.max(0, first - THUMB_OVERSCAN),
      renderEnd: Math.min(pageCount - 1, last + THUMB_OVERSCAN),
    };
  }, [scrollTop, containerHeight, pageCount]);

  const handleSelect = useCallback(
    (p: number) => {
      setCurrentPage(p);
      (window as any).__scrollToPage?.(p);
    },
    [setCurrentPage]
  );

  return (
    <div
      ref={containerRef}
      className="thumbnail-panel-scroll"
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        {pageCount > 0 &&
          renderEnd >= renderStart &&
          Array.from({ length: renderEnd - renderStart + 1 }, (_, idx) => {
            const pageNum = renderStart + idx;
            return (
              <div
                key={`${documentId}-${pageNum}`}
                style={{
                  position: "absolute",
                  top: pageNum * THUMB_ITEM_HEIGHT,
                  left: 0,
                  right: 0,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <ThumbnailItem
                  pageNum={pageNum}
                  documentId={documentId}
                  isActive={pageNum === currentPage}
                  onSelect={handleSelect}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

function BookmarkItem({ item }: { item: OutlineItem }) {
  const { setCurrentPage } = useDocumentStore();
  const [expanded, setExpanded] = useState(false);
  const hasChildren = item.children.length > 0;

  return (
    <div className="bookmark-item">
      <div
        className="bookmark-title"
        onClick={() => {
          if (item.page >= 0) {
            setCurrentPage(item.page);
            (window as any).__scrollToPage?.(item.page);
          }
        }}
      >
        {hasChildren && (
          <span
            className={`bookmark-toggle ${expanded ? "expanded" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            &#9654;
          </span>
        )}
        <span className="bookmark-text">{item.title}</span>
      </div>
      {expanded && hasChildren && (
        <div className="bookmark-children">
          {item.children.map((child, i) => (
            <BookmarkItem key={i} item={child} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookmarkPanel() {
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const { isOpen } = useDocumentStore();

  useEffect(() => {
    if (!isOpen) return;
    getOutline()
      .then(setOutline)
      .catch(() => setOutline([]));
  }, [isOpen]);

  if (outline.length === 0) {
    return <div className="sidebar-empty">No bookmarks</div>;
  }

  return (
    <div className="bookmark-panel">
      {outline.map((item, i) => (
        <BookmarkItem key={i} item={item} />
      ))}
    </div>
  );
}

function SearchResultPanel() {
  const { results, currentResultIndex, setCurrentResultIndex } = useSearchStore();
  const { setCurrentPage } = useDocumentStore();

  if (results.length === 0) {
    return <div className="sidebar-empty">No search results</div>;
  }

  return (
    <div className="search-result-panel">
      {results.map((result, i) => (
        <div
          key={i}
          className={`search-result-item ${i === currentResultIndex ? "active" : ""}`}
          onClick={() => {
            setCurrentResultIndex(i);
            setCurrentPage(result.page_num);
            (window as any).__scrollToPage?.(result.page_num);
          }}
        >
          <span className="result-page">p.{result.page_num + 1}</span>
          <span className="result-snippet">{result.snippet}</span>
          {result.match_count > 1 && (
            <span className="result-count">({result.match_count})</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Sidebar() {
  const { sidebarTab, setSidebarTab, sidebarWidth } = useViewStore();
  const { isOpen } = useDocumentStore();

  if (!isOpen || !sidebarTab) return null;

  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${sidebarTab === "thumbnails" ? "active" : ""}`}
          onClick={() => setSidebarTab("thumbnails")}
        >
          Pages
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === "bookmarks" ? "active" : ""}`}
          onClick={() => setSidebarTab("bookmarks")}
        >
          Bookmarks
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === "search-results" ? "active" : ""}`}
          onClick={() => setSidebarTab("search-results")}
        >
          Results
        </button>
      </div>
      <div className="sidebar-content">
        {sidebarTab === "thumbnails" && <ThumbnailPanel />}
        {sidebarTab === "bookmarks" && <BookmarkPanel />}
        {sidebarTab === "search-results" && <SearchResultPanel />}
      </div>
    </div>
  );
}
