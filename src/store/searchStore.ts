import { create } from "zustand";
import type { SearchResult, IndexProgress } from "../types";

interface SearchState {
  isSearchOpen: boolean;
  query: string;
  results: SearchResult[];
  currentResultIndex: number;
  isSearching: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;

  // Index status
  indexProgress: number;
  indexComplete: boolean;

  setSearchOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  setResults: (results: SearchResult[]) => void;
  setCurrentResultIndex: (index: number) => void;
  setIsSearching: (searching: boolean) => void;
  setCaseSensitive: (sensitive: boolean) => void;
  setWholeWord: (whole: boolean) => void;
  setIndexProgress: (progress: IndexProgress) => void;
  setIndexComplete: () => void;
  clearSearch: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  isSearchOpen: false,
  query: "",
  results: [],
  currentResultIndex: -1,
  isSearching: false,
  caseSensitive: false,
  wholeWord: false,
  indexProgress: 0,
  indexComplete: false,

  setSearchOpen: (open) => set({ isSearchOpen: open }),
  setQuery: (query) => set({ query }),
  setResults: (results) => set({ results, currentResultIndex: results.length > 0 ? 0 : -1 }),
  setCurrentResultIndex: (index) => set({ currentResultIndex: index }),
  setIsSearching: (searching) => set({ isSearching: searching }),
  setCaseSensitive: (sensitive) => set({ caseSensitive: sensitive }),
  setWholeWord: (whole) => set({ wholeWord: whole }),
  setIndexProgress: (progress) =>
    set({ indexProgress: progress.progress }),
  setIndexComplete: () => set({ indexComplete: true, indexProgress: 1.0 }),
  clearSearch: () =>
    set({
      query: "",
      results: [],
      currentResultIndex: -1,
      isSearching: false,
    }),
}));
