import { invoke } from "@tauri-apps/api/core";
import type {
  DocumentInfo,
  OutlineItem,
  DocumentMetadata,
  SearchResult,
  SearchOptions,
  IndexStatus,
  LinkInfo,
  TextLineInfo,
  RecentFileInfo,
} from "../types";

export async function openPdf(path: string, dpr?: number): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("open_pdf", { path, dpr });
}

export async function renderPage(
  pageNum: number,
  scale: number,
  rotation: number
): Promise<number[] | Uint8Array | ArrayBuffer> {
  return invoke("render_page", {
    pageNum,
    scale,
    rotation,
  });
}

export async function getThumbnail(pageNum: number): Promise<number[] | Uint8Array | ArrayBuffer> {
  return invoke("get_thumbnail", { pageNum });
}

export async function getOutline(): Promise<OutlineItem[]> {
  return invoke<OutlineItem[]>("get_outline");
}

export async function getDocumentProperties(): Promise<DocumentMetadata> {
  return invoke<DocumentMetadata>("get_document_properties");
}

export async function searchText(
  queryStr: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_text", { queryStr, options });
}

export async function getIndexStatus(): Promise<IndexStatus> {
  return invoke<IndexStatus>("get_index_status");
}

export async function getPageLinks(pageNum: number, priority?: number): Promise<LinkInfo[]> {
  return invoke<LinkInfo[]>("get_page_links", { pageNum, priority: priority ?? 1 });
}

export async function getPageTextLines(pageNum: number, priority?: number): Promise<TextLineInfo[]> {
  return invoke<TextLineInfo[]>("get_page_text_lines", { pageNum, priority: priority ?? 1 });
}

export async function getRecentFiles(): Promise<RecentFileInfo[]> {
  return invoke<RecentFileInfo[]>("get_recent_files");
}

export async function getFileThumbnail(path: string): Promise<string> {
  return invoke<string>("get_file_thumbnail", { path });
}

/**
 * Lightweight document switch — tell the Rust backend to set a previously
 * opened document as active.  Returns true if the document was found.
 */
export async function switchDocument(path: string): Promise<boolean> {
  return invoke<boolean>("switch_document", { path });
}

/**
 * Remove a document from Rust memory (called when a tab is closed).
 */
export async function closeDocument(path: string): Promise<void> {
  return invoke<void>("close_document", { path });
}

/// Convert raw byte data from Rust (number[], Uint8Array, or ArrayBuffer) to a blob URL
export function bytesToBlobUrl(bytes: number[] | Uint8Array | ArrayBuffer): string {
  let uint8: Uint8Array;
  if (bytes instanceof ArrayBuffer) {
    uint8 = new Uint8Array(bytes);
  } else if (bytes instanceof Uint8Array) {
    uint8 = bytes;
  } else {
    // number[]
    uint8 = new Uint8Array(bytes);
  }
  const blob = new Blob([uint8], { type: "image/png" });
  return URL.createObjectURL(blob);
}
