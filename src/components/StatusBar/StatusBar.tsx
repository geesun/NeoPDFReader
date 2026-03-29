import { useCallback } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import "./StatusBar.css";

export default function StatusBar() {
  const { isOpen, currentPage, pageCount, scale, metadata, setCurrentPage, setScale } =
    useDocumentStore();
  const { indexProgress, indexComplete } = useSearchStore();

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

  const zoomIn = () => setScale(Math.round((scale + 0.25) * 100) / 100);
  const zoomOut = () => setScale(Math.round((scale - 0.25) * 100) / 100);
  const zoomFit = () => setScale(1.0);

  if (!isOpen) return null;

  const fileSizeStr = metadata
    ? metadata.file_size > 1048576
      ? `${(metadata.file_size / 1048576).toFixed(1)} MB`
      : `${(metadata.file_size / 1024).toFixed(0)} KB`
    : "";

  return (
    <div className="status-bar">
      <div className="status-left">
        {fileSizeStr && <span className="status-item">{fileSizeStr}</span>}
      </div>

      <div className="status-center">
        <button
          className="status-nav-btn"
          onClick={prevPage}
          disabled={currentPage <= 0}
          title="Previous page"
        >
          {"‹"}
        </button>
        <input
          className="status-page-input"
          type="text"
          defaultValue={currentPage + 1}
          key={currentPage}
          onKeyDown={handlePageInput}
          title="Go to page"
        />
        <span className="status-page-count">/ {pageCount}</span>
        <button
          className="status-nav-btn"
          onClick={nextPage}
          disabled={currentPage >= pageCount - 1}
          title="Next page"
        >
          {"›"}
        </button>
      </div>

      <div className="status-right">
        <div className="status-zoom">
          <button className="status-nav-btn" onClick={zoomOut} title="Zoom Out">
            {"\u2212"}
          </button>
          <span className="status-zoom-label">{Math.round(scale * 100)}%</span>
          <button className="status-nav-btn" onClick={zoomIn} title="Zoom In">
            +
          </button>
          <button className="status-zoom-fit" onClick={zoomFit} title="Fit Page">
            Fit
          </button>
        </div>
        {!indexComplete && (
          <span className="status-item status-indexing">
            Indexing: {Math.round(indexProgress * 100)}%
          </span>
        )}
        {indexComplete && (
          <span className="status-item status-indexed">Index ready</span>
        )}
      </div>
    </div>
  );
}
