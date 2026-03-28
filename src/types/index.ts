// Types shared between frontend and Rust backend

export interface PageSize {
  width: number;
  height: number;
}

export interface DocumentMetadata {
  title: string;
  author: string;
  subject: string;
  creator: string;
  producer: string;
  page_count: number;
  file_path: string;
  file_size: number;
}

export interface DocumentInfo {
  metadata: DocumentMetadata;
  page_sizes: PageSize[];
  /** Last page the user was viewing when this file was previously closed. 0 = first open. */
  last_page: number;
  /**
   * Pre-rendered PNG of `last_page`, base64-encoded.
   * Inject directly into pageImageCache so the page shows with zero extra IPC.
   * null if pre-rendering failed (fallback: render_page will be called normally).
   */
  initial_page_png: string | null;
}

export interface OutlineItem {
  title: string;
  page: number;
  children: OutlineItem[];
}

export interface SearchHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchResult {
  page_num: number;
  snippet: string;
  highlights: SearchHighlight[];
  match_count: number;
}

export interface SearchOptions {
  case_sensitive: boolean;
  whole_word: boolean;
  max_results: number;
}

export interface IndexProgress {
  current: number;
  total: number;
  progress: number;
}

export interface IndexStatus {
  progress: number;
  is_complete: boolean;
  indexed_count: number;
}

export type ViewMode = "single" | "continuous";
