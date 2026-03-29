import { useCallback, useEffect, useRef } from "react";
import { searchText } from "../../services/tauriApi";
import { useSearchStore } from "../../store/searchStore";
import { useDocumentStore } from "../../store/documentStore";
import "./SearchBar.css";

export default function SearchPanel() {
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
    <div className="search-panel">
      <div className="search-panel-header">
        <span className="search-panel-title">Search</span>
        <button
          className="search-panel-close"
          onClick={() => {
            clearSearch();
            setSearchOpen(false);
          }}
          title="Close search"
        >
          {"×"}
        </button>
      </div>

      <div className="search-panel-input-row">
        <input
          ref={inputRef}
          type="text"
          className="search-panel-input"
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="search-panel-go" onClick={doSearch} disabled={isSearching}>
          {isSearching ? "..." : "Go"}
        </button>
      </div>

      <div className="search-panel-options">
        <label className="search-panel-option">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Case
        </label>
        <label className="search-panel-option">
          <input
            type="checkbox"
            checked={wholeWord}
            onChange={(e) => setWholeWord(e.target.checked)}
          />
          Word
        </label>
        {results.length > 0 && (
          <div className="search-panel-nav">
            <button className="search-panel-nav-btn" onClick={() => navigateResult(-1)}>
              {"↑"}
            </button>
            <span className="search-panel-count">
              {currentResultIndex + 1}/{results.length}
            </span>
            <button className="search-panel-nav-btn" onClick={() => navigateResult(1)}>
              {"↓"}
            </button>
          </div>
        )}
      </div>

      {!indexComplete && (
        <div className="search-panel-index-bar">
          <div
            className="search-panel-index-fill"
            style={{ width: `${indexProgress * 100}%` }}
          />
        </div>
      )}

      <div className="search-panel-results">
        {results.length === 0 && query.trim() && !isSearching && (
          <div className="search-panel-empty">No results</div>
        )}
        {results.map((result, i) => (
          <div
            key={i}
            className={`search-panel-result ${i === currentResultIndex ? "active" : ""}`}
            onClick={() => {
              setCurrentResultIndex(i);
              setCurrentPage(result.page_num);
              (window as any).__scrollToPage?.(result.page_num);
            }}
          >
            <span className="search-result-page">p.{result.page_num + 1}</span>
            <span className="search-result-snippet">{result.snippet}</span>
            {result.match_count > 1 && (
              <span className="search-result-match-count">({result.match_count})</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
