import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { bytesToBlobUrl, getPageLinks, getPageTextLines, getRecentFiles, getFileThumbnail } from "../../services/tauriApi";
import { useDocumentStore } from "../../store/documentStore";
import { useSearchStore } from "../../store/searchStore";
import { useNavigationStore } from "../../store/navigationStore";
import { openFileInTab, openFileDialog } from "../../services/openFile";
import type { LinkInfo, TextLineInfo, RecentFileInfo } from "../../types";
import "./PageViewport.css";
// ─── Front-end page image cache ───────────────────────────────────────────────
//
// Stores blob URLs for pages that have already been rendered.
// Key: `${documentId}:${pageNum}:${scaleKey}:${rotation}`
// When a PageCanvas mounts and its key is already in this map, it shows the
// image immediately with zero loading flash.
// When a new document is opened (documentId changes) the old entries are
// revoked and cleared.

const pageImageCache = new Map<string, string>();
let cachedDocumentId = -1;

function makeImageKey(documentId: number, pageNum: number, scale: number, rotation: number) {
  // Round scale to 3 decimal places so tiny float noise doesn't create duplicate entries.
  return `${documentId}:${pageNum}:${scale.toFixed(3)}:${rotation}`;
}

function clearImageCacheForDoc(documentId: number) {
  if (cachedDocumentId === documentId) return;
  // Revoke all old blob URLs to free browser memory.
  for (const url of pageImageCache.values()) {
    URL.revokeObjectURL(url);
  }
  pageImageCache.clear();
  cachedDocumentId = documentId;
}

/**
 * Pre-inject a pre-rendered page image into the cache so PageCanvas shows it
 * synchronously on first mount — no render_page IPC call needed.
 *
 * Called from App.tsx immediately after open_pdf returns, before setDocument,
 * using the documentId that setDocument is *about* to assign (current + 1).
 *
 * The pre-rendered PNG is at scale=dpr (e.g. 2.0 on Retina), rotation=0,
 * which matches the default view state on open (logical scale=1.0 × DPR).
 */
export function injectPrerenderedPage(
  documentId: number,
  pageNum: number,
  pngBase64: string,
  dpr: number,
): void {
  // The cache key must match what PageCanvas will look for:
  // renderScale = logicalScale(1.0) × dpr.
  const renderScale = 1.0 * dpr;
  const key = makeImageKey(documentId, pageNum, renderScale, 0);
  // If there's already an entry (e.g. user reopened same file), revoke old URL.
  const existing = pageImageCache.get(key);
  if (existing) URL.revokeObjectURL(existing);

  const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "image/png" });
  pageImageCache.set(key, URL.createObjectURL(blob));
}

// ─── PageHighlights ───────────────────────────────────────────────────────────

const PageHighlights = memo(function PageHighlights({
  pageNum,
  scale,
}: {
  pageNum: number;
  scale: number;
}) {
  const results = useSearchStore((s) => s.results);
  const currentResultIndex = useSearchStore((s) => s.currentResultIndex);

  const pageHighlights = useMemo(
    () => results.filter((r) => r.page_num === pageNum),
    [results, pageNum]
  );

  if (pageHighlights.length === 0) return null;

  const isCurrentResultPage =
    currentResultIndex >= 0 && results[currentResultIndex]?.page_num === pageNum;

  return (
    <div className="highlight-overlay">
      {pageHighlights.map((result, ri) =>
        result.highlights.map((hl, hi) => (
          <div
            key={`${ri}-${hi}`}
            className={`search-highlight ${isCurrentResultPage ? "current" : ""}`}
            style={{
              left: hl.x * scale,
              top: hl.y * scale,
              width: hl.width * scale,
              height: hl.height * scale,
            }}
          />
        ))
      )}
    </div>
  );
});

// ─── Link cache ───────────────────────────────────────────────────────────────
//
// Per-page link data fetched lazily and cached per-document.
// Key: `${documentId}:${pageNum}`
// Cleared when a new document is opened.

const pageLinkCache = new Map<string, LinkInfo[]>();
let linkCacheDocId = -1;

function makeLinkKey(documentId: number, pageNum: number) {
  return `${documentId}:${pageNum}`;
}

