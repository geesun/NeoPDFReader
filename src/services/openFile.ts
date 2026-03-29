/**
 * Shared open-file logic used by App (Cmd+O), HomeScreen, and TabBar.
 * Extracted into its own module to avoid circular imports between App.tsx
 * and PageViewport.tsx.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { openPdf } from "./tauriApi";
import { useDocumentStore } from "../store/documentStore";
import { useSearchStore } from "../store/searchStore";
import { useNavigationStore } from "../store/navigationStore";
import { useTabStore } from "../store/tabStore";
import { injectPrerenderedPage } from "../components/PageViewport/PageViewport";

/**
 * Open a PDF file: if the file is already open in a tab, switch to it;
 * otherwise create a new tab.  Returns true if a file was opened.
 */
export async function openFileInTab(path: string): Promise<boolean> {
  const tabStore = useTabStore.getState();
  const docStore = useDocumentStore.getState();
  const searchStore = useSearchStore.getState();
  const navStore = useNavigationStore.getState();

  // Check if the file is already open in a tab
  const existing = tabStore.findTabByPath(path);
  if (existing) {
    const { activeTabId, tabs } = tabStore;
    // Save current tab's state first
    const currentTab = tabs.find((t) => t.id === activeTabId);
    if (currentTab?.type === "pdf" && activeTabId !== existing.id) {
      const snapshot = docStore.takeSnapshot();
      if (snapshot) {
        snapshot.searchQuery = searchStore.query;
        snapshot.searchResults = searchStore.results;
        snapshot.searchCurrentIndex = searchStore.currentResultIndex;
        snapshot.isSearchOpen = searchStore.isSearchOpen;
        snapshot.indexProgress = searchStore.indexProgress;
        snapshot.indexComplete = searchStore.indexComplete;
        snapshot.backStack = navStore.backStack;
        snapshot.forwardStack = navStore.forwardStack;
        tabStore.saveSnapshot(activeTabId, snapshot);
      }
    }
    // Restore the existing tab's snapshot
    if (existing.snapshot) {
      docStore.restoreSnapshot(existing.snapshot);
      searchStore.setQuery(existing.snapshot.searchQuery);
      searchStore.setResults(existing.snapshot.searchResults);
      searchStore.setCurrentResultIndex(existing.snapshot.searchCurrentIndex);
      searchStore.setSearchOpen(existing.snapshot.isSearchOpen);
      navStore.clearHistory();
      useNavigationStore.setState({
        backStack: existing.snapshot.backStack,
        forwardStack: existing.snapshot.forwardStack,
      });
      tabStore.clearSnapshot(existing.id);
    }
    tabStore.setActiveTab(existing.id);
    return true;
  }

  // New file — save current tab first
  const { activeTabId, tabs } = tabStore;
  const currentTab = tabs.find((t) => t.id === activeTabId);
  if (currentTab?.type === "pdf") {
    const snapshot = docStore.takeSnapshot();
    if (snapshot) {
      snapshot.searchQuery = searchStore.query;
      snapshot.searchResults = searchStore.results;
      snapshot.searchCurrentIndex = searchStore.currentResultIndex;
      snapshot.isSearchOpen = searchStore.isSearchOpen;
      snapshot.indexProgress = searchStore.indexProgress;
      snapshot.indexComplete = searchStore.indexComplete;
      snapshot.backStack = navStore.backStack;
      snapshot.forwardStack = navStore.forwardStack;
      tabStore.saveSnapshot(activeTabId, snapshot);
    }
  }

  // Open the PDF via Tauri
  const dpr = window.devicePixelRatio || 1;
  const info = await openPdf(path, dpr);

  // Extract filename for the tab title
  const segments = path.replace(/\\/g, "/").split("/");
  const title = segments[segments.length - 1] || path;

  // Create the new tab (this also sets it as active)
  tabStore.addPdfTab(path, title);

  // Inject pre-rendered page BEFORE setDocument bumps documentId
  if (info.initial_page_png) {
    const nextDocumentId = useDocumentStore.getState().documentId + 1;
    injectPrerenderedPage(nextDocumentId, info.last_page, info.initial_page_png, dpr);
  }

  // Reset search and navigation for the new document
  searchStore.clearSearch();
  searchStore.setSearchOpen(false);
  navStore.clearHistory();

  useDocumentStore.getState().setDocument(info, path);
  return true;
}

/**
 * Show the native file picker, then open the selected file in a tab.
 */
export async function openFileDialog(): Promise<void> {
  const selected = await open({
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    multiple: false,
  });
  if (selected) {
    const path = typeof selected === "string" ? selected : selected;
    await openFileInTab(path as string);
  }
}
