import { useCallback } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import { useViewStore } from "../../store/viewStore";
import { useNavigationStore } from "../../store/navigationStore";
import { prefetchPageLinks } from "../PageViewport/PageViewport";
import "./Toolbar.css";

export default function Toolbar() {
  const {
    isOpen,
    currentPage,
    documentId,
    setCurrentPage,
  } = useDocumentStore();

  const { setSearchOpen, isSearchOpen } = useSearchStore();
  const { toggleSidebar, sidebarTab, theme, toggleTheme } = useViewStore();
  const { goBack, goForward, canGoBack, canGoForward } = useNavigationStore();

  const handleBack = useCallback(() => {
    const target = goBack(currentPage);
    if (target != null) {
      setCurrentPage(target);
      prefetchPageLinks(documentId, target);
      (window as any).__scrollToPage?.(target);
    }
  }, [currentPage, goBack, setCurrentPage, documentId]);

  const handleForward = useCallback(() => {
    const target = goForward(currentPage);
    if (target != null) {
      setCurrentPage(target);
      prefetchPageLinks(documentId, target);
      (window as any).__scrollToPage?.(target);
    }
  }, [currentPage, goForward, setCurrentPage, documentId]);

  return (
    <div className="toolbar">
      <div className="toolbar-spacer" />

      {isOpen && (
        <div className="toolbar-right">
          {/* Back / Forward */}
          <button
            className="toolbar-btn toolbar-icon-btn"
            onClick={handleBack}
            disabled={!canGoBack()}
            title="Go Back (Cmd+Left)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <button
            className="toolbar-btn toolbar-icon-btn"
            onClick={handleForward}
            disabled={!canGoForward()}
            title="Go Forward (Cmd+Right)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>

          <div className="toolbar-sep" />

          {/* Sidebar toggle */}
          <button
            className={`toolbar-btn toolbar-icon-btn ${sidebarTab ? "active" : ""}`}
            onClick={() => toggleSidebar(sidebarTab || "thumbnails")}
            title="Toggle Sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
              <line x1="5.5" y1="2" x2="5.5" y2="14" />
            </svg>
          </button>

          {/* Search toggle */}
          <button
            className={`toolbar-btn toolbar-icon-btn ${isSearchOpen ? "active" : ""}`}
            onClick={() => setSearchOpen(!isSearchOpen)}
            title="Search (Ctrl+F)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
          </button>

          <div className="toolbar-sep" />

          {/* Theme toggle */}
          <button
            className="toolbar-btn toolbar-icon-btn"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="3.5" />
                <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.5 9.2A5.5 5.5 0 0 1 6.8 2.5 5.5 5.5 0 1 0 13.5 9.2z" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Theme toggle when no document is open */}
      {!isOpen && (
        <button
          className="toolbar-btn toolbar-icon-btn"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="3.5" />
              <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 9.2A5.5 5.5 0 0 1 6.8 2.5 5.5 5.5 0 1 0 13.5 9.2z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
