import { create } from "zustand";
import type { DocumentInfo, PageSize, DocumentMetadata } from "../types";

interface DocumentState {
  isOpen: boolean;
  filePath: string | null;
  /** Monotonically increasing counter — bumped every time a new file is opened.
   *  Used as React key on PageCanvas to force full remount (clears stale blobs). */
  documentId: number;
  metadata: DocumentMetadata | null;
  pageSizes: PageSize[];
  pageCount: number;
  currentPage: number;
  scale: number;
  rotation: number;
  /** Page to restore on open (from reading history). 0 = start from beginning. */
  initialPage: number;

  setDocument: (info: DocumentInfo, path: string) => void;
  /** Append streamed page sizes arriving via "page-sizes-chunk" events. */
  appendPageSizes: (start: number, sizes: PageSize[]) => void;
  closeDocument: () => void;
  setCurrentPage: (page: number) => void;
  setScale: (scale: number) => void;
  setRotation: (rotation: number) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  isOpen: false,
  filePath: null,
  documentId: 0,
  metadata: null,
  pageSizes: [],
  pageCount: 0,
  currentPage: 0,
  scale: 1.0,
  rotation: 0,
  initialPage: 0,

  setDocument: (info, path) =>
    set((state) => {
      // Pre-allocate pageSizes array to full page_count, filled with A4 defaults
      // for pages we haven't received yet.  This lets virtual scroll compute a
      // stable totalHeight immediately while remaining chunks arrive.
      const total = info.metadata.page_count;
      const sizes: PageSize[] = Array.from({ length: total }, () => ({
        width: 595,
        height: 842,
      }));
      // Overwrite the slots we already have from the eager batch.
      for (let i = 0; i < info.page_sizes.length; i++) {
        sizes[i] = info.page_sizes[i];
      }
      const restoredPage = Math.min(info.last_page ?? 0, total - 1);
      return {
        isOpen: true,
        filePath: path,
        documentId: state.documentId + 1,
        metadata: info.metadata,
        pageSizes: sizes,
        pageCount: total,
        currentPage: restoredPage,
        scale: 1.0,
        rotation: 0,
        initialPage: restoredPage,
      };
    }),

  appendPageSizes: (start, sizes) =>
    set((state) => {
      // Immutably splice the new sizes into the correct positions.
      const next = state.pageSizes.slice();
      for (let i = 0; i < sizes.length; i++) {
        if (start + i < next.length) {
          next[start + i] = sizes[i];
        }
      }
      return { pageSizes: next };
    }),

  closeDocument: () =>
    set({
      isOpen: false,
      filePath: null,
      metadata: null,
      pageSizes: [],
      pageCount: 0,
      currentPage: 0,
      initialPage: 0,
    }),

  setCurrentPage: (page) => set({ currentPage: page }),
  setScale: (scale) => set({ scale: Math.max(0.25, Math.min(6.4, scale)) }),
  setRotation: (rotation) => set({ rotation: rotation % 360 }),
}));
