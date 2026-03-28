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

  setDocument: (info: DocumentInfo, path: string) => void;
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

  setDocument: (info, path) =>
    set((state) => ({
      isOpen: true,
      filePath: path,
      documentId: state.documentId + 1,
      metadata: info.metadata,
      pageSizes: info.page_sizes,
      pageCount: info.metadata.page_count,
      currentPage: 0,
      scale: 1.0,
      rotation: 0,
    })),

  closeDocument: () =>
    set({
      isOpen: false,
      filePath: null,
      metadata: null,
      pageSizes: [],
      pageCount: 0,
      currentPage: 0,
    }),

  setCurrentPage: (page) => set({ currentPage: page }),
  setScale: (scale) => set({ scale: Math.max(0.25, Math.min(6.4, scale)) }),
  setRotation: (rotation) => set({ rotation: rotation % 360 }),
}));
