import { useEffect, useState, useCallback } from "react";
import { getThumbnail, getOutline, bytesToBlobUrl } from "../../services/tauriApi";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import { useViewStore } from "../../store/viewStore";
import type { OutlineItem } from "../../types";
import "./Sidebar.css";

function ThumbnailItem({ pageNum }: { pageNum: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const { currentPage, setCurrentPage } = useDocumentStore();

  // Lazy load: only fetch when visible
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getThumbnail(pageNum)
      .then((bytes) => {
        if (cancelled) return;
        setSrc(bytesToBlobUrl(bytes));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pageNum, visible]);

  // IntersectionObserver for lazy loading
  const refCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        },
        { threshold: 0.1 }
      );
      observer.observe(node);
    },
    []
  );

  return (
    <div
      ref={refCallback}
      className={`thumbnail-item ${pageNum === currentPage ? "active" : ""}`}
      onClick={() => {
        setCurrentPage(pageNum);
        (window as any).__scrollToPage?.(pageNum);
      }}
    >
      {src ? (
        <img src={src} alt={`Page ${pageNum + 1}`} draggable={false} />
      ) : (
        <div className="thumbnail-placeholder" />
      )}
      <span className="thumbnail-label">{pageNum + 1}</span>
    </div>
  );
}

function ThumbnailPanel() {
  const { pageCount } = useDocumentStore();

  return (
    <div className="thumbnail-panel">
      {Array.from({ length: pageCount }, (_, i) => (
        <ThumbnailItem key={i} pageNum={i} />
      ))}
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
