import { useCallback } from "react";
import { useTabStore } from "../../store/tabStore";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import { useNavigationStore } from "../../store/navigationStore";
import { useViewStore } from "../../store/viewStore";
import { prefetchPageLinks } from "../PageViewport/PageViewport";
import type { DocumentSnapshot, PdfTab } from "../../store/tabStore";
import "./TabBar.css";

/** Build a full snapshot from the current global stores. */
function captureFullSnapshot(): DocumentSnapshot | null {
  const docSnap = useDocumentStore.getState().takeSnapshot();
  if (!docSnap) return null;

  const search = useSearchStore.getState();
  docSnap.searchQuery = search.query;
  docSnap.searchResults = search.results;
  docSnap.searchCurrentIndex = search.currentResultIndex;
  docSnap.isSearchOpen = search.isSearchOpen;
  docSnap.indexProgress = search.indexProgress;
  docSnap.indexComplete = search.indexComplete;

  const nav = useNavigationStore.getState();
  docSnap.backStack = nav.backStack;
  docSnap.forwardStack = nav.forwardStack;

  return docSnap;
}

/** Restore a full snapshot into all global stores. */
function restoreFullSnapshot(snapshot: DocumentSnapshot) {
  useDocumentStore.getState().restoreSnapshot(snapshot);

  const search = useSearchStore.getState();
  search.setQuery(snapshot.searchQuery);
  search.setResults(snapshot.searchResults);
  search.setCurrentResultIndex(snapshot.searchCurrentIndex);
  search.setSearchOpen(snapshot.isSearchOpen);

  const nav = useNavigationStore.getState();
  nav.clearHistory();
  useNavigationStore.setState({
    backStack: snapshot.backStack,
    forwardStack: snapshot.forwardStack,
  });
}

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const { setActiveTab, closeTab, saveSnapshot, clearSnapshot } = useTabStore();

  const { isOpen, currentPage, documentId, setCurrentPage, closeDocument } =
    useDocumentStore();
  const { setSearchOpen, isSearchOpen } = useSearchStore();
  const { toggleSidebar, sidebarTab, theme, toggleTheme, activeTool, setActiveTool } = useViewStore();
  const { goBack, goForward, canGoBack, canGoForward } = useNavigationStore();

  const handleSwitchTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) return;

      const currentTab = tabs.find((t) => t.id === activeTabId);
      if (currentTab?.type === "pdf") {
        const snapshot = captureFullSnapshot();
        if (snapshot) {
          saveSnapshot(activeTabId, snapshot);
        }
      }

      setActiveTab(tabId);

      const newTab = tabs.find((t) => t.id === tabId);
      if (newTab?.type === "pdf" && (newTab as PdfTab).snapshot) {
        restoreFullSnapshot((newTab as PdfTab).snapshot!);
        clearSnapshot(tabId);
      } else if (newTab?.type === "home") {
        closeDocument();
      }
    },
    [activeTabId, tabs, setActiveTab, saveSnapshot, clearSnapshot, closeDocument]
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation();
      if (tabId === "home") return;

      if (tabId === activeTabId) {
        const idx = tabs.findIndex((t) => t.id === tabId);
        const rightNeighbour = tabs[idx + 1];
        const leftNeighbour = tabs[idx - 1];
        const nextTab = rightNeighbour ?? leftNeighbour;

        if (nextTab?.type === "pdf" && (nextTab as PdfTab).snapshot) {
          restoreFullSnapshot((nextTab as PdfTab).snapshot!);
          clearSnapshot(nextTab.id);
        } else {
          closeDocument();
        }
      }

      closeTab(tabId);
    },
    [activeTabId, tabs, closeTab, clearSnapshot, closeDocument]
  );

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
    <div className="tab-bar">
      {/* ── Tabs ── */}
      <div className="tab-bar-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? "active" : ""} ${tab.type === "home" ? "home" : ""}`}
            onClick={() => handleSwitchTab(tab.id)}
            title={tab.type === "pdf" ? (tab as PdfTab).filePath : "Home"}
          >
            {tab.type === "home" ? (
              <svg
                className="tab-home-icon"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 6.5L8 2l5.5 4.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V6.5z" />
                <path d="M6 14V9h4v5" />
              </svg>
            ) : null}
            <span className="tab-label">
              {tab.type === "home" ? "Home" : (tab as PdfTab).title}
            </span>
            {tab.type === "pdf" && (
              <button
                className="tab-close"
                onClick={(e) => handleCloseTab(e, tab.id)}
                title="Close tab"
              >
                {"×"}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ── Right-side action buttons ── */}
      <div className="tab-bar-actions">
        {isOpen && (
          <>
            <button
              className="tab-action-btn"
              onClick={handleBack}
              disabled={!canGoBack()}
              title="Go Back (Cmd+Left)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3L5 8l5 5" />
              </svg>
            </button>
            <button
              className="tab-action-btn"
              onClick={handleForward}
              disabled={!canGoForward()}
              title="Go Forward (Cmd+Right)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3l5 5-5 5" />
              </svg>
            </button>

            <div className="tab-action-sep" />

            <button
              className={`tab-action-btn ${sidebarTab ? "active" : ""}`}
              onClick={() => toggleSidebar(sidebarTab || "thumbnails")}
              title="Toggle Sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
                <line x1="5.5" y1="2" x2="5.5" y2="14" />
              </svg>
            </button>

            <button
              className="tab-action-btn"
              onClick={() => setActiveTool(activeTool === "hand" ? "text-select" : "hand")}
              title={activeTool === "hand" ? "Switch to Text Select" : "Switch to Hand Tool"}
            >
              {activeTool === "hand" ? (
                /* Hand icon — currently in hand mode */
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5.5 8V3.5a1 1 0 0 1 2 0V7" />
                  <path d="M7.5 7V2.5a1 1 0 0 1 2 0V7" />
                  <path d="M9.5 7V3.5a1 1 0 0 1 2 0V7" />
                  <path d="M11.5 7V5.5a1 1 0 0 1 2 0V10a4.5 4.5 0 0 1-4.5 4.5h-1A4.5 4.5 0 0 1 3.5 10V8a1 1 0 0 1 2 0" />
                </svg>
              ) : (
                /* I-beam icon — currently in text-select mode */
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2.5h1.5a2 2 0 0 1 2 2v0" />
                  <path d="M10 2.5H8.5a2 2 0 0 0-2 2v0" />
                  <line x1="8" y1="4.5" x2="8" y2="11.5" />
                  <path d="M6 13.5h1.5a2 2 0 0 0 2-2v0" />
                  <path d="M10 13.5H8.5a2 2 0 0 1-2-2v0" />
                  <line x1="6.5" y1="8" x2="9.5" y2="8" />
                </svg>
              )}
            </button>

            <button
              className={`tab-action-btn ${isSearchOpen ? "active" : ""}`}
              onClick={() => setSearchOpen(!isSearchOpen)}
              title="Search (Ctrl+F)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
            </button>

            <div className="tab-action-sep" />
          </>
        )}

        <button
          className="tab-action-btn"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="3.5" />
              <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 9.2A5.5 5.5 0 0 1 6.8 2.5 5.5 5.5 0 1 0 13.5 9.2z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
