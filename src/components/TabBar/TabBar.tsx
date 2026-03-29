import { useCallback } from "react";
import { useTabStore } from "../../store/tabStore";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import { useNavigationStore } from "../../store/navigationStore";
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
  // Index state: we approximate by setting indexProgress/indexComplete directly
  // via the store (these are not critical — the index will be rebuilt if needed).

  const nav = useNavigationStore.getState();
  nav.clearHistory();
  // Restore back/forward stacks by setting them directly.
  useNavigationStore.setState({
    backStack: snapshot.backStack,
    forwardStack: snapshot.forwardStack,
  });
}

export default function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const { setActiveTab, closeTab, saveSnapshot, clearSnapshot } = useTabStore();
  const { closeDocument } = useDocumentStore();

  const handleSwitchTab = useCallback(
    (tabId: string) => {
      if (tabId === activeTabId) return;

      // 1. Save current tab's state (if it's a PDF tab)
      const currentTab = tabs.find((t) => t.id === activeTabId);
      if (currentTab?.type === "pdf") {
        const snapshot = captureFullSnapshot();
        if (snapshot) {
          saveSnapshot(activeTabId, snapshot);
        }
      }

      // 2. Switch to the new tab
      setActiveTab(tabId);

      // 3. Restore the new tab's state
      const newTab = tabs.find((t) => t.id === tabId);
      if (newTab?.type === "pdf" && (newTab as PdfTab).snapshot) {
        restoreFullSnapshot((newTab as PdfTab).snapshot!);
        clearSnapshot(tabId);
      } else if (newTab?.type === "home") {
        // Switching to Home — clear document state
        closeDocument();
      }
    },
    [activeTabId, tabs, setActiveTab, saveSnapshot, clearSnapshot, closeDocument]
  );

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation(); // Don't trigger the tab switch
      if (tabId === "home") return;

      // If closing the active tab, we need to clean up first
      if (tabId === activeTabId) {
        // Find the tab that will become active after close
        const idx = tabs.findIndex((t) => t.id === tabId);
        const rightNeighbour = tabs[idx + 1];
        const leftNeighbour = tabs[idx - 1];
        const nextTab = rightNeighbour ?? leftNeighbour;

        if (nextTab?.type === "pdf" && (nextTab as PdfTab).snapshot) {
          restoreFullSnapshot((nextTab as PdfTab).snapshot!);
          clearSnapshot(nextTab.id);
        } else {
          // Going to home or another tab without snapshot
          closeDocument();
        }
      }

      closeTab(tabId);
    },
    [activeTabId, tabs, closeTab, clearSnapshot, closeDocument]
  );

  return (
    <div className="tab-bar">
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
  );
}
