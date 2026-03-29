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
      <div className="toolbar-group">
        {isOpen && (
          <button
            className={`toolbar-btn ${sidebarTab ? "active" : ""}`}
            onClick={() => toggleSidebar(sidebarTab || "thumbnails")}
            title="Toggle Sidebar"
          >
            Sidebar
          </button>
        )}
      </div>

      {isOpen && (
        <>
          <div className="toolbar-group">
            <button
              className="toolbar-btn"
              onClick={handleBack}
              disabled={!canGoBack()}
              title="Go Back (Cmd+Left)"
            >
              {"◀"}
            </button>
            <button
              className="toolbar-btn"
              onClick={handleForward}
              disabled={!canGoForward()}
              title="Go Forward (Cmd+Right)"
            >
              {"▶"}
            </button>
          </div>

          <div className="toolbar-group">
            <button
              className={`toolbar-btn ${isSearchOpen ? "active" : ""}`}
              onClick={() => setSearchOpen(!isSearchOpen)}
              title="Search (Ctrl+F)"
            >
              Search
            </button>
          </div>
        </>
      )}

      <div className="toolbar-spacer" />

      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
      </button>
    </div>
  );
}
