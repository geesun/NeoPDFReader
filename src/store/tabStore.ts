import { create } from "zustand";
import type { PageSize, DocumentMetadata, SearchResult } from "../types";

// ── Per-tab snapshot ────────────────────────────────────────────────────────
// Captures everything needed to fully restore a PDF tab's state when the user
// switches back to it.

export interface DocumentSnapshot {
  filePath: string;
  documentId: number;
  metadata: DocumentMetadata;
  pageSizes: PageSize[];
  pageCount: number;
  currentPage: number;
  scale: number;
  rotation: number;
  initialPage: number;
  // Search state
  searchQuery: string;
  searchResults: SearchResult[];
  searchCurrentIndex: number;
  isSearchOpen: boolean;
  indexProgress: number;
  indexComplete: boolean;
  // Navigation stacks
  backStack: number[];
  forwardStack: number[];
}

// ── Tab types ───────────────────────────────────────────────────────────────

export interface HomeTab {
  id: "home";
  type: "home";
}

export interface PdfTab {
  id: string;
  type: "pdf";
  filePath: string;
  /** Display name (filename only) */
  title: string;
  /** Saved state — populated when the tab is NOT active. */
  snapshot: DocumentSnapshot | null;
}

export type Tab = HomeTab | PdfTab;

// ── Store ───────────────────────────────────────────────────────────────────

interface TabState {
  tabs: Tab[];
  activeTabId: string;

  /** Switch to an existing tab. The caller is responsible for saving the
   *  current tab's snapshot BEFORE calling this. */
  setActiveTab: (tabId: string) => void;

  /** Add a new PDF tab and switch to it. Returns the new tab's id. */
  addPdfTab: (filePath: string, title: string) => string;

  /** Close a PDF tab. Home tab cannot be closed.
   *  If the closed tab was active, activates the nearest neighbour. */
  closeTab: (tabId: string) => void;

  /** Find a PDF tab by its file path (for dedup — reuse existing tab). */
  findTabByPath: (filePath: string) => PdfTab | undefined;

  /** Store a snapshot on a specific tab (called before switching away). */
  saveSnapshot: (tabId: string, snapshot: DocumentSnapshot) => void;

  /** Clear the snapshot on a tab (called after restoring it). */
  clearSnapshot: (tabId: string) => void;
}

let _nextTabId = 1;

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [{ id: "home", type: "home" } as HomeTab],
  activeTabId: "home",

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  addPdfTab: (filePath, title) => {
    const id = `pdf-${_nextTabId++}`;
    const tab: PdfTab = { id, type: "pdf", filePath, title, snapshot: null };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (tabId) => {
    if (tabId === "home") return; // Home cannot be closed
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return state;
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActive = state.activeTabId;
      if (state.activeTabId === tabId) {
        // Activate nearest neighbour: prefer right, then left
        const rightNeighbour = state.tabs[idx + 1];
        const leftNeighbour = state.tabs[idx - 1];
        newActive = (rightNeighbour ?? leftNeighbour)?.id ?? "home";
      }
      return { tabs: newTabs, activeTabId: newActive };
    });
  },

  findTabByPath: (filePath) => {
    return get().tabs.find(
      (t): t is PdfTab => t.type === "pdf" && t.filePath === filePath
    );
  },

  saveSnapshot: (tabId, snapshot) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "pdf" ? { ...t, snapshot } : t
      ),
    })),

  clearSnapshot: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.type === "pdf" ? { ...t, snapshot: null } : t
      ),
    })),
}));