function clearLinkCache(documentId: number) {
  if (linkCacheDocId === documentId) return;
  pageLinkCache.clear();
  linkCacheDocId = documentId;
}

/** Prefetch links for a page (e.g. jump target) so they're ready by the time
 *  the user sees the page. Non-blocking, result goes into cache.
 *  Uses Prefetch priority (1) since the user hasn't seen the page yet. */
export function prefetchPageLinks(documentId: number, pageNum: number): void {
  const key = makeLinkKey(documentId, pageNum);
  if (pageLinkCache.has(key)) return;
  getPageLinks(pageNum, 1 /* Prefetch */)
    .then((links) => { pageLinkCache.set(key, links); })
    .catch(() => {});
}

// ─── Text line cache ──────────────────────────────────────────────────────────
//
// Per-page text line data fetched lazily and cached per-document.
// Key: `${documentId}:${pageNum}`
// Cleared when a new document is opened.

const pageTextCache = new Map<string, TextLineInfo[]>();
let textCacheDocId = -1;

function makeTextKey(documentId: number, pageNum: number) {
  return `${documentId}:${pageNum}`;
}

function clearTextCache(documentId: number) {
  if (textCacheDocId === documentId) return;
  pageTextCache.clear();
  textCacheDocId = documentId;
}

// ─── LinkLayer ────────────────────────────────────────────────────────────────

const LinkLayer = memo(function LinkLayer({
  pageNum,
  scale,
  documentId,
  priority,
}: {
  pageNum: number;
  scale: number;
  documentId: number;
  /** 0 = Visible (current page), 1 = Prefetch (overscan pages) */
  priority: 0 | 1;
}) {
  const [links, setLinks] = useState<LinkInfo[]>(() => {
    return pageLinkCache.get(makeLinkKey(documentId, pageNum)) ?? [];
  });

  const currentPage = useDocumentStore((s) => s.currentPage);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const pushNavigation = useNavigationStore((s) => s.pushNavigation);

  useEffect(() => {
    const key = makeLinkKey(documentId, pageNum);
    const cached = pageLinkCache.get(key);
    if (cached) {
      setLinks(cached);
      return;
    }
    let cancelled = false;
    getPageLinks(pageNum, priority)
      .then((result) => {
        if (cancelled) return;
        pageLinkCache.set(key, result);
        setLinks(result);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pageNum, documentId, priority]);

  const handleLinkClick = useCallback(
    (link: LinkInfo, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (link.dest_page >= 0) {
        // Internal link — push navigation history and jump
        pushNavigation(currentPage, link.dest_page);
        setCurrentPage(link.dest_page);
        // Prefetch links for the target page
        prefetchPageLinks(documentId, link.dest_page);
        (window as any).__scrollToPage?.(link.dest_page);
      } else if (link.uri) {
        // External link — open in system browser
        openUrl(link.uri).catch((err: unknown) => {
          console.error("Failed to open URL:", err);
        });
      }
    },
    [currentPage, setCurrentPage, pushNavigation, documentId]
  );

  if (links.length === 0) return null;

  return (
    <div className="link-layer">
      {links.map((link, i) => (
        <a
          key={i}
          className="page-link-area"
          href={link.uri || "#"}
          title={link.dest_page >= 0 ? `Go to page ${link.dest_page + 1}` : link.uri}
          onClick={(e) => handleLinkClick(link, e)}
          style={{
            left: link.x * scale,
            top: link.y * scale,
            width: link.width * scale,
            height: link.height * scale,
          }}
        />
      ))}
    </div>
  );
});

// ─── TextLayer ────────────────────────────────────────────────────────────────
//
// Custom text selection overlay.  Browser native selection on absolute+
// transformed spans is unreliable (whole-page highlight artefacts at line
// boundaries), so we implement selection entirely ourselves:
//
//   • mousedown/mousemove/mouseup track a selection range (lineIndex, charOffset)
//   • We render our own semi-transparent blue highlight rectangles
//   • Cmd+C / Ctrl+C writes the selected text to the clipboard
//   • The text spans are `user-select: none` / `pointer-events: none`
//
// Pointer-events strategy:
//   .text-layer has pointer-events: auto (receives all mouse events, z-index 3).
//   .link-layer sits below at z-index 2.
//   On a simple click (mousedown+mouseup with no/tiny drag) we use
//   elementsFromPoint() to find a .page-link-area underneath and forward the
//   click — so links still work despite text-layer being on top.

/** Shared off-screen canvas context for measuring text width. Lazy-created. */
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!_measureCtx) {
    const c = document.createElement("canvas");
    _measureCtx = c.getContext("2d")!;
  }
  return _measureCtx;
}

