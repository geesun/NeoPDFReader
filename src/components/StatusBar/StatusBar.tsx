import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import "./StatusBar.css";

export default function StatusBar() {
  const { isOpen, currentPage, pageCount, scale, metadata } = useDocumentStore();
  const { indexProgress, indexComplete } = useSearchStore();

  if (!isOpen) return null;

  const fileSizeStr = metadata
    ? metadata.file_size > 1048576
      ? `${(metadata.file_size / 1048576).toFixed(1)} MB`
      : `${(metadata.file_size / 1024).toFixed(0)} KB`
    : "";

  return (
    <div className="status-bar">
      <span className="status-item">
        Page {currentPage + 1} / {pageCount}
      </span>
      <span className="status-item">{Math.round(scale * 100)}%</span>
      {fileSizeStr && <span className="status-item">{fileSizeStr}</span>}
      <span className="status-spacer" />
      {!indexComplete && (
        <span className="status-item status-indexing">
          Indexing: {Math.round(indexProgress * 100)}%
        </span>
      )}
      {indexComplete && (
        <span className="status-item status-indexed">Index ready</span>
      )}
    </div>
  );
}
