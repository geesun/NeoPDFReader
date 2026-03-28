import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPdf } from "../../services/tauriApi";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import { useViewStore } from "../../store/viewStore";
import "./Toolbar.css";

export default function Toolbar() {
  const {
    isOpen,
    currentPage,
    pageCount,
    scale,
    setCurrentPage,
    setScale,
    setDocument,
  } = useDocumentStore();

  const { setSearchOpen, isSearchOpen } = useSearchStore();
  const { toggleSidebar, sidebarTab } = useViewStore();

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        multiple: false,
      });
      if (selected) {
        const path = typeof selected === "string" ? selected : selected;
        const info = await openPdf(path as string);
        setDocument(info, path as string);
      }
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, [setDocument]);

  const handlePageInput = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        if (!isNaN(val) && val >= 1 && val <= pageCount) {
          setCurrentPage(val - 1);
          (window as any).__scrollToPage?.(val - 1);
        }
      }
    },
    [pageCount, setCurrentPage]
  );

  const zoomIn = () => setScale(Math.round((scale + 0.25) * 100) / 100);
  const zoomOut = () => setScale(Math.round((scale - 0.25) * 100) / 100);
  const zoomFit = () => setScale(1.0);

  const prevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
      (window as any).__scrollToPage?.(currentPage - 1);
    }
  };

  const nextPage = () => {
    if (currentPage < pageCount - 1) {
      setCurrentPage(currentPage + 1);
      (window as any).__scrollToPage?.(currentPage + 1);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="toolbar-btn" onClick={handleOpenFile} title="Open PDF (Ctrl+O)">
          Open
        </button>
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
          <div className="toolbar-group toolbar-nav">
            <button className="toolbar-btn" onClick={prevPage} disabled={currentPage <= 0}>
              &lt;
            </button>
            <input
              className="page-input"
              type="text"
              defaultValue={currentPage + 1}
              key={currentPage}
              onKeyDown={handlePageInput}
              title="Go to page"
            />
            <span className="page-count">/ {pageCount}</span>
            <button
              className="toolbar-btn"
              onClick={nextPage}
              disabled={currentPage >= pageCount - 1}
            >
              &gt;
            </button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={zoomOut} title="Zoom Out">
              -
            </button>
            <span className="zoom-label">{Math.round(scale * 100)}%</span>
            <button className="toolbar-btn" onClick={zoomIn} title="Zoom In">
              +
            </button>
            <button className="toolbar-btn" onClick={zoomFit} title="Fit Page">
              Fit
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
    </div>
  );
}