function measureTextWidth(text: string, fontSize: number): number {
  const ctx = getMeasureCtx();
  ctx.font = `${fontSize}px sans-serif`;
  return ctx.measureText(text).width;
}

/** A caret position inside the text-line array. */
type Caret = { line: number; ch: number };

/** Hit-test a mouse position (relative to the text-layer div) to find the
 *  closest caret in `lines`. */
function hitTestCaret(
  lines: TextLineInfo[],
  scale: number,
  localX: number,
  localY: number,
): Caret {
  if (lines.length === 0) return { line: 0, ch: 0 };

  // Find the closest line by vertical midpoint distance.
  let bestLine = 0;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const ly = lines[i].y * scale;
    const lh = lines[i].height * scale;
    const mid = ly + lh / 2;
    const d = Math.abs(localY - mid);
    if (d < bestDist) {
      bestDist = d;
      bestLine = i;
    }
  }

  const ln = lines[bestLine];
  const lx = ln.x * scale;
  const lw = ln.width * scale;

  if (localX <= lx) return { line: bestLine, ch: 0 };
  if (localX >= lx + lw) return { line: bestLine, ch: ln.text.length };

  // Proportional offset within the line.
  const ratio = (localX - lx) / lw;
  const ch = Math.round(ratio * ln.text.length);
  return { line: bestLine, ch: Math.max(0, Math.min(ch, ln.text.length)) };
}

/** Order two carets so start <= end. */
function orderCarets(a: Caret, b: Caret): [Caret, Caret] {
  if (a.line < b.line || (a.line === b.line && a.ch <= b.ch)) return [a, b];
  return [b, a];
}

/** Build the selected plain-text from ordered start..end carets. */
function buildSelectedText(
  lines: TextLineInfo[],
  start: Caret,
  end: Caret,
): string {
  if (start.line === end.line) {
    return lines[start.line].text.slice(start.ch, end.ch);
  }

  const parts: string[] = [];
  // First line (tail)
  parts.push(lines[start.line].text.slice(start.ch));
  // Middle lines (full)
  for (let i = start.line + 1; i < end.line; i++) {
    const sep = lines[i - 1].is_last_in_block ? "\n" : " ";
    parts.push(sep + lines[i].text);
  }
  // Last line (head)
  const lastSep = lines[end.line - 1].is_last_in_block ? "\n" : " ";
  parts.push(lastSep + lines[end.line].text.slice(0, end.ch));

  return parts.join("");
}

/** Compute an array of highlight rectangles (in px, relative to text-layer)
 *  for a selection from `start` to `end` (ordered). */
function selectionRects(
  lines: TextLineInfo[],
  scale: number,
  start: Caret,
  end: Caret,
): { left: number; top: number; width: number; height: number }[] {
  const rects: { left: number; top: number; width: number; height: number }[] = [];
  if (start.line === end.line && start.ch === end.ch) return rects;

  for (let i = start.line; i <= end.line; i++) {
    const ln = lines[i];
    const lx = ln.x * scale;
    const ly = ln.y * scale;
    const lw = ln.width * scale;
    const lh = ln.height * scale;
    const len = ln.text.length || 1; // avoid /0

    const chStart = i === start.line ? start.ch : 0;
    const chEnd = i === end.line ? end.ch : ln.text.length;
    if (chStart === chEnd) continue;

    const x0 = lx + (chStart / len) * lw;
    const x1 = lx + (chEnd / len) * lw;
    rects.push({ left: x0, top: ly, width: x1 - x0, height: lh });
  }
  return rects;
}

// ── Global selection coordination ──
// Only one TextLayer can have an active selection at a time. When a new
// selection starts on page N, any existing selection on page M is cleared.
let _activeSelectionClear: (() => void) | null = null;

/** Minimum drag distance (px) to distinguish a click from a selection drag. */
const CLICK_THRESHOLD = 4;

