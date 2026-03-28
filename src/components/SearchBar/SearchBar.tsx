import { useCallback, useEffect, useRef } from "react";
import { searchText } from "../../services/tauriApi";
import { useSearchStore } from "../../store/searchStore";
import { useDocumentStore } from "../../store/documentStore";
import "./SearchBar.css";

export default function SearchBar() {
  const {
    isSearchOpen,
    query,
    results,
    currentResultIndex,
    isSearching,
    caseSensitive,
    wholeWord,
    indexProgress,
    indexComplete,
    setQuery,
    setResults,
    setCurrentResultIndex,
    setIsSearching,
    setCaseSensitive,
    setWholeWord,
    setSearchOpen,
    clearSearch,
  } = useSearchStore();

  const { setCurrentPage } = useDocumentStore();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when search opens
  useEffect(() => {
    if (isSearchOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isSearchOpen]);

  // Ctrl+F to toggle search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && isSearchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen, setSearchOpen]);

  const doSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await searchText(query, {
        case_sensitive: caseSensitive,
        whole_word: wholeWord,
        max_results: 1000,
      });
      setResults(res);
      // Jump to first result
      if (res.length > 0) {
        setCurrentPage(res[0].page_num);
        (window as any).__scrollToPage?.(res[0].page_num);
      }
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, [query, caseSensitive, wholeWord, setResults, setIsSearching, setCurrentPage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        navigateResult(-1);
      } else {
        if (results.length > 0) {
          navigateResult(1);
        } else {
          doSearch();
        }
      }
    }
  };

  const navigateResult = (direction: number) => {
    if (results.length === 0) return;
    let newIdx = currentResultIndex + direction;
    if (newIdx >= results.length) newIdx = 0;
    if (newIdx < 0) newIdx = results.length - 1;
    setCurrentResultIndex(newIdx);
    const result = results[newIdx];
    setCurrentPage(result.page_num);
    (window as any).__scrollToPage?.(result.page_num);
  };

  if (!isSearchOpen) return null;

  return (
    <div className="search-bar">
      <div className="search-input-group">
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search in document..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="search-btn" onClick={doSearch} disabled={isSearching}>
          {isSearching ? "..." : "Go"}
        </button>
      </div>

      <div className="search-options">
        <label className="search-option">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Aa
        </label>
        <label className="search-option">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
          />
          Word
        </label>
      </div>

      {results.length > 0 && (
        <div className="search-nav">
          <span className="search-count">
            {currentResultIndex + 1} / {results.length}
          </span>
          <button className="search-nav-btn" onClick={() => navigateResult(-1)}>
            &uarr;
          </button>
          <button className="search-nav-btn" onClick={() => navigateResult(1)}>
            &darr;
          </button>
        </div>
      )}

      {!indexComplete && (
        <div className="index-progress">
          <div
            className="index-progress-bar"
            style={{ width: `${indexProgress * 100}%` }}
          />
        </div>
      )}

      <button
        className="search-close-btn"
        onClick={() => {
          clearSearch();
          setSearchOpen(false);
        }}
      >
        x
      </button>
    </div>
  );
}