const TextLayer = memo(function TextLayer({
  pageNum,
  scale,
  documentId,
  priority,
}: {
  pageNum: number;
  scale: number;
  documentId: number;
  priority: 0 | 1;
}) {
  const [lines, setLines] = useState<TextLineInfo[]>(() => {
    return pageTextCache.get(makeTextKey(documentId, pageNum)) ?? [];
  });
  const layerRef = useRef<HTMLDivElement | null>(null);

  // Selection state: anchor = mousedown position, focus = current drag position.
  const [anchor, setAnchor] = useState<Caret | null>(null);
  const [focus, setFocus] = useState<Caret | null>(null);

  // Ref mirrors for event handlers that must not trigger re-subscriptions.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // Register a clear callback so other pages can clear our selection.
  const clearSelection = useCallback(() => {
    setAnchor(null);
    setFocus(null);
  }, []);

  useEffect(() => {
    const key = makeTextKey(documentId, pageNum);
    const cached = pageTextCache.get(key);
    if (cached) {
      setLines(cached);
      return;
    }
    let cancelled = false;
    getPageTextLines(pageNum, priority)
      .then((result) => {
        if (cancelled) return;
        pageTextCache.set(key, result);
        setLines(result);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pageNum, documentId, priority]);

  // ── Mouse helpers ──
  const localCoords = useCallback((e: MouseEvent | React.MouseEvent): { x: number; y: number } | null => {
    const el = layerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  /** Check if a screen point is over a link element underneath the text-layer.
   *  Temporarily hides pointer-events on the text-layer to probe below. */
  const probeForLink = useCallback((clientX: number, clientY: number): HTMLElement | null => {
    const el = layerRef.current;
    if (!el) return null;
    const origPE = el.style.pointerEvents;
    el.style.pointerEvents = "none";
    const elements = document.elementsFromPoint(clientX, clientY);
    el.style.pointerEvents = origPE;
    for (const hit of elements) {
      if (hit.classList.contains("page-link-area")) return hit as HTMLElement;
    }
    return null;
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Only handle left-button.
    if (e.button !== 0) return;
    const pos = localCoords(e);
    if (!pos) return;

    // Clear selection on any other TextLayer.
    if (_activeSelectionClear && _activeSelectionClear !== clearSelection) {
      _activeSelectionClear();
    }
    _activeSelectionClear = clearSelection;

    const caret = hitTestCaret(linesRef.current, scaleRef.current, pos.x, pos.y);
    setAnchor(caret);
    setFocus(caret);
    e.preventDefault(); // prevent browser native selection

    const downX = e.clientX;
    const downY = e.clientY;

    // Register global mousemove/mouseup SYNCHRONOUSLY — no useEffect race.
    const onMove = (ev: MouseEvent) => {
      const p = localCoords(ev);
      if (!p) return;
      const c = hitTestCaret(linesRef.current, scaleRef.current, p.x, p.y);
      setFocus(c);
    };

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);

      // If the mouse barely moved, treat this as a click — forward to link.
      const dx = ev.clientX - downX;
      const dy = ev.clientY - downY;
      if (Math.sqrt(dx * dx + dy * dy) < CLICK_THRESHOLD) {
        // No real drag — clear selection.
        setAnchor(null);
        setFocus(null);
        // Try to forward click to a link underneath.
        const link = probeForLink(ev.clientX, ev.clientY);
        if (link) link.click();
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [localCoords, clearSelection, probeForLink]);

  // ── Hover cursor: show pointer when over a link area ──
  const onMouseMoveLocal = useCallback((e: React.MouseEvent) => {
    const el = layerRef.current;
    if (!el) return;
    const link = probeForLink(e.clientX, e.clientY);
    el.style.cursor = link ? "pointer" : "text";
  }, [probeForLink]);

  // ── Keyboard: copy (Cmd+C) and Shift+Arrow selection ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Only respond when THIS TextLayer owns the active selection.
      if (_activeSelectionClear !== clearSelection) return;

      // ── Cmd/Ctrl+C — copy ──
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const a = anchorRef.current;
        const f = focusRef.current;
        if (!a || !f) return;
        const [s, en] = orderCarets(a, f);
        if (s.line === en.line && s.ch === en.ch) return;
        const text = buildSelectedText(linesRef.current, s, en);
        if (!text) return;
        e.preventDefault();
        navigator.clipboard.writeText(text).catch(() => {});
        return;
      }

      // ── Shift+Arrow — extend/shrink selection ──
      if (!e.shiftKey) return;
      const lines = linesRef.current;
      if (lines.length === 0) return;

      let f = focusRef.current;
      const a = anchorRef.current;
      // If no existing selection, place anchor at start of first line.
      if (!a || !f) return;

      let newFocus: Caret | null = null;

      switch (e.key) {
        case "ArrowLeft":
          if (f.ch > 0) {
            newFocus = { line: f.line, ch: f.ch - 1 };
          } else if (f.line > 0) {
            newFocus = { line: f.line - 1, ch: lines[f.line - 1].text.length };
          }
          break;
        case "ArrowRight":
          if (f.ch < lines[f.line].text.length) {
            newFocus = { line: f.line, ch: f.ch + 1 };
          } else if (f.line < lines.length - 1) {
            newFocus = { line: f.line + 1, ch: 0 };
          }
          break;
        case "ArrowUp":
          if (f.line > 0) {
            const prevLen = lines[f.line - 1].text.length;
            newFocus = { line: f.line - 1, ch: Math.min(f.ch, prevLen) };
          }
          break;
        case "ArrowDown":
          if (f.line < lines.length - 1) {
            const nextLen = lines[f.line + 1].text.length;
            newFocus = { line: f.line + 1, ch: Math.min(f.ch, nextLen) };
          }
          break;
      }

      if (newFocus) {
        e.preventDefault();
        setFocus(newFocus);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection]); // clearSelection is stable (useCallback with [])

  // Cleanup global reference on unmount.
  useEffect(() => {
    return () => {
      if (_activeSelectionClear === clearSelection) {
        _activeSelectionClear = null;
      }
    };
  }, [clearSelection]);

  // ── Render ──
  const highlights = useMemo(() => {
    if (!anchor || !focus) return [];
    const [s, e] = orderCarets(anchor, focus);
    return selectionRects(lines, scale, s, e);
  }, [anchor, focus, lines, scale]);

  if (lines.length === 0) return null;

  return (
    <div
      ref={layerRef}
      className="text-layer"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMoveLocal}
    >
      {/* Selection highlight rectangles */}
      {highlights.map((r, i) => (
        <div
          key={`sel-${i}`}
          className="text-selection-hl"
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
      {/* Invisible text spans — for a11y / screen readers only */}
      {lines.map((line, i) => {
        const targetW = line.width * scale;
        const fontSize = line.height * scale;
        const naturalW = measureTextWidth(line.text, fontSize);
        const sx = naturalW > 0 ? targetW / naturalW : 1;

        return (
          <span
            key={i}
            className="text-line-span"
            aria-hidden="false"
            style={{
              left: line.x * scale,
              top: line.y * scale,
              width: targetW,
              height: line.height * scale,
              fontSize,
              lineHeight: `${line.height * scale}px`,
              transform: `scaleX(${sx})`,
            }}
          >
            {line.text}
          </span>
        );
      })}
    </div>
  );
});

// ─── HomeScreen ───────────────────────────────────────────────────────────────

function HomeScreen() {
  const [recentFiles, setRecentFiles] = useState<RecentFileInfo[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());

  // Load recent files on mount
  useEffect(() => {
    getRecentFiles()
      .then((files) => setRecentFiles(files))
      .catch(() => {});
  }, []);

  // Fetch thumbnails for each recent file
  useEffect(() => {
    for (const file of recentFiles) {
      if (thumbnails.has(file.path)) continue;
      getFileThumbnail(file.path)
        .then((base64) => {
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(file.path, `data:image/png;base64,${base64}`);
            return next;
          });
        })
        .catch(() => {});
    }
  }, [recentFiles]); // thumbnails intentionally excluded to avoid re-fetch loop

  const handleOpenFile = useCallback(async () => {
    try {
      await openFileDialog();
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  }, []);

  const handleOpenRecent = useCallback(async (path: string) => {
    try {
      await openFileInTab(path);
    } catch (err) {
      console.error("Failed to open recent file:", err);
    }
  }, []);

  return (
    <div className="home-screen">
      <h1 className="home-title">neoPdfReader</h1>
      <p className="home-subtitle">Fast, lightweight PDF reader</p>

      {recentFiles.length > 0 && (
        <div className="recent-grid">
          {recentFiles.map((file) => (
            <div
              key={file.path}
              className="recent-card"
              onClick={() => handleOpenRecent(file.path)}
              title={file.path}
            >
              {thumbnails.has(file.path) ? (
                <img
                  className="recent-card-thumb"
                  src={thumbnails.get(file.path)}
                  alt={file.name}
                  draggable={false}
                />
              ) : (
                <div className="recent-card-thumb placeholder">PDF</div>
              )}
              <div className="recent-card-name">{file.name}</div>
            </div>
          ))}
        </div>
      )}

      <button className="home-open-btn" onClick={handleOpenFile}>
        Open PDF
      </button>

      <span className="home-hint">
        {navigator.platform.includes("Mac") ? "\u2318" : "Ctrl"}+O to open file
      </span>
    </div>
  );
}

// ─── PageCanvas ───────────────────────────────────────────────────────────────

interface PageCanvasProps {
  pageNum: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  documentId: number;
  /** 0 = visible (highest priority), 1 = prefetch */
  priority: 0 | 1;
}

const PageCanvas = memo(function PageCanvas({
  pageNum,
  width,
  height,
  scale,
  rotation,
  documentId,
  priority,
}: PageCanvasProps) {
  // Render at a higher resolution to account for HiDPI / Retina displays.
  // The CSS display size stays at logical pixels (width * scale) while the
  // actual PNG has `dpr` times as many pixels, making text crisp.
  const dpr = window.devicePixelRatio || 1;
  const renderScale = scale * dpr;
  const imageKey = makeImageKey(documentId, pageNum, renderScale, rotation);

  // Initialise directly from the front-end cache so the first render already
  // has an image — no loading flash for previously seen pages.
  const [displayedSrc, setDisplayedSrc] = useState<string | null>(
    () => pageImageCache.get(imageKey) ?? null
  );

  // The key we last successfully fetched.  Stored in a ref so priority changes
  // (overscan → visible) don't trigger a redundant re-fetch.
  const fetchedKey = useRef<string>(displayedSrc ? imageKey : "");

  const displayWidth = width * scale;
  const displayHeight = height * scale;

  useEffect(() => {
    // If this key is already in the front-end cache, we're done.
    if (pageImageCache.has(imageKey)) {
      const cached = pageImageCache.get(imageKey)!;
      if (displayedSrc !== cached) setDisplayedSrc(cached);
      fetchedKey.current = imageKey;
      return;
    }

    // Already fetching this exact key from a previous render — skip.
    if (fetchedKey.current === imageKey) return;

    let cancelled = false;

    // Request the render at renderScale (logical scale × DPR) so the PNG
    // has enough pixels for the physical display.
    invoke<ArrayBuffer>("render_page", { pageNum, scale: renderScale, rotation, priority })
      .then((buf) => {
        if (cancelled) return;
        const url = bytesToBlobUrl(buf);
        pageImageCache.set(imageKey, url);
        fetchedKey.current = imageKey;
        setDisplayedSrc(url);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(`Failed to render page ${pageNum}:`, err);
      });

    return () => {
      cancelled = true;
    };
    // priority intentionally excluded — only affects queue ordering, not output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, renderScale, rotation, documentId]);

  return (
    <div
      className="page-canvas"
      style={{ width: displayWidth, height: displayHeight, position: "relative" }}
    >
      {displayedSrc && (
        <img
          src={displayedSrc}
          alt={`Page ${pageNum + 1}`}
          style={{ width: "100%", height: "100%", display: "block" }}
          draggable={false}
        />
      )}
      {/* No spinner — white background shows while rendering, image fades in naturally */}
      <PageHighlights pageNum={pageNum} scale={scale} />
      <LinkLayer pageNum={pageNum} scale={scale} documentId={documentId} priority={priority} />
      <TextLayer pageNum={pageNum} scale={scale} documentId={documentId} priority={priority} />

    </div>
  );
});

// ─── PageViewport ─────────────────────────────────────────────────────────────

// Debounce delay (ms) for saving the last-viewed page to the backend.
// Short enough to be timely, long enough not to thrash disk on fast scrolling.
const SAVE_DEBOUNCE_MS = 800;

export default function PageViewport() {
  const {
    isOpen,
    pageSizes,
    pageCount,
    scale,
    rotation,
    currentPage,
    setCurrentPage,
    setScale,
    documentId,
    initialPage,
  } = useDocumentStore();

  // Clear the front-end image cache whenever a new document is opened.
  clearImageCacheForDoc(documentId);
  clearLinkCache(documentId);
  clearTextCache(documentId);

  // Clear navigation history when a new document is opened.
  const clearHistory = useNavigationStore((s) => s.clearHistory);
  const prevDocIdRef = useRef(documentId);
  if (prevDocIdRef.current !== documentId) {
    prevDocIdRef.current = documentId;
    clearHistory();
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const rafRef = useRef<number | null>(null);
  // Keep a ref to pageOffsets so effects can read the latest value without
  // needing to be in their dependency arrays.
  const pageOffsetsRef = useRef<number[]>([]);
  // Debounce timer for save_last_page
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track previous scale so we can detect zoom changes and adjust scrollTop.
  const prevScaleRef = useRef(scale);

  // Observe container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const gap = 12;

  // Pre-compute cumulative page offsets
  const { pageOffsets, totalHeight } = useMemo(() => {
    const offsets: number[] = [];
    let y = 0;
    for (const ps of pageSizes) {
      offsets.push(y);
      y += ps.height * scale + gap;
    }
    return { pageOffsets: offsets, totalHeight: y };
  }, [pageSizes, scale]);

  // Keep the ref in sync so scroll-restoration effect can read latest offsets.
  pageOffsetsRef.current = pageOffsets;

  // ── Preserve current page when zoom scale changes ──
  // When scale changes, pageOffsets are recomputed (all values shift).  We
  // adjust scrollTop so the page the user was looking at stays in view.
  // Uses useLayoutEffect to apply before paint, avoiding a visible jump frame.
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  React.useLayoutEffect(() => {
    if (prevScaleRef.current === scale) return;
    prevScaleRef.current = scale;
    if (!containerRef.current || pageOffsets.length === 0) return;
    const page = Math.min(currentPageRef.current, pageOffsets.length - 1);
    containerRef.current.scrollTop = pageOffsets[page];
    setScrollTop(pageOffsets[page]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, pageOffsets]);

  // Restore scroll position when a new document is opened.
  // We run this effect whenever documentId changes *and* pageOffsets has been
  // populated (length > 0). The ref ensures we always read the latest offsets.
  useEffect(() => {
    if (!containerRef.current) return;
    if (initialPage === 0) {
      // First page or no history — just reset to top.
      containerRef.current.scrollTop = 0;
      setScrollTop(0);
    } else {
      // Restore saved position. pageOffsetsRef.current is already up-to-date
      // because it's set synchronously before this effect fires.
      const offsets = pageOffsetsRef.current;
      const top = offsets[Math.min(initialPage, offsets.length - 1)] ?? 0;
      containerRef.current.scrollTop = top;
      setScrollTop(top);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // RAF-throttled scroll handler
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!containerRef.current) return;
      const st = containerRef.current.scrollTop;
      setScrollTop(st);
      if (pageOffsetsRef.current.length === 0) return;
      const offsets = pageOffsetsRef.current;
      let lo = 0, hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= st) lo = mid;
        else hi = mid - 1;
      }
      if (lo !== currentPage) {
        setCurrentPage(lo);
        // Debounced persist of reading position
        if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          const path = useDocumentStore.getState().filePath;
          if (path) {
            invoke("save_last_page", { path, page: lo }).catch(() => {/* non-critical */});
          }
        }, SAVE_DEBOUNCE_MS);
      }
    });
  }, [currentPage, setCurrentPage]);

  const scrollToPage = useCallback(
    (pageNum: number) => {
      if (!containerRef.current || pageOffsetsRef.current.length === 0) return;
      const top = pageOffsetsRef.current[Math.min(pageNum, pageOffsetsRef.current.length - 1)] ?? 0;
      // Instant jump — no scroll animation.  The image cache ensures the page
      // appears immediately; a smooth scroll would only add perceived delay.
      containerRef.current.scrollTop = top;
    },
    []
  );

  useEffect(() => {
    (window as any).__scrollToPage = scrollToPage;
    return () => { delete (window as any).__scrollToPage; };
  }, [scrollToPage]);

  const { goBack, goForward } = useNavigationStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      // Cmd+Left (macOS) or Alt+Left → go back
      if ((e.metaKey || e.altKey) && e.key === "ArrowLeft") {
        e.preventDefault();
        const target = goBack(currentPage);
        if (target != null) {
          setCurrentPage(target);
          prefetchPageLinks(documentId, target);
          scrollToPage(target);
        }
        return;
      }
      // Cmd+Right (macOS) or Alt+Right → go forward
      if ((e.metaKey || e.altKey) && e.key === "ArrowRight") {
        e.preventDefault();
        const target = goForward(currentPage);
        if (target != null) {
          setCurrentPage(target);
          prefetchPageLinks(documentId, target);
          scrollToPage(target);
        }
        return;
      }

      // ── Zoom shortcuts: Cmd+= / Cmd+- / Cmd+0 ──
      if (e.metaKey || e.ctrlKey) {
        // Cmd+= or Cmd+Shift+= (the "+" key on most keyboards)
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          setScale(Math.round((scale + 0.25) * 100) / 100);
          return;
        }
        // Cmd+-
        if (e.key === "-") {
          e.preventDefault();
          setScale(Math.round((scale - 0.25) * 100) / 100);
          return;
        }
        // Cmd+0 → reset to 100%
        if (e.key === "0") {
          e.preventDefault();
          setScale(1.0);
          return;
        }
      }

      switch (e.key) {
        case "PageDown": e.preventDefault(); scrollToPage(Math.min(currentPage + 1, pageCount - 1)); break;
        case "PageUp":   e.preventDefault(); scrollToPage(Math.max(currentPage - 1, 0)); break;
        case "Home":     e.preventDefault(); scrollToPage(0); break;
        case "End":      e.preventDefault(); scrollToPage(pageCount - 1); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, currentPage, pageCount, scale, scrollToPage, documentId, setCurrentPage, setScale, goBack, goForward]);

  // Compute visible + overscan range
  const { visibleStart, visibleEnd, renderStart, renderEnd } = useMemo(() => {
    if (pageOffsets.length === 0)
      return { visibleStart: 0, visibleEnd: -1, renderStart: 0, renderEnd: -1 };

    const overscan = 3;
    const viewBottom = scrollTop + viewportHeight;

    let lo = 0, hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] <= scrollTop) lo = mid;
      else hi = mid - 1;
    }
    const firstVisible = lo;

    lo = firstVisible; hi = pageOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pageOffsets[mid] < viewBottom) lo = mid;
      else hi = mid - 1;
    }
    const lastVisible = lo;

    return {
      visibleStart: firstVisible,
      visibleEnd: lastVisible,
      renderStart: Math.max(0, firstVisible - overscan),
      renderEnd: Math.min(pageOffsets.length - 1, lastVisible + overscan),
    };
  }, [pageOffsets, scrollTop, viewportHeight]);

  return (
    <div
      ref={containerRef}
      className={`page-viewport${!isOpen ? " empty" : ""}`}
      onScroll={isOpen ? handleScroll : undefined}
    >
      {!isOpen ? (
        <HomeScreen />
      ) : (
        <div className="page-scroll-container" style={{ height: totalHeight }}>
          {renderEnd >= renderStart &&
            Array.from({ length: renderEnd - renderStart + 1 }, (_, idx) => {
              const pageNum = renderStart + idx;
              const ps = pageSizes[pageNum];
              const top = pageOffsets[pageNum];
              const isVisible = pageNum >= visibleStart && pageNum <= visibleEnd;
              const priority: 0 | 1 = isVisible ? 0 : 1;
              return (
                <div
                  key={`${documentId}-${pageNum}`}
                  className="page-wrapper"
                  style={{ position: "absolute", top, left: 0, right: 0 }}
                >
                  <PageCanvas
                    pageNum={pageNum}
                    width={ps.width}
                    height={ps.height}
                    scale={scale}
                    rotation={rotation}
                    documentId={documentId}
                    priority={priority}
                  />
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
