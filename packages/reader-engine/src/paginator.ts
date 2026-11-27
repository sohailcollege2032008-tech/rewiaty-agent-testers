import type { Anchor, Block, Book, Chapter } from '@rewiaty/book-format';
import { escapeHtml } from '@rewiaty/book-format';
import {
  SPREAD_GUTTER_PX,
  SPREAD_MIN_VIEWPORT_PX,
  WCAG_AA_MIN_RATIO,
  buildCustomThemeTokens,
  contrastRatioHex,
  isDarkHexColor,
  measureChToPx,
  normalizeHexColor,
  spineTokensFor,
  spineTokensForColors,
} from './spread.js';
import { hitTestHighlightAtPoint, renderEngineHighlights } from './highlights.js';
import {
  HIGHLIGHT_COLORS,
  THEMES,
  type EngineHighlight,
  type ReaderInsets,
  type ReaderSettings,
  type ReadingMode,
  type SceneDisplayMode,
  type ScenePlaceholder,
  type ScenePromptParts,
  type SelectionRect,
  type TocEntry,
} from './types.js';
import { applyTashkeelToElement, toDisplayOffset, toOriginalOffset } from './tashkeel.js';
import {
  normalizeScenePlaceholder,
  normalizeScenePrompt,
  syncScenePlaceholdersInRoot,
  type SceneRenderOptions,
} from './scene-placeholder.js';

function normalizeInsets(insets?: ReaderInsets | null): ReaderInsets {
  const top = typeof insets?.top === 'number' && Number.isFinite(insets.top) ? Math.max(0, Math.round(insets.top)) : 0;
  const bottom =
    typeof insets?.bottom === 'number' && Number.isFinite(insets.bottom) ? Math.max(0, Math.round(insets.bottom)) : 0;
  return { top, bottom };
}

const INITIAL_WORD_BUDGET = 2500;
const BATCH_WORD_BUDGET = 2000;
/**
 * Expected fill fraction of the last page of a measured chapter. A chapter's content
 * almost never ends exactly on a page boundary, so `words / pages` understates the
 * real words-per-full-page by roughly half a page per measured chapter. Dividing by
 * `pages` raw makes every estimate for a *smaller* chapter overshoot (a 60-paragraph
 * chapter read as 2× a 120-paragraph one), which is what pushed the pinned total one
 * page above the truth on the CI runner.
 */
const RAGGED_END_PAGE_FRACTION = 0.5;

/** Element that pads a chapter to an even page count so every chapter starts on the same side. */
const CHAPTER_PAD_CLASS = 'chapter-pad';

/**
 * How far the running page is allowed to travel past a book edge while the finger keeps
 * pulling (rubber band), as a fraction of the raw drag distance.
 */
const DRAG_RUBBER_BAND = 0.25;
/** A released drag completes the turn past this fraction of the visible page advance. */
const DRAG_COMMIT_RATIO = 0.3;
/** …or when the finger was still moving this fast (px/ms) in the drag direction. */
const DRAG_FLICK_VELOCITY = 0.4;
/**
 * A flick also has to have MOVED the paper this fraction of the stride. Without a floor the
 * velocity rule turns a 3 mm twitch into a page whenever the last two pointer samples land
 * close together (batching, a janky frame, a synthesised gesture): Maestro's 7 % slow nudge
 * measured > 0.4 px/ms and turned the page back, which is exactly what the reader must not do.
 */
const DRAG_FLICK_MIN_RATIO = 0.1;
/** Matches the `--page-transition` duration so a released page lands where it was heading. */
const DRAG_SETTLE_MS = 220;
/**
 * Layout budget spent per frame on the exact pagination pass. Two or three chapters fit
 * in it; the rest yield to the next frame so scrolling and taps stay responsive.
 */
const EXACT_PASS_FRAME_MS = 12;
/**
 * Longest the idle mount may wait for the exact page map. The pass is frame-chunked and
 * normally finishes in well under this; a book (or a WebView that throttles frames) that
 * does not must still mount, so the wait is bounded.
 */
const BACKGROUND_DEFER_MAX_MS = 1500;
/**
 * How close a settled `scrollTop` has to be to the offset a programmatic restore scrolled
 * to before it counts as *our* scroll and not the reader's. A programmatic position lands
 * exactly where we put it, so a couple of pixels of rounding is the whole budget — anything
 * further is the reader dragging the page.
 */
const SCROLL_RESTORE_TOLERANCE = 2;
/** Chapters mounted either side of the one under the reading line (the active window). */
const SCROLL_WINDOW_RADIUS = 1;
/** Chapters kept mounted before eviction. Mount early, evict late, so scrolling back is free. */
const SCROLL_KEEP_RADIUS = 2;

export type ViewportMetrics = {
  width: number; // stage width (the physical width of the open book)
  height: number;
  /** Advance of a single page. Half of `width` in two-page spread mode. */
  pageWidth: number;
  marginH: number;
  marginV: number;
  paddingTop: number;
  paddingBottom: number;
  spread: boolean;
};

export type RenderedChapter = {
  index: number;
  chapter: Chapter;
  el: HTMLElement;
  /**
   * Real (content) pages of the mounted prefix — never includes the blank chapter pad.
   * This is the only count exposed to RN (position + TOC), so the reader's page
   * numbers always point at a page the user can actually see.
   */
  pageCount: number;
  /**
   * Real pages + blank pad pages. Track geometry only (offset of the next chapter,
   * how many page turns the chapter owns). Never exposed.
   */
  layoutPageCount: number;
  /** Blank pad pages appended at the end of this chapter (0 or 1, spread mode only). */
  padPageCount: number;
  mountedBlockCount: number;
  mountedWordCount: number;
  isComplete: boolean;
  blockEls: HTMLElement[];
  blockById: Map<string, HTMLElement>;
};

export type PositionSnapshot = {
  anchor: Anchor;
  chapterId: string;
  page: number; // 1-based global page
  pageCount: number; // total book pages (exact once every chapter is measured)
  chapterPage: number; // 1-based page in current chapter
  chapterPageCount: number;
  bookProgress: number; // 0..1
  spread: boolean;
  /** F22 — 0..1 position inside the current chapter (`scroll` mode only). */
  chapterProgress?: number;
  /** F22 — the presentation this snapshot came from. */
  readingMode?: ReadingMode;
  /**
   * true while at least one chapter's page count is still an estimate (virtualized
   * chapters are measured lazily). While this is true `pageCount` is pinned for the
   * current layout, so the reader never sees it wobble just from turning pages.
   */
  estimated: boolean;
};

/**
 * The one page map every reader-facing number is derived from: position, TOC, and
 * `goto({ page })`. Built per layout (direction + metrics + typography) and pinned:
 * navigating never rewrites the total, only measuring a chapter refines where the
 * pages sit inside it.
 */
type PageMap = {
  signature: string;
  /** Real content pages per chapter (never pad pages). */
  counts: number[];
  /** counts[i] came from an actual measurement, not an estimate. */
  exact: boolean[];
  total: number;
  estimated: boolean;
  /** words per real page, frozen for this layout so estimates can't drift. */
  density: number;
};

export type PaginatorCallbacks = {
  onBackgroundProgress?: () => void;
  onChapterLayoutComplete?: (chapterId: string) => void;
  /**
   * Fired when the exact-pagination pass has measured the chapters the reader's page
   * number depends on (`allExact=false`) or the whole book (`allExact=true`), so the
   * host can publish the corrected position/TOC.
   */
  onExactPagination?: (allExact: boolean) => void;
};

const FONT_FALLBACKS: Record<string, string> = {
  Amiri: "'Amiri', 'Noto Naskh Arabic', 'Geeza Pro', 'Traditional Arabic', serif",
  'Noto Naskh Arabic': "'Noto Naskh Arabic', 'Amiri', 'Geeza Pro', serif",
  'Scheherazade New': "'Scheherazade New', 'Amiri', 'Traditional Arabic', serif",
  'IBM Plex Sans Arabic': "'IBM Plex Sans Arabic', 'Readex Pro', 'Segoe UI', sans-serif",
  'Readex Pro': "'Readex Pro', 'IBM Plex Sans Arabic', 'Segoe UI', sans-serif",
  Literata: "'Literata', Georgia, 'Times New Roman', serif",
  Merriweather: "'Merriweather', Georgia, 'Times New Roman', serif",
  Inter: "'Inter', system-ui, -apple-system, sans-serif",
};

function resolveFontStack(fontFamily: string): string {
  return FONT_FALLBACKS[fontFamily] ?? `'${fontFamily.replace(/['"]/g, '')}', serif`;
}

/**
 * Fast allocation-free approximate word counter for block batching.
 */
function approxBlockWords(block: Block): number {
  if (block.kind === 'break' || block.kind === 'image') return 0;
  const s = block.html;
  let words = 0;
  let inSpace = true;
  let inTag = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 60 /* < */) {
      inTag = true;
      inSpace = true;
      continue;
    }
    if (inTag) {
      if (c === 62 /* > */) inTag = false;
      continue;
    }
    const isWs = c === 32 || c === 9 || c === 10 || c === 13;
    if (isWs) {
      inSpace = true;
    } else if (inSpace) {
      words++;
      inSpace = false;
    }
  }
  return Math.max(1, words);
}

function getColumnForRect(
  rect: DOMRect,
  chRect: DOMRect,
  dir: 'rtl' | 'ltr',
  pageWidth: number,
  edge: 'start' | 'end',
): number {
  if (pageWidth <= 0) return 0;
  if (dir === 'ltr') {
    const x = edge === 'start' ? rect.left - chRect.left + 1 : rect.right - chRect.left - 1;
    return Math.max(0, Math.floor(x / pageWidth));
  }
  const x = edge === 'start' ? chRect.right - rect.right + 1 : chRect.right - rect.left - 1;
  return Math.max(0, Math.floor(x / pageWidth));
}

function findTextPosition(root: HTMLElement, charOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, charOffset);
  let lastText: Text | null = null;
  let current = walker.nextNode() as Text | null;

  while (current) {
    lastText = current;
    const len = current.data.length;
    if (remaining < len) {
      return { node: current, offset: remaining };
    }
    remaining -= len;
    current = walker.nextNode() as Text | null;
  }

  if (lastText) {
    return { node: lastText, offset: Math.max(0, lastText.data.length - 1) };
  }
  return null;
}

function getCharacterRect(el: HTMLElement, charOffset: number): DOMRect | null {
  const totalLen = el.textContent?.length ?? 0;
  if (totalLen === 0) {
    return el.getBoundingClientRect();
  }
  const clamped = Math.max(0, Math.min(totalLen - 1, charOffset));
  const startPos = findTextPosition(el, clamped);
  if (!startPos) {
    return el.getBoundingClientRect();
  }

  const range = document.createRange();
  const endOffset = Math.min(startPos.node.data.length, startPos.offset + 1);
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(startPos.node, endOffset);

  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!;
    if (r.width > 0 || r.height > 0) {
      return r;
    }
  }
  const fallback = range.getBoundingClientRect();
  return fallback.width > 0 || fallback.height > 0 ? fallback : el.getBoundingClientRect();
}

function renderBlockHtml(block: Block): string {
  switch (block.kind) {
    case 'p': {
      const cls = block.noIndent ? 'block-p no-indent' : 'block-p';
      return `<p class="${cls}" data-block-id="${escapeHtml(block.id)}">${block.html}</p>`;
    }
    case 'h2':
      return `<h2 class="block-h2" data-block-id="${escapeHtml(block.id)}">${block.html}</h2>`;
    case 'break':
      return `<div class="block-break" data-block-id="${escapeHtml(block.id)}" aria-hidden="true">${block.html}</div>`;
    case 'quote':
      return `<blockquote class="block-quote" data-block-id="${escapeHtml(block.id)}">${block.html}</blockquote>`;
    case 'image':
      return `<figure class="block-image" data-block-id="${escapeHtml(block.id)}">${block.html}</figure>`;
  }
}

/** The box of every fragment a node paints, so a multi-column split is not read as one box. */
function paintedRects(node: Element): DOMRect[] {
  const rects: DOMRect[] = [];
  const list = (node as HTMLElement).getClientRects();
  for (let i = 0; i < list.length; i++) {
    const rect = list[i]!;
    if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect);
  }
  return rects;
}

type ColumnBand = { left: number; right: number };

/** Two fragments belong to the same column when their horizontal bands overlap. */
function sharesColumn(a: ColumnBand, b: ColumnBand): boolean {
  const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return overlap > Math.min(a.right - a.left, b.right - b.left) * 0.5;
}

/**
 * Keep a scene break out of a page of its own.
 *
 * `break-after: avoid` keeps the *following* block with the break, but it cannot help when the
 * block before the break already fills the column (a figure capped to almost the full page
 * height, for instance): the column box then has to start a new column for the break, and the
 * reader turns to a page whose only ink is `✦ ✦ ✦`. CSS alone has no way out — there is no
 * "do not break before this if it is alone" — so the geometry decides here instead:
 *
 * 1. Every painted fragment is grouped into its page column by its horizontal band.
 * 2. A column that holds nothing but scene breaks is not a readable page.
 * 3. Those breaks are taken out of the flow (`display: none`), which removes the column, and the
 *    measurement pass that follows counts one page fewer.
 *
 * The collapse is redone from the untouched layout on every measurement (previous collapses are
 * restored first), so a resize, a font change or newly mounted blocks can bring the break back.
 *
 * @returns how many breaks are currently collapsed.
 */
function syncOrphanSceneBreaks(el: HTMLElement): number {
  const breaks = Array.from(el.querySelectorAll<HTMLElement>('.block-break'));
  if (breaks.length === 0) return 0;

  // Start from the real layout: an earlier pass may have hidden a break that fits again.
  for (const node of breaks) {
    if (node.dataset.orphanCollapsed !== '1') continue;
    node.style.removeProperty('display');
    delete node.dataset.orphanCollapsed;
  }

  let collapsed = 0;
  // Each pass can free a column and shift the rest of the chapter, so re-group until stable.
  for (let pass = 0; pass < 4; pass++) {
    const columns: Array<ColumnBand & { hasContent: boolean }> = [];
    const columnFor = (rect: DOMRect) => {
      let column = columns.find((candidate) => sharesColumn(rect, candidate));
      if (!column) {
        column = { left: rect.left, right: rect.right, hasContent: false };
        columns.push(column);
      }
      return column;
    };

    for (const node of el.querySelectorAll<HTMLElement>(
      '[data-block-id], .chapter-title, .chapter-ornament',
    )) {
      if (node.classList.contains('block-break')) continue;
      for (const rect of paintedRects(node)) columnFor(rect).hasContent = true;
    }

    let passCollapsed = 0;
    for (const brk of breaks) {
      if (brk.dataset.orphanCollapsed === '1') continue;
      const rects = paintedRects(brk);
      // A split break is not the single-line orphan this pass targets.
      if (rects.length !== 1) continue;
      const column = columnFor(rects[0]!);
      if (column.hasContent) continue;
      brk.style.display = 'none';
      brk.dataset.orphanCollapsed = '1';
      passCollapsed += 1;
    }
    collapsed += passCollapsed;
    if (passCollapsed === 0) break;
  }
  return collapsed;
}

export class Paginator {
  private readonly rootEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly trackEl: HTMLElement;
  private readonly callbacks: PaginatorCallbacks;

  private book: Book | null = null;
  private settings: ReaderSettings;
  private insets: ReaderInsets = { top: 0, bottom: 0 };
  private dir: 'rtl' | 'ltr' = 'rtl';
  private metrics: ViewportMetrics = {
    width: 390,
    height: 844,
    pageWidth: 390,
    marginH: 24,
    marginV: 24,
    paddingTop: 24,
    paddingBottom: 24,
    spread: false,
  };

  private currentChapterIdx = 0;
  private currentChapterPage = 0;

  /**
   * The anchor the reader restored to in the last reflow (settings change, rotation,
   * font load, initial deep link).
   *
   * A reflow restore is page-granular: we page-map the anchor's column and show it.
   * That page often starts with the tail of the *previous* block, so re-deriving the
   * anchor from geometry would report an earlier block and silently walk the reading
   * position backwards on every font change (font-slider drift). While this is set,
   * it is the authoritative position; any real navigation drops it.
   */
  private restoredAnchor: Anchor | null = null;

  // Virtualized DOM map: only [currentIdx - 1, currentIdx, currentIdx + 1]
  private rendered = new Map<number, RenderedChapter>();
  // Page count cache keyed by `${chapter.id}:${chapter.hash}:${layoutKey}`
  private pageCache = new Map<string, number>();
  // Single source of truth for every page number exposed to RN (see `PageMap`).
  private pageMap: PageMap | null = null;
  // Layout signature whose first-frame measurements have already been reconciled with
  // the styles/faces that actually ended up applied (see `settleLayout`).
  private settledSignature: string | null = null;
  /**
   * No page number is exposed before this is true.
   *
   * The first frame of a book is laid out with whatever face the WebView has at that
   * instant. Publishing a total then pins the whole map to fallback-face metrics, and
   * the correction that arrives when the real face swaps in moves the number the reader
   * is already looking at (the CI failure: "of 56" became "of 55"). Measurement becomes
   * quotable only after `settleLayout` has re-measured the mounted chapters against the
   * faces that actually applied. Reset per `load`, never by a settings change (the fonts
   * are already resolved by then).
   */
  private metricsTrusted = false;

  private idleHandle: { kind: 'idle' | 'timeout'; id: number } | null = null;
  private transitionEndTimer: number | null = null;
  private layoutGeneration = 0;
  private highlights: EngineHighlight[] = [];

  // --- F46 scene placeholders ---
  /**
   * Every scene frame the host has told us about, in host order. Stored even when
   * `sceneDisplayMode` is `hidden`, so switching back to `expanded` needs no re-fetch.
   */
  private scenePlaceholders: ScenePlaceholder[] = [];
  private sceneDisplayMode: SceneDisplayMode = 'expanded';

  // --- exact pagination pass (offscreen, frame-chunked) ---
  /** Chapters still to measure, in priority order (see `startExactPagination`). */
  private exactQueue: number[] = [];
  private exactRaf: number | null = null;
  /** Bumped whenever measurements from the running pass become invalid. */
  private exactToken = 0;
  /** Hidden host for the throwaway `.chapter` copies the pass measures. */
  private probeEl: HTMLElement | null = null;
  private exactPrefixNotified = false;
  private exactAllNotified = false;
  /** A mount was requested while the map was still estimated (see `scheduleBackgroundWork`). */
  private backgroundWanted = false;
  private backgroundFallbackTimer: number | null = null;

  // --- finger-tracked page turns ---
  private dragging = false;
  private dragBaseOffset = 0;
  private dragPendingDx: number | null = null;
  private dragRaf: number | null = null;
  private dragSettleTimer: number | null = null;

  // --- F22 continuous scroll mode ---
  /** One `.scroll-chapter-slot` per chapter, in book order (index === chapter index). */
  private scrollSlots: HTMLElement[] = [];
  private scrollRaf: number | null = null;
  /**
   * Document-space tops/heights of every slot, measured lazily. Slots only change height
   * when a chapter is mounted/evicted or the layout changes, so the table survives a whole
   * scroll and lets the visible chapter be found with a binary search per frame instead of
   * a `getBoundingClientRect` per slot.
   */
  private scrollSlotCache: { tops: number[]; heights: number[] } | null = null;
  /**
   * The `scrollTop` a restored anchor was *programmatically* placed at. While the reader
   * stays there the anchor (block **and** character offset) is authoritative; only a real
   * scroll away from it hands the position back to geometry (see `handleScrollSettled`).
   */
  private scrollRestoredTop: number | null = null;

  constructor(
    rootEl: HTMLElement,
    stageEl: HTMLElement,
    trackEl: HTMLElement,
    initialSettings: ReaderSettings,
    callbacks: PaginatorCallbacks = {},
  ) {
    this.rootEl = rootEl;
    this.stageEl = stageEl;
    this.trackEl = trackEl;
    this.settings = { ...initialSettings };
    this.callbacks = callbacks;
  }

  getDirection(): 'rtl' | 'ltr' {
    return this.dir;
  }

  getMetrics(): ViewportMetrics {
    return this.metrics;
  }

  /** true when the current layout is a two-page open-book spread. */
  isSpreadActive(): boolean {
    return this.metrics.spread;
  }

  /** F22 — true while the reader is in continuous vertical scroll mode. */
  isScrollMode(): boolean {
    return this.settings.readingMode === 'scroll';
  }

  getCurrentChapterIndex(): number {
    return this.currentChapterIdx;
  }

  getCurrentChapterPage(): number {
    return this.currentChapterPage;
  }

  getRenderedChapterCount(): number {
    return this.rendered.size;
  }

  isCurrentChapterComplete(): boolean {
    return this.rendered.get(this.currentChapterIdx)?.isComplete ?? false;
  }

  /**
   * Images currently mounted in the track (the book's `assets/…` figures).
   *
   * Deliberately not scoped to `figure.block-image`: the proof must measure whatever the converter
   * produced. A wrapper class that differs from the one the importer writes would otherwise hide a
   * painted figure from the assertion that exists to catch it.
   */
  getImages(): HTMLImageElement[] {
    return Array.from(this.trackEl.querySelectorAll<HTMLImageElement>('img'));
  }

  /**
   * Report how many mounted images actually painted, plus the box of the first one that has
   * non-zero dimensions. A path that resolved but decoded to nothing reports `width: 0`, which is
   * what makes the import journey fail instead of showing an invisible image.
   */
  measureImages(): { rendered: number; width: number; height: number } {
    let rendered = 0;
    let width = 0;
    let height = 0;
    for (const img of this.getImages()) {
      if (!img.complete || img.naturalWidth <= 0) continue;
      rendered += 1;
      if (width === 0) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          width = Math.round(rect.width);
          height = Math.round(rect.height);
        }
      }
    }
    return { rendered, width, height };
  }

  /**
   * true when every chapter has a real measurement for the current layout, so both the
   * page number and the book total are exact and never need a correction.
   */
  isPageMapExact(): boolean {
    if (!this.book) return false;
    for (const chapter of this.book.chapters) {
      if (this.pageCache.get(this.cacheKey(chapter)) === undefined) return false;
    }
    return true;
  }

  /** true while the reader's finger owns the page (see `beginDrag`/`endDrag`). */
  isDragging(): boolean {
    return this.dragging;
  }

  /**
   * true when the chapters that precede the current one are measured, i.e. the page
   * number the reader sees is exact even if the total is still an estimate.
   */
  isPageNumberExact(): boolean {
    if (!this.book) return false;
    const last = Math.min(this.currentChapterIdx, this.book.chapters.length - 1);
    for (let i = 0; i <= last; i++) {
      const chapter = this.book.chapters[i];
      if (!chapter) return false;
      if (this.pageCache.get(this.cacheKey(chapter)) === undefined) return false;
    }
    return true;
  }

  /**
   * Measure every chapter that has no real count for this layout, offscreen and in
   * budgeted frames, so the page map stops depending on estimates.
   *
   * Why (product, S3): restoring "كمّل القراية" only mounts the anchor's chapter; the
   * chapters before it were never measured, so their pages came from a words-per-page
   * guess and the reader landed on a different page number (saved 9, restored 7). A page
   * map that is a pure function of (book, layout) makes the restored number the same
   * number — and the total the same total.
   *
   * Order matters for perceived speed: the current chapter first (it can be partially
   * mounted), then the prefix before it, then the rest. Once the prefix is measured the
   * page number is final even while the later chapters are still being counted.
   */
  startExactPagination(): void {
    if (!this.book) return;
    this.cancelExactPagination();
    if (!this.metricsTrusted) return;

    const book = this.book;
    const missing: number[] = [];
    for (let i = 0; i < book.chapters.length; i++) {
      const chapter = book.chapters[i];
      if (!chapter) continue;
      if (this.pageCache.get(this.cacheKey(chapter)) === undefined) missing.push(i);
    }

    this.exactPrefixNotified = this.isPageNumberExact();
    this.exactAllNotified = missing.length === 0;
    if (missing.length === 0) {
      this.callbacks.onExactPagination?.(true);
      return;
    }

    const current = this.currentChapterIdx;
    const ordered: number[] = [];
    if (missing.includes(current)) ordered.push(current);
    for (const idx of missing) {
      if (idx < current) ordered.push(idx);
    }
    for (const idx of missing) {
      if (idx > current) ordered.push(idx);
    }
    this.exactQueue = ordered;
    // Measure the first slice synchronously: the common book's prefix fits in one
    // budgeted frame, so its first page number is ready inside this task instead of
    // waiting on a `requestAnimationFrame` that a background WebView can throttle.
    this.pumpExactPagination(this.exactToken);
  }

  /** Drop a running exact pass (its measurements describe a layout that just changed). */
  private cancelExactPagination(): void {
    this.exactToken++;
    this.exactQueue = [];
    this.exactPrefixNotified = false;
    this.exactAllNotified = false;
    if (this.exactRaf !== null) {
      window.cancelAnimationFrame(this.exactRaf);
      this.exactRaf = null;
    }
  }

  private scheduleExactFrame(): void {
    if (this.exactRaf !== null) return;
    const token = this.exactToken;
    this.exactRaf = window.requestAnimationFrame(() => {
      this.exactRaf = null;
      this.pumpExactPagination(token);
    });
  }

  private pumpExactPagination(token: number): void {
    if (token !== this.exactToken) return;
    const book = this.book;
    if (!book) return;

    const started = performance.now();
    while (this.exactQueue.length > 0) {
      const idx = this.exactQueue.shift();
      if (idx === undefined) break;
      const chapter = book.chapters[idx];
      if (!chapter) continue;
      if (this.pageCache.get(this.cacheKey(chapter)) !== undefined) continue;
      this.measureChapterOffscreen(chapter);
      if (performance.now() - started >= EXACT_PASS_FRAME_MS && this.exactQueue.length > 0) break;
    }
    if (token !== this.exactToken) return;

    this.invalidatePageMap();

    const allExact = this.exactQueue.length === 0;
    const prefixExact = this.isPageNumberExact();
    if ((prefixExact && !this.exactPrefixNotified) || (allExact && !this.exactAllNotified)) {
      this.exactPrefixNotified = this.exactPrefixNotified || prefixExact;
      this.exactAllNotified = this.exactAllNotified || allExact;
      this.callbacks.onExactPagination?.(allExact);
    }

    if (!allExact) {
      this.scheduleExactFrame();
    } else if (this.probeEl) {
      this.probeEl.remove();
      this.probeEl = null;
    }

    // A mount that was waiting for a final page map starts now (the reader has already
    // been told its first page number by `onExactPagination`, so the progress ticks that
    // follow re-publish numbers that cannot move).
    if (allExact && this.backgroundWanted) {
      this.runBackgroundWork();
    }
  }

  /** Hidden container with the chapter box, so a lone `.chapter` lays out exactly as in the track. */
  private ensureProbe(): HTMLElement {
    if (this.probeEl?.isConnected) return this.probeEl;
    const probe = document.createElement('div');
    probe.id = 'rewiaty-measure-probe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;top:0;left:-100000px;width:var(--page-width);height:var(--page-height);' +
      'visibility:hidden;pointer-events:none;contain:layout style;';
    document.body.appendChild(probe);
    this.probeEl = probe;
    return probe;
  }

  /** Measure one whole chapter without touching the mounted (virtualized) DOM. */
  private measureChapterOffscreen(chapter: Chapter): void {
    if (this.metrics.pageWidth <= 0) return;
    const probe = this.ensureProbe();
    const el = document.createElement('article');
    el.className = 'chapter';
    el.setAttribute('dir', this.dir);
    el.innerHTML = this.chapterInnerHtml(chapter);
    // F18: the offscreen probe has to measure the same glyphs the reader sees — the
    // displayed text, in the mode currently chosen, not the file's full vocalisation.
    applyTashkeelToElement(el, this.settings.tashkeel);
    // F46: a scene frame occupies real column height, so the probe must include the frames
    // the reader will see — otherwise an unmounted chapter's count would be short.
    syncScenePlaceholdersInRoot(el, this.scenePlaceholders, this.sceneRenderOptions());
    probe.appendChild(el);
    try {
      // Issue #47/#58 (QA r1): a break pushed alone onto a column is not a page. Collapse it
      // before reading the width, so the probe counts the same pages the reader will see.
      syncOrphanSceneBreaks(el);
      this.pageCache.set(this.cacheKey(chapter), Math.max(1, this.measureChapterScrollPages(el)));
    } finally {
      el.remove();
    }
  }

  private chapterInnerHtml(chapter: Chapter, endBlockCount?: number): string {
    const blocks = endBlockCount === undefined ? chapter.blocks : chapter.blocks.slice(0, endBlockCount);
    return `<header class="chapter-header"><h1 class="chapter-title">${escapeHtml(chapter.title)}</h1><div class="chapter-ornament" aria-hidden="true">✦</div></header>${blocks.map(renderBlockHtml).join('')}`;
  }

  /** `+1` when a forward turn moves the track rightwards (RTL), `-1` otherwise. */
  private nextSign(): 1 | -1 {
    return this.dir === 'rtl' ? 1 : -1;
  }

  /**
   * Would a page turn in this direction move to another page? Used to apply the edge
   * rubber band instead of promising a turn that `nextPage`/`prevPage` would refuse.
   */
  private canTurn(direction: 1 | -1): boolean {
    if (!this.book) return false;
    if (direction === 1) {
      const curr = this.rendered.get(this.currentChapterIdx);
      if (!curr) return false;
      if (this.currentChapterPage + this.pageStep() < curr.layoutPageCount) return true;
      return this.currentChapterIdx + 1 < this.book.chapters.length;
    }
    if (this.currentChapterPage > 0) return true;
    return this.currentChapterIdx > 0;
  }

  /** Track offset of the page currently shown. */
  private currentPageOffset(): number {
    const pageW = Math.round(this.metrics.pageWidth);
    const raw =
      this.dir === 'rtl' ? this.currentChapterPage * pageW : -(this.currentChapterPage * pageW);
    return Math.round(raw) || 0;
  }

  /**
   * Start following the finger. The track is frozen for the duration of the gesture and
   * only `transform` changes per move (no layout, no re-measure).
   */
  beginDrag(): void {
    if (!this.book || this.dragging) return;
    this.cancelDragSettle();

    // A turn that lands past the end of the mounted slice would reveal empty paper, so
    // make sure the page being pulled into view actually exists.
    const curr = this.rendered.get(this.currentChapterIdx);
    if (curr) {
      const step = this.pageStep();
      let guard = 0;
      while (!curr.isComplete && this.currentChapterPage + step >= curr.pageCount && guard < 8) {
        guard++;
        this.appendNextBatch(curr, BATCH_WORD_BUDGET);
      }
      this.layoutVirtualizedChapterOffsets();
    }

    this.dragging = true;
    this.dragBaseOffset = this.currentPageOffset();
    this.dragPendingDx = 0;
    this.clearTrackTransition();
  }

  /** Follow the finger; `dx` is the total horizontal distance from `beginDrag`. */
  dragBy(dx: number): void {
    if (!this.dragging) return;
    const sign = this.nextSign();
    const signed = dx * sign;
    let travelled = dx;
    if (signed > 0 && !this.canTurn(1)) {
      travelled = dx * DRAG_RUBBER_BAND;
    } else if (signed < 0 && !this.canTurn(-1)) {
      travelled = dx * DRAG_RUBBER_BAND;
    } else if (signed > 0 && this.book) {
      // Reveal the neighbouring chapter before the finger gets there.
      this.ensureNeighbourMounted(1);
    } else if (signed < 0) {
      this.ensureNeighbourMounted(-1);
    }

    this.dragPendingDx = travelled;
    if (this.dragRaf !== null) return;
    this.dragRaf = window.requestAnimationFrame(() => {
      this.dragRaf = null;
      if (!this.dragging || this.dragPendingDx === null) return;
      const offset = Math.round(this.dragBaseOffset + this.dragPendingDx) || 0;
      this.trackEl.style.transform = `translate3d(${offset}px, 0, 0)`;
    });
  }

  /** Mount the first slice of the chapter a drag is heading into (if it is not there yet). */
  private ensureNeighbourMounted(direction: 1 | -1): void {
    if (!this.book) return;
    const idx = this.currentChapterIdx + direction;
    if (idx < 0 || idx >= this.book.chapters.length) return;
    if (this.rendered.has(idx)) return;
    const chapter = this.book.chapters[idx];
    if (!chapter) return;
    const entry = this.mountChapterInitial(idx, chapter, 0);
    this.rendered.set(idx, entry);
    if (entry.isComplete) this.pageCache.set(this.cacheKey(chapter), entry.pageCount);
    this.layoutVirtualizedChapterOffsets();
  }

  /** Forget the gesture and put the page back under the reader's eye. */
  cancelDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.dragRaf !== null) {
      window.cancelAnimationFrame(this.dragRaf);
      this.dragRaf = null;
    }
    this.dragPendingDx = null;
    this.clearTrackTransition();
    this.applyTrackTransform(false);
  }

  /**
   * Finish a drag: keep the turn when the finger travelled past the commit distance or
   * was still flicking in the same direction, otherwise settle back onto this page.
   */
  endDrag(dx: number, velocityPxPerMs: number, onTurned?: () => void): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.dragRaf !== null) {
      window.cancelAnimationFrame(this.dragRaf);
      this.dragRaf = null;
    }
    this.dragPendingDx = null;

    const stride = this.pageStep() * Math.max(1, Math.round(this.metrics.pageWidth));
    const sign = this.nextSign();
    const signed = dx * sign;
    const signedVelocity = velocityPxPerMs * sign;
    const threshold = stride * DRAG_COMMIT_RATIO;
    const flickDistance = stride * DRAG_FLICK_MIN_RATIO;

    let turn: 1 | -1 | 0 = 0;
    if (
      signed > 0 &&
      (signed >= threshold || (signedVelocity >= DRAG_FLICK_VELOCITY && signed >= flickDistance))
    ) {
      turn = 1;
    } else if (
      signed < 0 &&
      (-signed >= threshold || (-signedVelocity >= DRAG_FLICK_VELOCITY && -signed >= flickDistance))
    ) {
      turn = -1;
    }
    if (turn !== 0 && !this.canTurn(turn)) turn = 0;

    if (turn === 0) {
      if (this.settings.disableAnimation) {
        this.clearTrackTransition();
        this.trackEl.style.transform = `translate3d(${this.dragBaseOffset}px, 0, 0)`;
        void this.trackEl.offsetWidth;
      } else {
        this.enableTrackTransition();
        this.trackEl.style.transform = `translate3d(${this.dragBaseOffset}px, 0, 0)`;
      }
      return;
    }

    const target = Math.round(this.dragBaseOffset + turn * sign * stride) || 0;
    if (this.settings.disableAnimation) {
      this.commitDragTurn(turn, onTurned);
      return;
    }

    this.enableTrackTransition();
    this.trackEl.style.transform = `translate3d(${target}px, 0, 0)`;
    this.dragSettleTimer = window.setTimeout(() => {
      this.dragSettleTimer = null;
      this.commitDragTurn(turn, onTurned);
    }, DRAG_SETTLE_MS);
  }

  private commitDragTurn(turn: 1 | -1, onTurned?: () => void): void {
    const moved = turn === 1 ? this.nextPage() : this.prevPage();
    this.applyTrackTransform(false);
    if (moved) onTurned?.();
  }

  private cancelDragSettle(): void {
    if (this.dragSettleTimer !== null) {
      window.clearTimeout(this.dragSettleTimer);
      this.dragSettleTimer = null;
    }
  }

  private clearTrackTransition(): void {
    if (this.transitionEndTimer !== null) {
      window.clearTimeout(this.transitionEndTimer);
      this.transitionEndTimer = null;
    }
    this.trackEl.style.transition = 'none';
  }

  private enableTrackTransition(): void {
    if (this.transitionEndTimer !== null) {
      window.clearTimeout(this.transitionEndTimer);
      this.transitionEndTimer = null;
    }
    if (this.settings.disableAnimation) {
      this.trackEl.style.transition = 'none';
      return;
    }
    this.trackEl.style.transition = 'var(--page-transition)';
    this.transitionEndTimer = window.setTimeout(() => {
      this.transitionEndTimer = null;
      this.trackEl.style.transition = 'none';
    }, DRAG_SETTLE_MS + 60);
  }

  setBook(
    book: Book,
    settings: ReaderSettings,
    initialAnchor?: Anchor,
    insets?: ReaderInsets,
    highlights?: EngineHighlight[],
    initialChapterId?: string,
  ): void {
    this.cancelIdleWork();
    this.cancelExactPagination();
    this.cancelDragSettle();
    this.dragging = false;
    this.layoutGeneration++;
    this.book = book;
    this.settings = { ...settings };
    this.insets = normalizeInsets(insets);
    this.highlights = Array.isArray(highlights) ? [...highlights] : [];
    this.clearRenderedDom();
    this.clearRestoredAnchor();
    this.invalidatePageMap();
    this.settledSignature = null;
    this.metricsTrusted = false;

    this.resolveEffectiveDirection();
    this.applyStylesAndMeasureViewport();

    let targetChapterIdx = 0;
    let targetBlockIdx = 0;
    let targetBlockId: string | undefined;
    let targetOffset = 0;
    let restoredAnchor: Anchor | null = null;
    let anchorResolved = false;

    if (initialAnchor) {
      const resolved = this.resolveAnchorTarget(book, initialAnchor.blockId);
      if (resolved) {
        anchorResolved = true;
        targetChapterIdx = resolved.chapterIdx;
        targetBlockIdx = resolved.blockIdx;
        targetOffset = initialAnchor.charOffset;
        // Only an actual block can carry a page-relevant character offset; a chapter-level
        // or prefix anchor (empty chapter, or a block deleted from that chapter) has none,
        // so it resumes at the chapter's start instead.
        const resolvedBlock = book.chapters[resolved.chapterIdx]?.blocks[resolved.blockIdx];
        if (resolvedBlock?.id === initialAnchor.blockId) {
          targetBlockId = initialAnchor.blockId;
        }
        restoredAnchor = { blockId: initialAnchor.blockId, charOffset: initialAnchor.charOffset };
      }
    }

    // Fallback: the host also persists the chapter id, so a saved position can still be
    // restored when the anchor is missing or points at a chapter that no longer resolves.
    if (!anchorResolved && initialChapterId) {
      const idx = book.chapters.findIndex((ch) => ch.id === initialChapterId);
      if (idx >= 0) {
        targetChapterIdx = idx;
        targetBlockIdx = 0;
      }
    }

    this.currentChapterIdx = targetChapterIdx;
    this.currentChapterPage = 0;

    // F22: a book opened in scroll mode never builds the paginated track; chapters are
    // stacked into their slots and the normal reflow/mount lifecycle takes over from
    // there. The exact offscreen pass still measures columns for the page map.
    if (this.isScrollMode()) {
      this.enterScrollLayout(
        targetBlockId ? { blockId: targetBlockId, charOffset: targetOffset } : null,
      );
      this.renderHighlights();
      return;
    }

    // Mount ONLY the current chapter up to anchor + INITIAL_WORD_BUDGET before `ready`.
    const currChapter = book.chapters[this.currentChapterIdx];
    if (currChapter) {
      const entry = this.mountChapterInitial(this.currentChapterIdx, currChapter, targetBlockIdx);
      this.rendered.set(this.currentChapterIdx, entry);
      if (entry.isComplete) {
        this.pageCache.set(this.cacheKey(currChapter), entry.pageCount);
      }
      entry.el.style.transform = 'translate3d(0px, 0, 0)';
      entry.el.setAttribute('aria-hidden', 'false');
    }

    if (targetBlockId) {
      this.currentChapterPage = this.alignToSpread(
        this.resolveAnchorPageInCurrentChapter({
          blockId: targetBlockId,
          charOffset: targetOffset,
        }),
      );
    }
    if (restoredAnchor) {
      // A deep link must report the very anchor it was opened at, not the block that
      // happens to sit on top of the page its column landed on.
      this.rememberRestoredAnchor(restoredAnchor);
    }

    this.applyTrackTransform(false);
    this.renderHighlights();
  }

  /**
   * Map a saved anchor block id to a chapter.
   *
   * Order: an actual block in a chapter first (the normal case), then a chapter id (what
   * `captureCurrentAnchor()` emits for a chapter with zero blocks), then a `${chapter.id}_`
   * prefix (a block that was edited/deleted out of its chapter). Longest chapter id wins so
   * `ch1_p0001` cannot be claimed by a `ch1` chapter when `ch10` is the real owner.
   */
  private resolveAnchorTarget(
    book: Book,
    blockId: string,
  ): { chapterIdx: number; blockIdx: number } | null {
    for (let c = 0; c < book.chapters.length; c++) {
      const blockIdx = book.chapters[c]!.blocks.findIndex((b) => b.id === blockId);
      if (blockIdx >= 0) return { chapterIdx: c, blockIdx };
    }

    const exactChapter = book.chapters.findIndex((ch) => ch.id === blockId);
    if (exactChapter >= 0) return { chapterIdx: exactChapter, blockIdx: 0 };

    let best = -1;
    let bestLength = -1;
    for (let c = 0; c < book.chapters.length; c++) {
      const chapter = book.chapters[c]!;
      if (chapter.id.length > bestLength && blockId.startsWith(`${chapter.id}_`)) {
        best = c;
        bestLength = chapter.id.length;
      }
    }
    if (best >= 0) return { chapterIdx: best, blockIdx: 0 };

    return null;
  }

  setHighlights(highlights: EngineHighlight[]): void {
    this.highlights = Array.isArray(highlights) ? [...highlights] : [];
    this.renderHighlights();
  }

  // -------------------------------------------------------------------------
  // F46 scene placeholders
  // -------------------------------------------------------------------------

  getScenePlaceholder(sceneId: string): ScenePlaceholder | null {
    return this.scenePlaceholders.find((placeholder) => placeholder.id === sceneId) ?? null;
  }

  getSceneDisplayMode(): SceneDisplayMode {
    return this.sceneDisplayMode;
  }

  /**
   * Replace the whole scene list (used by `load` and `scene-placeholders`).
   *
   * `reflow: false` is for the `load` path, which is about to `setBook` and rebuild every
   * chapter anyway — reflowing the *previous* book first would be wasted work.
   */
  setScenePlaceholders(
    placeholders: readonly ScenePlaceholder[] | undefined,
    displayMode?: SceneDisplayMode,
    reflow = true,
  ): void {
    const normalized: ScenePlaceholder[] = [];
    for (const entry of Array.isArray(placeholders) ? placeholders : []) {
      const placeholder = normalizeScenePlaceholder(entry);
      if (placeholder) normalized.push(placeholder);
    }

    if (displayMode === 'expanded' || displayMode === 'collapsed' || displayMode === 'hidden') {
      this.sceneDisplayMode = displayMode;
    }
    if (this.sceneDisplayMode === 'collapsed') {
      for (const placeholder of normalized) placeholder.collapsed = true;
    } else if (this.sceneDisplayMode === 'expanded') {
      for (const placeholder of normalized) placeholder.collapsed = false;
    }

    this.scenePlaceholders = normalized;
    if (reflow && this.book) this.applySceneLayoutChange();
  }

  setSceneDisplayMode(mode: SceneDisplayMode): void {
    if (mode !== 'expanded' && mode !== 'collapsed' && mode !== 'hidden') return;
    this.sceneDisplayMode = mode;
    if (mode === 'collapsed') {
      this.scenePlaceholders = this.scenePlaceholders.map((placeholder) => ({
        ...placeholder,
        collapsed: true,
      }));
    } else if (mode === 'expanded') {
      this.scenePlaceholders = this.scenePlaceholders.map((placeholder) => ({
        ...placeholder,
        collapsed: false,
      }));
    }
    if (this.book) this.applySceneLayoutChange();
  }

  /**
   * Apply one scene update from the host.
   *
   * A status/image change is DOM-only (the frame box is fixed by design, so it cannot
   * move anything). Anything that changes the *box* — collapse, aspect ratio, anchor —
   * re-measures and reflows the chapter list.
   */
  updateScenePlaceholder(placeholder: ScenePlaceholder): void {
    const next = normalizeScenePlaceholder(placeholder);
    if (!next) return;

    const index = this.scenePlaceholders.findIndex((entry) => entry.id === next.id);
    const previous = index >= 0 ? this.scenePlaceholders[index]! : null;
    if (index >= 0) this.scenePlaceholders[index] = next;
    else this.scenePlaceholders.push(next);

    if (!this.book) return;

    const layoutAffecting =
      !previous ||
      previous.afterBlockId !== next.afterBlockId ||
      previous.collapsed !== next.collapsed ||
      (previous.aspectRatio ?? 0) !== (next.aspectRatio ?? 0) ||
      this.sceneDisplayMode === 'hidden';

    if (layoutAffecting) {
      this.applySceneLayoutChange();
      return;
    }

    // Status/image only: DOM-only, no reflow. The target placeholder was already replaced
    // in the list above — never broadcast its `collapsed` flag to the other scenes, or an
    // update to one scene would silently expand another collapsed one without repaginating.
    for (const entry of this.rendered.values()) {
      this.syncSceneFigures(entry);
    }
  }

  setSceneCollapsed(sceneId: string, collapsed: boolean): void {
    const placeholder = this.getScenePlaceholder(sceneId);
    if (!placeholder) return;
    this.updateScenePlaceholder({ ...placeholder, collapsed });
  }

  /** Persist an edited prompt locally so the next `scene-generate` uses it. */
  updateScenePlaceholderPrompt(sceneId: string, prompt: ScenePromptParts): void {
    const placeholder = this.getScenePlaceholder(sceneId);
    if (!placeholder) return;
    placeholder.prompt = normalizeScenePrompt(prompt);
  }

  private sceneRenderOptions(): SceneRenderOptions {
    return {
      displayMode: this.sceneDisplayMode,
      disableAnimation: this.settings.disableAnimation,
    };
  }

  /**
   * A deterministic signature of everything about the scene set that changes pagination.
   *
   * Status/image are deliberately NOT part of it: an image arriving must not invalidate
   * the page map. Collapse/aspect/anchor do change the box, so they must.
   */
  private sceneSignature(): string {
    if (this.sceneDisplayMode === 'hidden' || this.scenePlaceholders.length === 0) {
      return `scene:${this.sceneDisplayMode}:none`;
    }
    const parts = this.scenePlaceholders
      .map(
        (placeholder) =>
          `${placeholder.id}@${placeholder.afterBlockId}:${placeholder.collapsed ? 'c' : 'e'}:${placeholder.aspectRatio ?? ''}`,
      )
      .sort();
    return `scene:${this.sceneDisplayMode}:${parts.join(',')}`;
  }

  /** Insert/update/remove the scene frames inside one rendered chapter. */
  private syncSceneFigures(entry: RenderedChapter): void {
    syncScenePlaceholdersInRoot(entry.el, this.scenePlaceholders, this.sceneRenderOptions());
  }

  /**
   * Reflow after the scene set changed the box (mount, collapse, hide, aspect ratio).
   *
   * Follows the same anchor-restore contract as a settings change: the reader keeps the
   * block they were on, and the page map is rebuilt from real measurements.
   */
  private applySceneLayoutChange(): void {
    if (!this.book) return;
    this.cancelIdleWork();
    this.cancelExactPagination();
    this.cancelDragSettle();
    this.dragging = false;
    this.layoutGeneration++;

    const anchorBefore = this.captureCurrentAnchor();
    this.rememberRestoredAnchor(anchorBefore);

    for (const entry of this.rendered.values()) {
      this.syncSceneFigures(entry);
      this.remeasureChapter(entry);
    }

    // The scene signature is part of the cache key, so counts measured before this
    // change are unreachable; drop those stale scene-layout entries from memory too.
    const currentSignature = this.layoutSignature();
    for (const key of Array.from(this.pageCache.keys())) {
      if (key.includes('|scene:') && !key.endsWith(`|${currentSignature}`)) {
        this.pageCache.delete(key);
      }
    }

    this.invalidatePageMap();

    if (this.isScrollMode()) {
      // F46 in scroll mode: scene frames occupy flow height, so one changed figure resizes
      // everything below it. Rebuild the reserved track from the new measurements and put
      // the same anchor (block **and** character offset) back on the reading line. The
      // spread reflow below only makes sense when chapters are columns of one page.
      this.invalidateScrollSlots();
      this.updateScrollSpacers();
      if (anchorBefore) {
        this.positionScrollAtAnchor(anchorBefore);
      } else {
        this.mountScrollWindow(this.scrollVisibleIndex(), false);
      }
      this.updateScrollProgressFill();
      this.renderHighlights();
      this.scheduleBackgroundWork();
      this.callbacks.onBackgroundProgress?.();
      return;
    }

    this.layoutVirtualizedChapterOffsets();

    if (anchorBefore) {
      this.currentChapterPage = this.alignToSpread(
        this.resolveAnchorPageInCurrentChapter(anchorBefore),
      );
    } else {
      const curr = this.rendered.get(this.currentChapterIdx);
      const maxPage = curr ? curr.layoutPageCount - 1 : 0;
      this.currentChapterPage = Math.max(0, Math.min(this.currentChapterPage, maxPage));
    }

    this.applyTrackTransform(false);
    this.renderHighlights();
    this.scheduleBackgroundWork();
    // The host should see the corrected position/page numbers immediately.
    this.callbacks.onBackgroundProgress?.();
  }

  /**
   * Highlights arrive in **original-text** coordinates — that is what the host persists and
   * what survives a mode change — while the DOM holds the displayed text and everything the
   * highlight renderer/hit-tester touches (`buildBlockRange`, `Range`) works on displayed
   * offsets. Translate once per render, per mounted block.
   *
   * A highlight on a block that is not mounted yet is passed through unconverted; the
   * renderer skips unmounted blocks, and the block is converted on a later pass once it is
   * mounted.
   */
  private displayHighlights(): EngineHighlight[] {
    const mode = this.settings.tashkeel;
    if (mode === 'full' || this.highlights.length === 0) return this.highlights;

    const blockById = new Map<string, HTMLElement>();
    for (const entry of this.rendered.values()) {
      for (const [blockId, el] of entry.blockById) blockById.set(blockId, el);
    }

    const converted: EngineHighlight[] = [];
    for (const hl of this.highlights) {
      const blockEl = blockById.get(hl.blockId);
      if (!blockEl) {
        converted.push(hl);
        continue;
      }
      const start = toDisplayOffset(blockEl, hl.charOffset, mode);
      const end = toDisplayOffset(blockEl, hl.charOffset + hl.length, mode);
      converted.push({ ...hl, charOffset: start, length: Math.max(0, end - start) });
    }
    return converted;
  }

  /** Convert a displayed-text offset inside `blockEl` back to the file's coordinates. */
  toOriginalOffsetInBlock(blockEl: HTMLElement, displayOffset: number): number {
    return toOriginalOffset(blockEl, displayOffset, this.settings.tashkeel);
  }

  renderHighlights(forceOverlay = false): { mode: 'css-highlight' | 'overlay'; renderedCount: number } {
    return renderEngineHighlights(this.rendered.values(), this.displayHighlights(), { forceOverlay });
  }

  hitTestHighlight(
    clientX: number,
    clientY: number,
  ): { highlight: EngineHighlight; rect: SelectionRect } | null {
    // Scroll mode keeps several chapters live at once, so every mounted chapter can own
    // the point. Paginated mode only ever shows one.
    const targets = this.isScrollMode()
      ? Array.from(this.rendered.values())
      : (() => {
          const active = this.rendered.get(this.currentChapterIdx);
          return active ? [active] : [];
        })();
    if (targets.length === 0) return null;
    return hitTestHighlightAtPoint(targets, this.displayHighlights(), clientX, clientY);
  }

  /**
   * Kick off idle progressive mounting for the rest of the current chapter
   * and adjacent virtualized chapters (-1 and +1). Called right after `ready`.
   *
   * Why (product, S3): the mount appends blocks to the live track, and a chapter that
   * becomes complete there is written into the page map. Doing that while the exact pass
   * is still counting means the reader can be told one page number and then another. So
   * the map is made final first — the pass is frame-chunked and normally finishes in
   * well under a second — and only then does the mount run; every progress tick after
   * that re-publishes a page that cannot move. The wait is bounded (see
   * `BACKGROUND_DEFER_MAX_MS`) so a slow pass can never leave a chapter half mounted.
   */
  scheduleBackgroundWork(): void {
    this.cancelIdleWork();
    if (!this.book) return;
    if (this.isScrollMode()) {
      this.scheduleScrollMountWork();
      return;
    }
    this.backgroundWanted = true;
    if (this.isPageMapExact()) {
      this.runBackgroundWork();
      return;
    }
    if (this.backgroundFallbackTimer === null) {
      this.backgroundFallbackTimer = window.setTimeout(() => {
        this.backgroundFallbackTimer = null;
        if (this.backgroundWanted) this.runBackgroundWork();
      }, BACKGROUND_DEFER_MAX_MS);
    }
  }

  private runBackgroundWork(): void {
    this.cancelIdleWork();
    this.backgroundWanted = false;
    if (this.backgroundFallbackTimer !== null) {
      window.clearTimeout(this.backgroundFallbackTimer);
      this.backgroundFallbackTimer = null;
    }
    if (!this.book) return;
    const gen = this.layoutGeneration;

    const curr = this.rendered.get(this.currentChapterIdx);
    const hasPendingCurr = Boolean(curr && !curr.isComplete);
    const needsAdjacent = this.hasUnmountedAdjacentChapters();

    if (!hasPendingCurr && curr) {
      this.callbacks.onChapterLayoutComplete?.(curr.chapter.id);
    }

    if (!hasPendingCurr && !needsAdjacent) {
      return;
    }

    const scheduleNext = (fn: () => void) => {
      const win = window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof win.requestIdleCallback === 'function') {
        const id = win.requestIdleCallback(() => fn(), { timeout: 60 });
        this.idleHandle = { kind: 'idle', id };
      } else {
        const id = window.setTimeout(fn, 0);
        this.idleHandle = { kind: 'timeout', id };
      }
    };

    const step = () => {
      this.idleHandle = null;
      if (gen !== this.layoutGeneration || !this.book) return;

      const active = this.rendered.get(this.currentChapterIdx);
      if (active && !active.isComplete) {
        this.appendNextBatch(active, BATCH_WORD_BUDGET);
        this.layoutVirtualizedChapterOffsets();
        this.renderHighlights();
        this.callbacks.onBackgroundProgress?.();
        if (active.isComplete) {
          this.callbacks.onChapterLayoutComplete?.(active.chapter.id);
        }
        scheduleNext(step);
        return;
      }

      // Current chapter is complete; mount or advance adjacent chapters (-1 and +1)
      const adjIndices = [this.currentChapterIdx + 1, this.currentChapterIdx - 1];
      for (const adjIdx of adjIndices) {
        if (adjIdx < 0 || adjIdx >= this.book.chapters.length) continue;
        let adj = this.rendered.get(adjIdx);
        if (!adj) {
          adj = this.mountChapterInitial(adjIdx, this.book.chapters[adjIdx]!, 0);
          this.rendered.set(adjIdx, adj);
          if (adj.isComplete) {
            this.pageCache.set(this.cacheKey(adj.chapter), adj.pageCount);
          }
          this.layoutVirtualizedChapterOffsets();
          this.renderHighlights();
          if (!adj.isComplete || this.hasUnmountedAdjacentChapters()) {
            scheduleNext(step);
          }
          return;
        }
        if (!adj.isComplete) {
          this.appendNextBatch(adj, BATCH_WORD_BUDGET);
          this.layoutVirtualizedChapterOffsets();
          this.renderHighlights();
          if (!adj.isComplete || this.hasUnmountedAdjacentChapters()) {
            scheduleNext(step);
          }
          return;
        }
      }
    };

    scheduleNext(step);
  }

  updateSettings(partial: Partial<ReaderSettings>, insets?: ReaderInsets): void {
    this.cancelIdleWork();
    this.cancelExactPagination();
    this.cancelDragSettle();
    this.dragging = false;
    this.layoutGeneration++;

    const wasScroll = this.isScrollMode();
    // Captured *before* the new mode rewrites any text node, so the anchor is already in
    // original-text coordinates and can be re-resolved against the new display text.
    const anchorBefore = this.book ? this.captureCurrentAnchor() : null;
    // The anchor is authoritative across the reflow: report it back verbatim instead of
    // re-deriving a (lossy) top-of-page block from the new layout.
    this.rememberRestoredAnchor(anchorBefore);
    this.settings = { ...this.settings, ...partial };
    if (insets !== undefined) {
      this.insets = normalizeInsets(insets);
    }
    this.resolveEffectiveDirection();

    // F18: a tashkeel change rewrites text nodes, so it has to happen before the reflow
    // that resolves the anchor and measures the new page counts.
    this.applyTashkeelToMounted();

    for (const entry of this.rendered.values()) {
      entry.el.setAttribute('dir', this.dir);
    }

    this.applyStylesAndMeasureViewport();

    if (!this.book) return;

    const nowScroll = this.isScrollMode();
    if (nowScroll) {
      if (wasScroll) {
        this.reflowScrollLayout(anchorBefore);
      } else {
        this.enterScrollLayout(anchorBefore);
      }
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return;
    }

    if (wasScroll) {
      this.leaveScrollLayout(anchorBefore);
      return;
    }

    // Ensure anchor's chapter is mounted enough to cover anchor, then re-measure mounted chapters
    for (const entry of this.rendered.values()) {
      this.remeasureChapter(entry);
    }

    this.layoutVirtualizedChapterOffsets();

    if (anchorBefore) {
      this.currentChapterPage = this.alignToSpread(this.resolveAnchorPageInCurrentChapter(anchorBefore));
    } else {
      const curr = this.rendered.get(this.currentChapterIdx);
      const maxPage = curr ? curr.layoutPageCount - 1 : 0;
      this.currentChapterPage = Math.max(0, Math.min(this.currentChapterPage, maxPage));
    }

    this.applyTrackTransform(false);
    this.renderHighlights();
    this.scheduleBackgroundWork();
  }

  handleViewportResize(): boolean {
    const prevW = this.metrics.width;
    const prevH = this.metrics.height;
    const anchorBefore = this.book ? this.captureCurrentAnchor() : null;

    this.applyStylesAndMeasureViewport();
    if (this.metrics.width === prevW && this.metrics.height === prevH) {
      return false;
    }
    if (!this.book) return true;

    this.cancelIdleWork();
    this.cancelExactPagination();
    this.layoutGeneration++;
    this.rememberRestoredAnchor(anchorBefore);

    if (this.isScrollMode()) {
      // Slot heights are width-dependent: the new viewport reflowed every mounted chapter,
      // so the cached document-space table is stale. Re-measure, then re-anchor.
      this.invalidateScrollSlots();
      this.updateScrollSpacers();
      if (anchorBefore) {
        this.positionScrollAtAnchor(anchorBefore);
      }
      this.updateScrollProgressFill();
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    for (const entry of this.rendered.values()) {
      this.remeasureChapter(entry);
    }
    this.layoutVirtualizedChapterOffsets();

    if (anchorBefore) {
      this.currentChapterPage = this.alignToSpread(this.resolveAnchorPageInCurrentChapter(anchorBefore));
    }
    this.applyTrackTransform(false);
    this.renderHighlights();
    this.scheduleBackgroundWork();
    return true;
  }

  handleFontLoad(): boolean {
    // Scroll mode has no columns to re-measure; the exact offscreen pass owns the page map
    // and `settleLayout` already measured against the faces that applied.
    if (this.isScrollMode()) return false;
    if (!this.book || this.rendered.size === 0) return false;
    const anchorBefore = this.captureCurrentAnchor();
    let changed = false;

    for (const entry of this.rendered.values()) {
      const before = entry.pageCount;
      this.remeasureChapter(entry);
      if (entry.pageCount !== before) {
        changed = true;
      }
    }

    if (!changed) return false;

    this.cancelExactPagination();
    // The real face changed in place, so every count measured against the fallback
    // face is stale while keeping the same cache key. Drop them and keep only what
    // was just re-measured with the loaded font.
    const signature = this.layoutSignature();
    for (const key of Array.from(this.pageCache.keys())) {
      if (key.endsWith(`|${signature}`)) this.pageCache.delete(key);
    }
    for (const entry of this.rendered.values()) {
      if (entry.isComplete) {
        this.pageCache.set(this.cacheKey(entry.chapter), entry.pageCount);
      }
    }
    this.invalidatePageMap();

    this.rememberRestoredAnchor(anchorBefore);
    this.layoutVirtualizedChapterOffsets();
    this.currentChapterPage = this.alignToSpread(this.resolveAnchorPageInCurrentChapter(anchorBefore));
    this.applyTrackTransform(false);
    this.renderHighlights();
    return true;
  }

  /**
   * Re-measure what is already mounted against the styles that actually ended up
   * applied, and report whether any page count moved.
   *
   * The very first frame of a book is laid out with whatever face the WebView has at
   * that instant — typically a fallback that is meaningfully wider than the webfont
   * that swaps in a moment later. Measuring then reports more pages than the chapter
   * really occupies, and an estimate built on that reading pins the book total (and
   * therefore the TOC) tens of pages away from the truth. `handleFontLoad` catches
   * late swaps, but it only fires once a face is actually requested: this pass is the
   * "look again now that a frame has been painted" half of the pair.
   */
  settleLayout(): boolean {
    if (!this.book || this.rendered.size === 0) return false;
    if (this.isScrollMode()) {
      // Scroll chapters are laid out in flow, not columns, so there is nothing to re-measure
      // in place. Trusting the layout here unlocks the position/TOC the exact pass fills in.
      this.metricsTrusted = true;
      this.startExactPagination();
      return false;
    }
    const signature = this.layoutSignature();
    const firstForSignature = this.settledSignature !== signature;
    this.settledSignature = signature;

    let changed = false;
    if (firstForSignature) {
      this.cancelExactPagination();
      // Counts cached before this pass were measured against an unsettled layout under
      // the same cache key; they are not evidence. Keep only what we re-measure below.
      for (const key of Array.from(this.pageCache.keys())) {
        if (key.endsWith(`|${signature}`)) this.pageCache.delete(key);
      }
    }

    for (const entry of this.rendered.values()) {
      const before = entry.pageCount;
      this.remeasureChapter(entry);
      if (entry.pageCount !== before) changed = true;
    }

    // The chapter being read is the only one whose real page count calibrates the
    // estimate, and the density above already corrects for its partly filled last page,
    // so a half-mounted slice is a usable sample. Remounting the rest of it here would
    // stall the first number behind the whole chapter.

    // From here on the measurements describe the faces that actually applied, so the
    // page numbers may be quoted to the reader.
    this.metricsTrusted = true;

    if (changed || firstForSignature) {
      this.invalidatePageMap();
      this.layoutVirtualizedChapterOffsets();
      // Why (P1 #57 + Codex P2): once fonts/first-paint settle, re-snap to the restored
      // anchor (or clamp inside the settled page count) with transition disabled — but NEVER
      // interrupt an active finger drag or release settle animation (e.g. from a late image
      // load); commitDragTurn/cancelDrag will snap cleanly when the gesture finishes.
      if (!this.dragging && this.dragSettleTimer === null) {
        if (this.isRestoredAnchorUsable()) {
          this.currentChapterPage = this.alignToSpread(
            this.resolveAnchorPageInCurrentChapter(this.restoredAnchor!),
          );
        } else {
          const curr = this.rendered.get(this.currentChapterIdx);
          const maxPage = curr ? curr.layoutPageCount - 1 : 0;
          this.currentChapterPage = Math.max(0, Math.min(this.currentChapterPage, maxPage));
        }
        this.applyTrackTransform(false);
      }
      this.renderHighlights();
    }
    // Count the rest of the book offscreen so the page number (and the total) are a
    // property of the book and the layout, not of which chapters happen to be mounted.
    this.startExactPagination();
    return changed;
  }

  nextPage(): boolean {
    if (!this.book) return false;
    if (this.isScrollMode()) return this.scrollByViewport(1);
    const curr = this.rendered.get(this.currentChapterIdx);
    if (!curr) return false;
    const step = this.pageStep();

    // If approaching the end of a partially mounted chapter, mount the next batch
    // synchronously — in spread mode a turn consumes two pages at once.
    let mounted = false;
    let guard = 0;
    while (!curr.isComplete && this.currentChapterPage + step >= curr.pageCount && guard < 8) {
      guard++;
      this.appendNextBatch(curr, BATCH_WORD_BUDGET);
      mounted = true;
    }
    if (mounted) {
      this.layoutVirtualizedChapterOffsets();
      this.renderHighlights();
      if (curr.isComplete) {
        this.callbacks.onChapterLayoutComplete?.(curr.chapter.id);
      }
    }

    if (this.currentChapterPage + step < curr.layoutPageCount) {
      this.currentChapterPage = this.alignToSpread(this.currentChapterPage + step);
      this.clearRestoredAnchor();
      this.applyTrackTransform(!this.settings.disableAnimation);
      return true;
    }

    if (this.currentChapterIdx + 1 < this.book.chapters.length) {
      this.currentChapterIdx += 1;
      this.currentChapterPage = 0;
      this.clearRestoredAnchor();
      this.syncActiveAndEvict(0);
      this.applyTrackTransform(false);
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
  }

  prevPage(): boolean {
    if (!this.book) return false;
    if (this.isScrollMode()) return this.scrollByViewport(-1);
    const step = this.pageStep();

    if (this.currentChapterPage > 0) {
      this.currentChapterPage = this.alignToSpread(Math.max(0, this.currentChapterPage - step));
      this.clearRestoredAnchor();
      this.applyTrackTransform(!this.settings.disableAnimation);
      return true;
    }

    if (this.currentChapterIdx > 0) {
      this.currentChapterIdx -= 1;
      this.clearRestoredAnchor();
      const targetChapter = this.book.chapters[this.currentChapterIdx]!;
      // Going backwards to the end of the previous chapter requires all its blocks mounted
      this.syncActiveAndEvict(targetChapter.blocks.length);
      const curr = this.rendered.get(this.currentChapterIdx);
      this.currentChapterPage = curr ? this.lastSpreadStart(curr.layoutPageCount) : 0;
      this.applyTrackTransform(false);
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
  }

  /** Pages consumed by one turn: 1 normally, 2 while an open-book spread is shown. */
  private pageStep(): number {
    return this.metrics.spread ? 2 : 1;
  }

  /** A spread always starts on an even page index so turning never skips or repeats a page. */
  private alignToSpread(page: number): number {
    if (!this.metrics.spread) return Math.max(0, page);
    return Math.max(0, page - (page % 2));
  }

  /** First page of the final spread of a chapter. */
  private lastSpreadStart(pageCount: number): number {
    if (!this.metrics.spread) return Math.max(0, pageCount - 1);
    return this.alignToSpread(Math.max(0, pageCount - 1));
  }

  goto(target: { anchor?: Anchor; chapterId?: string; page?: number }): boolean {
    if (!this.book) return false;
    if (this.isScrollMode()) return this.gotoScroll(target);

    if (target.anchor) {
      const resolved = this.resolveAnchorTarget(this.book, target.anchor.blockId);
      if (!resolved) {
        // The anchor could not be mapped. A caller that also supplied a chapter id can
        // still land somewhere sensible; otherwise the jump is genuinely invalid.
        if (!target.chapterId) return false;
      } else {
        const chIdx = resolved.chapterIdx;
        const blockIdx = resolved.blockIdx;

        if (chIdx !== this.currentChapterIdx) {
          this.currentChapterIdx = chIdx;
          this.syncActiveAndEvict(blockIdx);
        } else {
          const curr = this.rendered.get(this.currentChapterIdx);
          if (curr && blockIdx >= curr.mountedBlockCount) {
            this.mountThroughBlockIndex(curr, blockIdx);
            this.layoutVirtualizedChapterOffsets();
          }
        }

        this.currentChapterPage = this.alignToSpread(
          this.resolveAnchorPageInCurrentChapter(target.anchor),
        );
        this.clearRestoredAnchor();
        this.applyTrackTransform(false);
        this.renderHighlights();
        this.scheduleBackgroundWork();
        return true;
      }
    }

    if (target.chapterId) {
      const chIdx = this.book.chapters.findIndex((ch) => ch.id === target.chapterId);
      if (chIdx < 0) return false;

      const requestedZeroBased = target.page !== undefined ? Math.max(0, target.page - 1) : 0;
      if (chIdx !== this.currentChapterIdx) {
        this.currentChapterIdx = chIdx;
        this.syncActiveAndEvict(0);
      }

      const curr = this.rendered.get(this.currentChapterIdx);
      if (curr) {
        while (!curr.isComplete && requestedZeroBased >= curr.pageCount) {
          this.appendNextBatch(curr, BATCH_WORD_BUDGET);
        }
        this.layoutVirtualizedChapterOffsets();
      }

      const maxPage = curr ? curr.layoutPageCount - 1 : 0;
      this.currentChapterPage = this.alignToSpread(Math.min(maxPage, requestedZeroBased));
      this.clearRestoredAnchor();
      this.applyTrackTransform(false);
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    if (typeof target.page === 'number' && Number.isFinite(target.page)) {
      const desiredGlobalZero = Math.max(0, Math.floor(target.page) - 1);
      const counts = this.refreshPageMap().counts;
      let offset = 0;
      let targetIdx = this.book.chapters.length - 1;
      let pageInChapter = 0;

      for (let i = 0; i < counts.length; i++) {
        const c = counts[i] ?? 1;
        if (desiredGlobalZero < offset + c || i === counts.length - 1) {
          targetIdx = i;
          pageInChapter = Math.max(0, desiredGlobalZero - offset);
          break;
        }
        offset += c;
      }

      if (targetIdx !== this.currentChapterIdx) {
        this.currentChapterIdx = targetIdx;
        this.syncActiveAndEvict(0);
      }

      const curr = this.rendered.get(this.currentChapterIdx);
      if (curr) {
        while (!curr.isComplete && pageInChapter >= curr.pageCount) {
          this.appendNextBatch(curr, BATCH_WORD_BUDGET);
        }
        this.layoutVirtualizedChapterOffsets();
      }

      const maxPage = curr ? curr.layoutPageCount - 1 : 0;
      this.currentChapterPage = this.alignToSpread(Math.min(maxPage, pageInChapter));
      this.clearRestoredAnchor();
      this.applyTrackTransform(false);
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
  }

  getPositionSnapshot(): PositionSnapshot | null {
    if (!this.book) return null;
    // Nothing is quotable before the layout settled (see `metricsTrusted`).
    if (!this.metricsTrusted) return null;
    if (this.isScrollMode()) return this.getScrollPositionSnapshot();
    const chapter = this.book.chapters[this.currentChapterIdx];
    const curr = this.rendered.get(this.currentChapterIdx);
    if (!chapter || !curr) return null;

    // Every exposed number comes from the same page map the TOC and `goto({ page })`
    // use, so "صفحة 4" in the TOC and the footer can never disagree.
    const map = this.refreshPageMap();
    const counts = map.counts;
    let pagesBefore = 0;
    for (let i = 0; i < this.currentChapterIdx; i++) {
      pagesBefore += counts[i] ?? 1;
    }
    const totalPages = Math.max(1, map.total);
    const chapterPageCount = Math.max(1, counts[this.currentChapterIdx] ?? 1);
    // A chapter can be parked on its final spread while a blank pad fills the facing
    // page. Clamp back onto the last real page so no exposed number lands on padding.
    const chapterPageIndex = Math.max(0, Math.min(this.currentChapterPage, chapterPageCount - 1));
    const globalPage = Math.max(1, Math.min(totalPages, pagesBefore + chapterPageIndex + 1));
    const bookProgress = totalPages <= 1 ? 1 : (globalPage - 1) / (totalPages - 1);

    return {
      anchor: this.captureCurrentAnchor(),
      chapterId: chapter.id,
      page: globalPage,
      pageCount: totalPages,
      chapterPage: chapterPageIndex + 1,
      chapterPageCount,
      bookProgress: Math.max(0, Math.min(1, Number(bookProgress.toFixed(6)))),
      spread: this.metrics.spread,
      readingMode: 'paginated',
      estimated: map.estimated,
    };
  }

  /**
   * TOC entries in real page numbers. `startPage` is the 1-based real page the chapter
   * begins on, so it can be sent back through `goto({ page })` and matches `position.page`.
   * Blank spread pads are intentionally excluded.
   */
  getTocEntries(): TocEntry[] {
    if (!this.book) return [];
    // A TOC built from unsettled metrics would advertise page numbers that are about to
    // move; the app keeps showing the library until real numbers exist.
    if (!this.metricsTrusted) return [];
    const map = this.refreshPageMap();
    let startPage = 1;
    return this.book.chapters.map((ch, idx) => {
      const pageCount = Math.max(1, map.counts[idx] ?? 1);
      const entry: TocEntry = {
        id: ch.id,
        title: ch.title,
        wordCount: ch.wordCount,
        pageCount,
        startPage,
        estimated: !map.exact[idx],
      };
      startPage += pageCount;
      return entry;
    });
  }

  /** Remember the anchor a reflow restored to (authoritative until the next navigation). */
  private rememberRestoredAnchor(anchor: Anchor | null): void {
    this.restoredAnchor = anchor
      ? { blockId: anchor.blockId, charOffset: anchor.charOffset }
      : null;
  }

  /** Forget the restored anchor: the position is geometry-derived again. */
  private clearRestoredAnchor(): void {
    this.restoredAnchor = null;
    this.scrollRestoredTop = null;
  }

  /**
   * true when the remembered anchor still points at a mounted block of the active
   * chapter — otherwise it is stale and geometry has to answer.
   */
  private isRestoredAnchorUsable(): boolean {
    if (!this.restoredAnchor) return false;
    const curr = this.rendered.get(this.currentChapterIdx);
    if (!curr) return false;
    if (curr.blockById.has(this.restoredAnchor.blockId)) return true;
    // An empty chapter has no block to hold the anchor: `captureCurrentAnchor()` emits the
    // chapter id itself, and that stays authoritative while the chapter stays empty.
    return curr.chapter.id === this.restoredAnchor.blockId && curr.blockEls.length === 0;
  }

  captureCurrentAnchor(): Anchor {
    if (this.isRestoredAnchorUsable()) {
      return { blockId: this.restoredAnchor!.blockId, charOffset: this.restoredAnchor!.charOffset };
    }
    if (this.restoredAnchor) {
      this.clearRestoredAnchor();
    }

    if (this.isScrollMode()) {
      return this.captureScrollAnchor();
    }

    const curr = this.rendered.get(this.currentChapterIdx);
    if (!curr || curr.blockEls.length === 0) {
      const fallbackId = curr?.chapter.blocks[0]?.id ?? curr?.chapter.id ?? 'ch01_p0001';
      return { blockId: fallbackId, charOffset: 0 };
    }

    const chRect = curr.el.getBoundingClientRect();
    const pageW = this.metrics.pageWidth;
    const targetPage = this.currentChapterPage;
    const els = curr.blockEls;

    let lo = 0;
    let hi = els.length - 1;
    let firstCandidate = els.length - 1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const el = els[mid]!;
      const rect = el.getBoundingClientRect();
      const endCol = getColumnForRect(rect, chRect, this.dir, pageW, 'end');
      if (endCol >= targetPage) {
        firstCandidate = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const blockEl = els[firstCandidate]!;
    const blockId = blockEl.getAttribute('data-block-id') ?? curr.chapter.id;
    const blockRect = blockEl.getBoundingClientRect();
    const startCol = getColumnForRect(blockRect, chRect, this.dir, pageW, 'start');

    if (startCol >= targetPage) {
      return { blockId, charOffset: 0 };
    }

    const textLen = blockEl.textContent?.length ?? 0;
    if (textLen === 0) {
      return { blockId, charOffset: 0 };
    }

    let cLo = 0;
    let cHi = textLen - 1;
    let foundOffset = 0;
    let matched = false;

    while (cLo <= cHi) {
      const cMid = (cLo + cHi) >> 1;
      const charRect = getCharacterRect(blockEl, cMid);
      if (!charRect) break;
      const col = getColumnForRect(charRect, chRect, this.dir, pageW, 'start');
      if (col >= targetPage) {
        foundOffset = cMid;
        matched = true;
        cHi = cMid - 1;
      } else {
        cLo = cMid + 1;
      }
    }

    if (!matched && firstCandidate + 1 < els.length) {
      const nextEl = els[firstCandidate + 1]!;
      return {
        blockId: nextEl.getAttribute('data-block-id') ?? blockId,
        charOffset: 0,
      };
    }

    // The binary search above walked the *displayed* text (that is what the layout has),
    // but every anchor the app persists — bookmarks, search results, the last position —
    // addresses the book's own text. Report original coordinates, always.
    return { blockId, charOffset: this.toOriginalAnchorOffset(blockEl, foundOffset) };
  }

  /**
   * F18: anchors are stored in original-text coordinates. With a tashkeel mode that hides
   * marks the DOM is shorter than the file, so `foundOffset` (a displayed offset) has to be
   * translated back before it leaves the engine.
   */
  private toOriginalAnchorOffset(el: HTMLElement, displayOffset: number): number {
    const mode = this.settings.tashkeel;
    if (mode === 'full') return displayOffset;
    return toOriginalOffset(el, displayOffset, mode);
  }

  /** F18: the inverse of {@link toOriginalAnchorOffset}, applied before measuring. */
  private toDisplayAnchorOffset(el: HTMLElement, originalOffset: number): number {
    const mode = this.settings.tashkeel;
    if (mode === 'full') return originalOffset;
    return toDisplayOffset(el, originalOffset, mode);
  }

  /** Rewrite every mounted chapter's text nodes for the current tashkeel mode. */
  private applyTashkeelToMounted(): void {
    const mode = this.settings.tashkeel;
    for (const entry of this.rendered.values()) {
      applyTashkeelToElement(entry.el, mode);
    }
  }

  private resolveAnchorPageInCurrentChapter(anchor: Anchor): number {
    const curr = this.rendered.get(this.currentChapterIdx);
    if (!curr) return 0;

    const blockEl = curr.blockById.get(anchor.blockId);
    if (!blockEl) return 0;

    const chRect = curr.el.getBoundingClientRect();
    // F18: the anchor addresses the file's text; the layout was measured on the displayed
    // text, so convert before asking the DOM where that character sits.
    const displayOffset = this.toDisplayAnchorOffset(blockEl, anchor.charOffset);
    const rect =
      displayOffset > 0
        ? getCharacterRect(blockEl, displayOffset)
        : this.getFirstContentRect(blockEl);

    if (!rect) return 0;
    const col = getColumnForRect(rect, chRect, this.dir, this.metrics.pageWidth, 'start');
    return Math.max(0, Math.min(curr.layoutPageCount - 1, col));
  }

  private getFirstContentRect(el: HTMLElement): DOMRect | null {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]!;
      if (r.width > 0 || r.height > 0) {
        return r;
      }
    }
    return el.getBoundingClientRect();
  }

  private resolveEffectiveDirection(): void {
    if (this.settings.dirOverride === 'rtl' || this.settings.dirOverride === 'ltr') {
      this.dir = this.settings.dirOverride;
      return;
    }
    this.dir = this.book?.meta.dir === 'ltr' ? 'ltr' : 'rtl';
  }

  private applyStylesAndMeasureViewport(): void {
    // F32 — ألوان مخصّصة. A custom pair wins over the preset theme, but only when it is enabled,
    // both colours are real hex *and* the pair clears WCAG AA: the engine is the last line of
    // defence, so a corrupted or unreadable stored value degrades to the chosen preset instead of
    // painting a page whose ink disappears. `enabled` is compared strictly, not truthily — a
    // mangled `"yes"` from an old build must not paint.
    const customEnabled = this.settings.customColors?.enabled === true;
    const customBg = customEnabled ? normalizeHexColor(this.settings.customColors!.bg) : null;
    const customText = customEnabled ? normalizeHexColor(this.settings.customColors!.text) : null;
    const customTokens =
      customBg && customText && contrastRatioHex(customText, customBg) >= WCAG_AA_MIN_RATIO
        ? buildCustomThemeTokens(customBg, customText)
        : null;
    const theme = customTokens ?? (THEMES[this.settings.theme] ?? THEMES.warraq);
    // The spine follows the *accepted* pair, not just a valid background: a readable background
    // with a broken ink falls back to the preset page, so the fold must fall back with it.
    const spine = customTokens
      ? spineTokensForColors(customTokens.bg)
      : spineTokensFor(this.settings.theme);
    const rootStyle = document.documentElement.style;

    const maxCh = Math.max(45, Math.min(85, Math.round(this.settings.maxReadingWidth)));
    const rawLineHeight = Math.max(1.5, Math.min(2.6, this.settings.lineHeight));
    const fontSize = Math.max(14, Math.min(36, this.settings.fontSize));
    const fontWeight = Math.max(300, Math.min(600, Math.round(this.settings.fontWeight)));

    // Clear pinned stage dimensions so the stage measures against the viewport & --max-width.
    rootStyle.removeProperty('--stage-width');
    rootStyle.removeProperty('--stage-height');

    // The spread decision comes from the *viewport*, because the stage width is
    // already capped by --max-width and would feedback-loop on itself.
    const rootRect = this.rootEl.getBoundingClientRect();
    const viewportW = Math.floor(rootRect.width || this.rootEl.clientWidth || window.innerWidth || 390);
    const viewportH = Math.floor(rootRect.height || this.rootEl.clientHeight || window.innerHeight || 844);
    // F22: a continuous column has no facing page, so scroll mode is always single.
    const spread =
      !this.isScrollMode() &&
      this.settings.spread !== 'single' &&
      viewportW >= SPREAD_MIN_VIEWPORT_PX &&
      viewportW > viewportH;

    // Cap the open book so one column never exceeds the design's line measure (54ch).
    const bookMaxPx = measureChToPx(maxCh, fontSize) * 2 + SPREAD_GUTTER_PX;
    if (spread) {
      rootStyle.setProperty('--max-width', `${bookMaxPx}px`);
    } else {
      rootStyle.setProperty('--max-width', `${maxCh}ch`);
    }

    // Read the stage after the width cap and floor fractional CSS pixels so pageWidth
    // matches the clipped stage box with zero subpixel drift across page turns.
    const stageRect = this.stageEl.getBoundingClientRect();
    const stageW = Math.floor(stageRect.width || this.stageEl.clientWidth || viewportW);
    const stageH = Math.floor(stageRect.height || this.stageEl.clientHeight || viewportH);

    const pageWidth = spread ? Math.floor(stageW / 2) : stageW;
    const bookWidth = spread ? pageWidth * 2 : pageWidth;
    // In spread mode the centre gutter is the column gap, so each column keeps
    // the same half-gutter of breathing room on its outer edge and the crease
    // lands exactly on the middle of the book.
    const marginH = spread
      ? Math.round(SPREAD_GUTTER_PX / 2)
      : Math.max(8, Math.min(Math.floor(stageW / 4), Math.round(this.settings.marginHorizontal)));
    const rawMarginV = Math.max(16, Math.min(Math.floor(stageH / 4), Math.round(this.settings.marginVertical)));
    const minUsableHeight = Math.min(160, Math.floor(stageH * 0.5));
    const maxChrome = Math.max(0, stageH - minUsableHeight);
    const totalInsets = this.insets.top + this.insets.bottom;
    const insetScale = totalInsets > maxChrome && totalInsets > 0 ? maxChrome / totalInsets : 1;
    const effectiveInsetTop = Math.floor(this.insets.top * insetScale);
    const effectiveInsetBottom = Math.floor(this.insets.bottom * insetScale);
    const maxMarginV = Math.max(
      0,
      Math.floor((stageH - effectiveInsetTop - effectiveInsetBottom - minUsableHeight) / 2),
    );
    const marginV = Math.min(rawMarginV, maxMarginV);
    const paddingTop = effectiveInsetTop + marginV;
    const paddingBottom = effectiveInsetBottom + marginV;

    this.metrics = {
      width: bookWidth,
      height: stageH,
      pageWidth,
      marginH,
      marginV,
      paddingTop,
      paddingBottom,
      spread,
    };

    // Pin stage box to the exact integer page/book dimensions so overflow clipping and
    // translateX page strides agree to the pixel.
    rootStyle.setProperty('--stage-width', `${bookWidth}px`);
    rootStyle.setProperty('--stage-height', `${stageH}px`);

    const colWidth = Math.max(80, pageWidth - 2 * marginH);
    const colGap = 2 * marginH;

    const bookLang = this.book?.meta.lang?.trim() || (this.dir === 'rtl' ? 'ar' : 'en');
    document.documentElement.setAttribute('dir', this.dir);
    document.documentElement.setAttribute('lang', bookLang);
    // Preset dark themes tone images down so a white illustration does not glare on a dark page
    // (`styles.css` targets `data-theme='burnt-paper'`). A custom page must NOT borrow that rule:
    // its background can be any colour, and a live CSS `filter` on every image would dim artwork on
    // a page the reader deliberately chose. Custom colours get their own theme key instead, and
    // `data-custom-colors` still tells tests/app code that a pair is painting.
    document.documentElement.setAttribute(
      'data-theme',
      customTokens ? 'custom' : this.settings.theme,
    );
    document.documentElement.setAttribute('data-custom-colors', customTokens ? 'true' : 'false');
    this.rootEl.setAttribute('dir', this.dir);
    this.rootEl.classList.toggle('spread-mode', spread);
    // F22: the root class drives the whole scroll layout in CSS, so it has to follow the
    // setting even before `setBook` renders anything.
    const scrollMode = this.isScrollMode();
    this.rootEl.classList.toggle('scroll-mode', scrollMode);
    this.rootEl.classList.toggle(
      'scroll-progress-hidden',
      scrollMode && this.settings.showScrollProgressBar === false,
    );

    rootStyle.setProperty('--bg-color', theme.bg);
    rootStyle.setProperty('--text-color', theme.text);
    rootStyle.setProperty('--heading-color', theme.heading ?? theme.text);
    rootStyle.setProperty('--subheading-color', theme.heading ?? theme.accent);
    rootStyle.setProperty('--muted-color', theme.muted);
    rootStyle.setProperty('--quote-bg', theme.quoteBg);
    rootStyle.setProperty('--quote-border', theme.quoteBorder);
    rootStyle.setProperty('--accent-color', theme.accent);
    rootStyle.setProperty('--popover-bg', theme.popoverBg);
    rootStyle.setProperty('--popover-border', theme.popoverBorder);

    // Highlight fills follow the *accepted* pair's paper luminance: a light custom page keeps the
    // light fills even if the preset behind it is dark, and vice versa.
    const isDarkTheme = customTokens
      ? isDarkHexColor(customTokens.bg)
      : this.settings.theme === 'burnt-paper' || this.settings.theme === 'oled-crimson';
    for (const meta of HIGHLIGHT_COLORS) {
      rootStyle.setProperty(`--hl-${meta.id}`, isDarkTheme ? meta.fillDark : meta.fillLight);
    }

    // Design tokens (Warraq tablet / open-book spread) exposed as CSS variables.
    rootStyle.setProperty('--spread-gutter', `${SPREAD_GUTTER_PX}px`);
    rootStyle.setProperty('--spread-measure-ch', String(Math.min(54, maxCh)));
    rootStyle.setProperty('--spine-crease', spine.crease);
    rootStyle.setProperty('--spine-inner', spine.inner);
    rootStyle.setProperty('--spine-mid', spine.mid);
    rootStyle.setProperty('--spine-sheen', spine.sheen);
    rootStyle.setProperty('--page-edge', spine.pageEdge);

    rootStyle.setProperty('--font-family', resolveFontStack(this.settings.fontFamily));
    rootStyle.setProperty('--font-size', `${fontSize}px`);
    rootStyle.setProperty('--line-height', String(rawLineHeight));
    rootStyle.setProperty('--word-spacing', `${this.settings.wordSpacing}px`);
    rootStyle.setProperty('--font-weight', String(fontWeight));
    rootStyle.setProperty('--text-align', this.settings.textAlign);

    if (this.settings.indentMode === 'block') {
      rootStyle.setProperty('--text-indent', '0');
      rootStyle.setProperty('--paragraph-spacing', `${Math.max(10, this.settings.paragraphSpacing)}px`);
    } else {
      rootStyle.setProperty('--text-indent', '1.5em');
      rootStyle.setProperty('--paragraph-spacing', `${this.settings.paragraphSpacing}px`);
    }

    rootStyle.setProperty('--page-width', `${pageWidth}px`);
    rootStyle.setProperty('--page-height', `${stageH}px`);
    rootStyle.setProperty('--book-width', `${this.metrics.width}px`);
    rootStyle.setProperty('--col-width', `${colWidth}px`);
    rootStyle.setProperty('--col-gap', `${colGap}px`);
    rootStyle.setProperty('--margin-h', `${marginH}px`);
    rootStyle.setProperty('--margin-v', `${marginV}px`);
    rootStyle.setProperty('--padding-top', `${paddingTop}px`);
    rootStyle.setProperty('--padding-bottom', `${paddingBottom}px`);
    rootStyle.setProperty(
      '--page-transition',
      this.settings.disableAnimation ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
    );
  }

  private hasUnmountedAdjacentChapters(): boolean {
    if (!this.book) return false;
    const total = this.book.chapters.length;
    for (const offset of [-1, 1]) {
      const idx = this.currentChapterIdx + offset;
      if (idx >= 0 && idx < total) {
        const entry = this.rendered.get(idx);
        if (!entry || !entry.isComplete) return true;
      }
    }
    return false;
  }

  /**
   * Keep virtualized window [curr - 1, curr, curr + 1] and ensure `curr` is mounted
   * synchronously up to `minBlockIdx`; adjacent chapters are left to idle scheduling.
   */
  private syncActiveAndEvict(minBlockIdx: number): void {
    this.cancelIdleWork();
    this.layoutGeneration++;
    if (!this.book) return;

    const total = this.book.chapters.length;
    const keep = new Set<number>();
    for (const offset of [-1, 0, 1]) {
      const idx = this.currentChapterIdx + offset;
      if (idx >= 0 && idx < total) keep.add(idx);
    }

    for (const [idx, entry] of this.rendered.entries()) {
      if (!keep.has(idx)) {
        entry.el.remove();
        this.rendered.delete(idx);
      }
    }

    const currChapter = this.book.chapters[this.currentChapterIdx];
    if (currChapter) {
      let entry = this.rendered.get(this.currentChapterIdx);
      if (!entry) {
        entry = this.mountChapterInitial(this.currentChapterIdx, currChapter, minBlockIdx);
        this.rendered.set(this.currentChapterIdx, entry);
      } else if (minBlockIdx >= entry.mountedBlockCount && !entry.isComplete) {
        this.mountThroughBlockIndex(entry, minBlockIdx);
      }
      if (entry.isComplete) {
        this.pageCache.set(this.cacheKey(currChapter), entry.pageCount);
      }
    }

    this.layoutVirtualizedChapterOffsets();
  }

  private mountChapterInitial(index: number, chapter: Chapter, anchorBlockIdx: number): RenderedChapter {
    const el = document.createElement('article');
    el.className = 'chapter';
    el.setAttribute('data-chapter-id', chapter.id);
    el.setAttribute('dir', this.dir);
    el.setAttribute('aria-hidden', 'true');

    // Determine initial block slice: up to anchorBlockIdx, plus INITIAL_WORD_BUDGET words after it
    let count = 0;
    let wordsMounted = 0;
    let wordsAfterAnchor = 0;
    const totalBlocks = chapter.blocks.length;

    for (let i = 0; i < totalBlocks; i++) {
      const w = approxBlockWords(chapter.blocks[i]!);
      wordsMounted += w;
      count = i + 1;
      if (i >= anchorBlockIdx) {
        wordsAfterAnchor += w;
        if (wordsAfterAnchor >= INITIAL_WORD_BUDGET) {
          break;
        }
      }
    }

    el.innerHTML = this.chapterInnerHtml(chapter, count);
    // F18: hide the diacritics the reader chose to hide *before* this chapter is measured,
    // so the page count belongs to the text that is actually on screen.
    applyTashkeelToElement(el, this.settings.tashkeel);
    this.trackEl.appendChild(el);

    const blockEls: HTMLElement[] = [];
    const blockById = new Map<string, HTMLElement>();
    let child = el.firstElementChild as HTMLElement | null;
    while (child) {
      const id = child.getAttribute('data-block-id');
      if (id) {
        blockEls.push(child);
        blockById.set(id, child);
      }
      child = child.nextElementSibling as HTMLElement | null;
    }

    // No draft measurement here: `applyChapterMeasurements` below reads the real
    // (pad-aware) page counts in a single pass, which is what `ready` is timed on.
    const isComplete = count >= totalBlocks;

    const entry: RenderedChapter = {
      index,
      chapter,
      el,
      pageCount: 1,
      layoutPageCount: 1,
      padPageCount: 0,
      mountedBlockCount: count,
      mountedWordCount: wordsMounted,
      isComplete,
      blockEls,
      blockById,
    };
    // F46: mount the frames before the first measurement, so `ready` is reported for the
    // layout that includes them.
    this.syncSceneFigures(entry);
    this.applyChapterMeasurements(entry);
    return entry;
  }

  private appendNextBatch(entry: RenderedChapter, wordBudget: number): void {
    const blocks = entry.chapter.blocks;
    const startIdx = entry.mountedBlockCount;
    if (startIdx >= blocks.length) {
      entry.isComplete = true;
      return;
    }

    let endIdx = startIdx;
    let batchWords = 0;
    while (endIdx < blocks.length) {
      const w = approxBlockWords(blocks[endIdx]!);
      batchWords += w;
      endIdx++;
      if (batchWords >= wordBudget) break;
    }

    const batchHtml = blocks.slice(startIdx, endIdx).map(renderBlockHtml).join('');
    const prevLast = entry.el.lastElementChild;
    entry.el.insertAdjacentHTML('beforeend', batchHtml);

    let cursor = prevLast ? (prevLast.nextElementSibling as HTMLElement | null) : (entry.el.firstElementChild as HTMLElement | null);
    while (cursor) {
      const id = cursor.getAttribute('data-block-id');
      if (id) {
        entry.blockEls.push(cursor);
        entry.blockById.set(id, cursor);
        // F18: only the freshly appended blocks — the rest of the chapter is already in
        // the reader's chosen tashkeel mode.
        applyTashkeelToElement(cursor, this.settings.tashkeel);
      }
      cursor = cursor.nextElementSibling as HTMLElement | null;
    }

    entry.mountedBlockCount = endIdx;
    entry.mountedWordCount += batchWords;
    entry.isComplete = endIdx >= blocks.length;
    // F46: the batch may have mounted a new scene anchor.
    this.syncSceneFigures(entry);
    this.remeasureChapter(entry);
  }

  private mountThroughBlockIndex(entry: RenderedChapter, targetBlockIdx: number): void {
    const blocks = entry.chapter.blocks;
    if (entry.mountedBlockCount > targetBlockIdx || entry.isComplete) return;

    const endIdx = Math.min(blocks.length, targetBlockIdx + 20);
    let addedWords = 0;
    for (let i = entry.mountedBlockCount; i < endIdx; i++) {
      addedWords += approxBlockWords(blocks[i]!);
    }

    const batchHtml = blocks.slice(entry.mountedBlockCount, endIdx).map(renderBlockHtml).join('');
    const prevLast = entry.el.lastElementChild;
    entry.el.insertAdjacentHTML('beforeend', batchHtml);

    let cursor = prevLast ? (prevLast.nextElementSibling as HTMLElement | null) : (entry.el.firstElementChild as HTMLElement | null);
    while (cursor) {
      const id = cursor.getAttribute('data-block-id');
      if (id) {
        entry.blockEls.push(cursor);
        entry.blockById.set(id, cursor);
        // F18: only the freshly appended blocks — the rest of the chapter is already in
        // the reader's chosen tashkeel mode.
        applyTashkeelToElement(cursor, this.settings.tashkeel);
      }
      cursor = cursor.nextElementSibling as HTMLElement | null;
    }

    entry.mountedBlockCount = endIdx;
    entry.mountedWordCount += addedWords;
    entry.isComplete = endIdx >= blocks.length;
    // F46: the batch may have mounted a new scene anchor.
    this.syncSceneFigures(entry);
    this.remeasureChapter(entry);
  }

  private remeasureChapter(entry: RenderedChapter): void {
    this.applyChapterMeasurements(entry);
    // F22: a scroll-mode chapter is laid out in flow, so measuring it here would report one
    // page and poison the column cache the paginated mode shares.
    if (entry.isComplete && !this.isScrollMode()) {
      this.pageCache.set(this.cacheKey(entry.chapter), entry.pageCount);
    }
  }

  /**
   * Split a chapter's measured pages into real content pages and blank pad pages.
   *
   * In spread mode a chapter that would end on a recto in RTL (odd page count) gets
   * one blank page so the *next* chapter also opens on the right-hand page. That pad
   * is pure layout: it is counted here for track geometry but never for `pageCount`,
   * `page`, TOC `startPage` or progress — those stay on real pages.
   */
  private measureChapterPages(entry: RenderedChapter): { pages: number; padPages: number } {
    const existingPad = entry.el.querySelector<HTMLElement>(`.${CHAPTER_PAD_CLASS}`);
    if (existingPad) existingPad.remove();

    // Issue #47/#58 (QA r1): see `syncOrphanSceneBreaks`. The mounted chapter is measured from
    // its real paint, so this is the pass that decides what the reader can actually turn to.
    syncOrphanSceneBreaks(entry.el);
    const pages = this.measureChapterScrollPages(entry.el);
    if (!this.metrics.spread || !entry.isComplete || pages % 2 === 0) {
      return { pages, padPages: 0 };
    }

    const pad = document.createElement('div');
    pad.className = CHAPTER_PAD_CLASS;
    pad.setAttribute('aria-hidden', 'true');
    entry.el.appendChild(pad);

    const padded = this.measureChapterScrollPages(entry.el);
    if (padded > pages) {
      return { pages, padPages: padded - pages };
    }
    pad.remove();
    return { pages, padPages: 0 };
  }

  private applyChapterMeasurements(entry: RenderedChapter): void {
    if (this.isScrollMode()) {
      // Columns are off in scroll mode, so the chapter's own width says nothing about how
      // many pages it would take. Reuse the shared column cache, else the same frozen
      // density estimate the page map uses. Never write back (see `remeasureChapter`).
      const cached = this.pageCache.get(this.cacheKey(entry.chapter));
      const estimate = Math.max(1, Math.ceil(entry.chapter.wordCount / 220));
      entry.pageCount = cached !== undefined && cached > 0 ? cached : estimate;
      entry.padPageCount = 0;
      entry.layoutPageCount = entry.pageCount;
      return;
    }
    const { pages, padPages } = this.measureChapterPages(entry);
    entry.pageCount = pages;
    entry.padPageCount = padPages;
    entry.layoutPageCount = pages + padPages;
  }

  /**
   * Single O(1) measurement using scrollWidth / pageWidth (no line-box loops).
   */
  private measureChapterScrollPages(el: HTMLElement): number {
    const pageW = this.metrics.pageWidth;
    if (pageW <= 0) return 1;
    const sw = el.scrollWidth;
    return sw <= pageW ? 1 : Math.max(1, Math.ceil(sw / pageW));
  }

  private layoutVirtualizedChapterOffsets(): void {
    if (this.isScrollMode()) {
      this.layoutScrollChaptersAria();
      return;
    }
    const pageW = Math.round(this.metrics.pageWidth);
    const curr = this.rendered.get(this.currentChapterIdx);
    const prev = this.rendered.get(this.currentChapterIdx - 1);
    const next = this.rendered.get(this.currentChapterIdx + 1);

    if (curr) {
      curr.el.style.transform = 'translate3d(0px, 0, 0)';
      curr.el.setAttribute('aria-hidden', 'false');
    }

    if (prev) {
      const rawOffset = this.dir === 'rtl' ? prev.layoutPageCount * pageW : -(prev.layoutPageCount * pageW);
      const offsetPx = Math.round(rawOffset) || 0;
      prev.el.style.transform = `translate3d(${offsetPx}px, 0, 0)`;
      prev.el.setAttribute('aria-hidden', 'true');
    }

    if (next && curr) {
      const rawOffset = this.dir === 'rtl' ? -(curr.layoutPageCount * pageW) : curr.layoutPageCount * pageW;
      const offsetPx = Math.round(rawOffset) || 0;
      next.el.style.transform = `translate3d(${offsetPx}px, 0, 0)`;
      next.el.setAttribute('aria-hidden', 'true');
    }
  }

  private applyTrackTransform(animate: boolean): void {
    // F22: in scroll mode the page track is never translated — the chapter stack scrolls
    // natively, so the track keeps no transform and no transition (P1 #57's transition
    // timer is cleared too, otherwise a late settle timer could re-arm it).
    if (this.isScrollMode()) {
      this.clearTrackTransition();
      this.trackEl.style.transform = 'none';
      return;
    }
    const shouldAnimate = animate && !this.settings.disableAnimation;
    if (shouldAnimate) {
      this.enableTrackTransition();
    } else {
      this.clearTrackTransition();
    }

    if (this.stageEl.scrollLeft !== 0) {
      this.stageEl.scrollLeft = 0;
    }

    const pageW = Math.round(this.metrics.pageWidth);
    const rawOffset =
      this.dir === 'rtl'
        ? this.currentChapterPage * pageW
        : -(this.currentChapterPage * pageW);
    const offsetPx = Math.round(rawOffset) || 0;

    this.trackEl.style.transform = `translate3d(${offsetPx}px, 0, 0)`;

    if (!shouldAnimate) {
      // Force synchronous style/layout flush while transition is 'none' so cold-open /
      // reflow snaps commit immediately and can never animate from an earlier offset.
      void this.trackEl.offsetWidth;
    }
  }

  /**
   * Everything that changes how text reflows, minus the chapter identity. Two layouts
   * with the same signature produce the same page counts, so it keys both the per-chapter
   * measurement cache and the pinned page map.
   */
  private layoutSignature(): string {
    const s = this.settings;
    return [
      this.metrics.width,
      this.metrics.pageWidth,
      this.metrics.height,
      this.metrics.marginH,
      this.metrics.marginV,
      this.metrics.spread ? 'spread' : 'single',
      // HUD insets (#13) shrink the page box, so they change page counts too.
      this.metrics.paddingTop,
      this.metrics.paddingBottom,
      this.dir,
      s.fontFamily,
      s.fontSize,
      s.lineHeight,
      s.wordSpacing,
      s.paragraphSpacing,
      s.textAlign,
      s.indentMode,
      s.fontWeight,
      // F18: the displayed text — and the display↔original offset map — depend on the mode,
      // so a measurement taken in one mode must never be reused in another. (For Arabic
      // combining marks the page counts happen to agree, because the marks add no advance
      // width; `test/tashkeel.spec.ts` measures that instead of assuming it.)
      s.tashkeel,
      // F46: a scene frame is real content in the column flow, so which frames exist
      // (and whether they are collapsed) changes page counts. Status does not — that is
      // the whole zero-layout-shift contract.
      this.sceneSignature(),
    ].join('|');
  }

  private cacheKey(chapter: Chapter): string {
    return [chapter.id, chapter.hash, this.layoutSignature()].join('|');
  }

  private invalidatePageMap(): void {
    this.pageMap = null;
  }

  /**
   * Words per *full* page, frozen per layout. Prefers complete chapters (their word
   * count is the book's own number, not an approximation of the mounted DOM), then the
   * exact cache, and only falls back to a partially-mounted slice as a last resort.
   *
   * Every measured chapter ends on a partly filled page, so its `words / pages` ratio
   * understates the density by up to one page per chapter. Dividing by `pages` raw makes
   * a big chapter look like `ceil(2 × pages)` of a small one — a 60-paragraph chapter
   * that really needs 14 pages is estimated at 28 for its 120-paragraph twin that really
   * needs 27. Subtracting the expected ragged fill per sample keeps the estimate
   * scale-invariant, so the pinned total matches the truth once chapters are measured.
   */
  private measuredDensity(): number {
    const densityOf = (words: number, pages: number, samples: number): number => {
      if (words <= 0 || pages <= 0) return 0;
      const fullPages = pages - RAGGED_END_PAGE_FRACTION * Math.max(1, samples);
      return words / Math.max(0.5, fullPages);
    };

    let words = 0;
    let pages = 0;
    let samples = 0;
    for (const entry of this.rendered.values()) {
      if (entry.isComplete && entry.pageCount > 0 && entry.chapter.wordCount > 0) {
        words += entry.chapter.wordCount;
        pages += entry.pageCount;
        samples++;
      }
    }
    if (samples > 0) return densityOf(words, pages, samples);

    words = 0;
    pages = 0;
    samples = 0;
    if (this.book) {
      for (const ch of this.book.chapters) {
        const cached = this.pageCache.get(this.cacheKey(ch));
        if (cached !== undefined && cached > 0 && ch.wordCount > 0) {
          words += ch.wordCount;
          pages += cached;
          samples++;
        }
      }
    }
    if (samples > 0) return densityOf(words, pages, samples);

    words = 0;
    pages = 0;
    samples = 0;
    for (const entry of this.rendered.values()) {
      if (entry.pageCount > 0 && entry.mountedWordCount > 0) {
        words += entry.mountedWordCount;
        pages += entry.pageCount;
        samples++;
      }
    }
    return samples > 0 ? densityOf(words, pages, samples) : 220;
  }

  /**
   * Recompute the page map for the current layout.
   *
   * - Measured chapters contribute their exact real page count.
   * - Unmeasured chapters are estimated from the frozen density, floored by however
   *   many pages they already occupy in the DOM, so the reader can never turn past the
   *   end of the chapter its own numbers describe.
   * - The total is pinned for the layout: pages that a freshly measured chapter gains
   *   are taken from (or given back to) the still-unmeasured chapters, so turning
   *   pages or opening a sheet never changes the total on its own.
   * - Once every chapter is measured the map becomes exact and `estimated` clears.
   */
  private refreshPageMap(): PageMap {
    const book = this.book!;
    const signature = this.layoutSignature();
    const previous = this.pageMap?.signature === signature ? this.pageMap : null;
    const density = previous?.density ?? this.measuredDensity();

    const counts: number[] = [];
    const exact: boolean[] = [];
    const floors: number[] = [];
    let allExact = true;

    for (let idx = 0; idx < book.chapters.length; idx++) {
      const chapter = book.chapters[idx]!;
      const cached = this.pageCache.get(this.cacheKey(chapter));
      if (cached !== undefined && cached > 0) {
        counts.push(cached);
        exact.push(true);
        floors.push(cached);
        continue;
      }

      allExact = false;
      const rendered = this.rendered.get(idx);
      const estimate = Math.max(1, Math.ceil(chapter.wordCount / Math.max(1, density)));
      const floor = Math.max(1, rendered?.pageCount ?? 1);
      counts.push(Math.max(floor, estimate));
      exact.push(false);
      floors.push(floor);
    }

    let map: PageMap;
    if (allExact) {
      const total = counts.reduce((sum, c) => sum + c, 0);
      map = { signature, counts, exact, total, estimated: false, density };
    } else {
      // First build for this layout pins the current best total; later measurements
      // only redistribute pages inside it.
      const pinned = previous ? previous.total : counts.reduce((sum, c) => sum + c, 0);
      this.rebalanceToTotal(counts, exact, floors, pinned);
      const total = counts.reduce((sum, c) => sum + c, 0);
      map = { signature, counts, exact, total, estimated: true, density };
    }

    this.pageMap = map;
    return map;
  }

  /**
   * Move the page total back onto `target` by adding pages to (or taking them from)
   * the chapters whose counts are still estimates. Measured chapters are never touched.
   */
  private rebalanceToTotal(
    counts: number[],
    exact: boolean[],
    floors: number[],
    target: number,
  ): void {
    let sum = counts.reduce((acc, c) => acc + c, 0);
    let delta = target - sum;
    let guard = 0;

    while (delta !== 0 && guard < 20_000) {
      guard++;
      let moved = false;
      for (let idx = 0; idx < counts.length && delta !== 0; idx++) {
        if (exact[idx]) continue;
        const count = counts[idx]!;
        if (delta > 0) {
          counts[idx] = count + 1;
          delta -= 1;
          moved = true;
        } else if (count > (floors[idx] ?? 1)) {
          counts[idx] = count - 1;
          delta += 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  // ---------------------------------------------------------------------------
  // F22 — continuous scroll mode
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the track as one vertical stack of chapter slots, mount the chapter the
   * reader is on (plus its neighbours) and put the reading line back on `anchor`.
   *
   * Every chapter keeps its slot in DOM order even while unmounted, so the scrollbar
   * spans the whole book and a jump to chapter 30 does not need chapters 1..29 mounted.
   */
  private enterScrollLayout(anchor: Anchor | null): void {
    const book = this.book;
    if (!book) return;
    this.cancelIdleWork();
    this.clearRenderedDom();
    this.clearScrollSlots();
    this.trackEl.style.transform = 'none';
    this.trackEl.style.transition = 'none';
    this.trackEl.style.paddingBottom = '';
    this.scrollRestoredTop = null;
    this.stageEl.scrollTop = 0;

    const startIdx = anchor ? this.chapterIndexForAnchor(anchor) : this.currentChapterIdx;
    this.currentChapterIdx = Math.max(0, Math.min(book.chapters.length - 1, startIdx));
    this.currentChapterPage = 0;

    for (let i = 0; i < book.chapters.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'scroll-chapter-slot';
      slot.setAttribute('data-scroll-index', String(i));
      slot.setAttribute('data-chapter-id', book.chapters[i]!.id);
      this.trackEl.appendChild(slot);
      this.scrollSlots.push(slot);
    }
    this.invalidateScrollSlots();
    this.updateScrollSpacers();

    if (anchor) {
      this.rememberRestoredAnchor(anchor);
      this.positionScrollAtAnchor(anchor);
    } else {
      this.mountScrollWindow(this.currentChapterIdx, false);
      this.stageEl.scrollTop = 0;
      this.clearRestoredAnchor();
    }
    this.updateScrollProgressFill();
  }

  /** Put the paginated track back together around `anchor` (the current reading line). */
  private leaveScrollLayout(anchor: Anchor | null): void {
    this.cancelIdleWork();
    this.clearRenderedDom();
    this.clearScrollSlots();
    this.trackEl.style.paddingBottom = '';
    this.scrollRestoredTop = null;
    this.stageEl.scrollTop = 0;
    const book = this.book;
    if (!book) return;

    const rawIdx = anchor ? this.chapterIndexForAnchor(anchor) : this.currentChapterIdx;
    const idx = Math.max(0, Math.min(book.chapters.length - 1, rawIdx));
    this.currentChapterIdx = idx;
    const chapter = book.chapters[idx]!;
    const blockIdx = anchor
      ? Math.max(0, chapter.blocks.findIndex((b) => b.id === anchor.blockId))
      : 0;

    const entry = this.mountChapterInitial(idx, chapter, blockIdx);
    this.rendered.set(idx, entry);
    if (entry.isComplete) {
      this.pageCache.set(this.cacheKey(chapter), entry.pageCount);
    }
    while (!entry.isComplete && blockIdx >= entry.mountedBlockCount) {
      this.appendNextBatch(entry, BATCH_WORD_BUDGET);
    }

    if (anchor) {
      this.currentChapterPage = this.alignToSpread(
        this.resolveAnchorPageInCurrentChapter(anchor),
      );
      this.rememberRestoredAnchor(anchor);
    } else {
      this.currentChapterPage = 0;
      this.clearRestoredAnchor();
    }

    this.layoutVirtualizedChapterOffsets();
    this.applyTrackTransform(false);
    this.renderHighlights();
    this.updateScrollProgressFill();
    this.scheduleBackgroundWork();
  }

  /** A typography/margin change while staying in scroll mode: re-anchor, never re-column. */
  private reflowScrollLayout(anchor: Anchor | null): void {
    for (const entry of this.rendered.values()) {
      this.syncSceneFigures(entry);
      this.applyChapterMeasurements(entry);
    }
    this.layoutScrollChaptersAria();
    this.invalidateScrollSlots();
    this.updateScrollSpacers();
    if (anchor) {
      this.rememberRestoredAnchor(anchor);
      this.positionScrollAtAnchor(anchor);
    } else {
      this.mountScrollWindow(this.scrollVisibleIndex(), false);
    }
    this.updateScrollProgressFill();
  }

  private clearScrollSlots(): void {
    for (const slot of this.scrollSlots) slot.remove();
    this.scrollSlots = [];
    this.scrollSlotCache = null;
  }

  private layoutScrollChaptersAria(): void {
    for (const entry of this.rendered.values()) {
      entry.el.style.transform = 'none';
      entry.el.setAttribute('dir', this.dir);
      entry.el.setAttribute('aria-hidden', 'false');
    }
  }

  private chapterIndexForAnchor(anchor: Anchor): number {
    const book = this.book;
    if (!book) return 0;
    for (let i = 0; i < book.chapters.length; i++) {
      if (book.chapters[i]!.blocks.some((b) => b.id === anchor.blockId)) return i;
    }
    return Math.max(0, Math.min(book.chapters.length - 1, this.currentChapterIdx));
  }

  /** Document-space top of a chapter slot (independent of the current scroll offset). */
  private chapterSlotTop(idx: number): number {
    const slot = this.scrollSlots[idx];
    if (!slot) return 0;
    const rect = slot.getBoundingClientRect();
    const stageRect = this.stageEl.getBoundingClientRect();
    return rect.top - stageRect.top + this.stageEl.scrollTop;
  }

  private chapterSlotHeight(idx: number): number {
    const slot = this.scrollSlots[idx];
    return slot ? slot.getBoundingClientRect().height : 0;
  }

  /** The slot table is a pure function of the current heights: drop it after any change. */
  private invalidateScrollSlots(): void {
    this.scrollSlotCache = null;
  }

  /**
   * Document-space top/height of every slot, measured once and cached.
   *
   * The slots are siblings in normal flow, so one measurement per slot plus a running sum
   * is the whole geometry of the book — that is what makes "which chapter is on the line?"
   * answerable synchronously, before (and without) mounting anything.
   */
  private scrollSlotGeometry(): { tops: number[]; heights: number[] } {
    if (this.scrollSlotCache) return this.scrollSlotCache;
    const tops: number[] = [];
    const heights: number[] = [];
    const stageRect = this.stageEl.getBoundingClientRect();
    const scrollTop = this.stageEl.scrollTop;
    let top = 0;
    for (let i = 0; i < this.scrollSlots.length; i++) {
      const rect = this.scrollSlots[i]!.getBoundingClientRect();
      if (i === 0) top = rect.top - stageRect.top + scrollTop;
      tops.push(top);
      heights.push(rect.height);
      top += rect.height;
    }
    this.scrollSlotCache = { tops, heights };
    return this.scrollSlotCache;
  }

  /**
   * The chapter whose slot holds the reading line.
   *
   * Slot geometry — not the mounted set — is authoritative: a chapter that has never been
   * mounted still has a slot with a reserved height, so a jump straight into the middle of
   * a long book resolves to the right chapter immediately instead of guessing from whatever
   * happens to be in the DOM.
   */
  private scrollVisibleIndex(): number {
    const book = this.book;
    if (!book || this.scrollSlots.length === 0) return this.currentChapterIdx;
    const last = book.chapters.length - 1;
    const stage = this.stageEl;
    const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight);
    // At the very end the browser has clamped `scrollTop`, so the line cannot move any
    // further: the final chapter owns it even if a pixel of rounding says otherwise.
    if (maxScroll > 0 && stage.scrollTop >= maxScroll - 1) return last;

    const { tops } = this.scrollSlotGeometry();
    if (tops.length === 0) return this.currentChapterIdx;
    const lineY = stage.scrollTop + this.metrics.paddingTop;
    let lo = 0;
    let hi = tops.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid]! <= lineY + 0.5) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return Math.max(0, Math.min(last, found));
  }

  /**
   * Move the scroll offset programmatically.
   *
   * While a restored anchor is live the reader is standing exactly where we put them, so
   * every programmatic move (including the compensation a neighbour mount needs) updates
   * the restore point — otherwise the settle handler would read our own scroll as a user
   * scroll and drop the character offset the host persisted.
   */
  private setScrollTop(value: number): void {
    this.stageEl.scrollTop = Math.max(0, Math.round(value));
    if (this.restoredAnchor) this.scrollRestoredTop = this.stageEl.scrollTop;
  }

  /** Mount `[center - 1, center, center + 1]` and evict everything outside the keep window. */
  private mountScrollWindow(center: number, compensate: boolean): void {
    const book = this.book;
    if (!book) return;
    for (let offset = -SCROLL_WINDOW_RADIUS; offset <= SCROLL_WINDOW_RADIUS; offset++) {
      const idx = center + offset;
      if (idx < 0 || idx >= book.chapters.length) continue;
      this.mountScrollChapter(idx, compensate);
    }
    let evicted = false;
    for (const idx of Array.from(this.rendered.keys())) {
      if (Math.abs(idx - center) <= SCROLL_KEEP_RADIUS) continue;
      this.evictScrollChapter(idx);
      evicted = true;
    }
    if (evicted) this.updateScrollSpacers();
  }

  /**
   * Drop a chapter's DOM but keep the exact space it occupied.
   *
   * The measured height is frozen onto the slot *before* the article is removed, so the
   * scroll track is byte-for-byte the same height afterwards and `scrollTop` never jumps.
   */
  private evictScrollChapter(idx: number): void {
    const entry = this.rendered.get(idx);
    if (!entry) return;
    const slot = this.scrollSlots[idx];
    if (slot) {
      const height = slot.getBoundingClientRect().height;
      entry.el.remove();
      slot.style.minHeight = '';
      slot.style.height = `${height}px`;
      slot.dataset.scrollFrozen = '1';
    } else {
      entry.el.remove();
    }
    this.rendered.delete(idx);
    this.invalidateScrollSlots();
  }

  /** Mount one whole chapter into its slot (idempotent). */
  private mountScrollChapter(idx: number, compensate: boolean): void {
    const book = this.book;
    if (!book) return;
    if (idx < 0 || idx >= book.chapters.length) return;
    if (this.rendered.has(idx)) return;
    const slot = this.scrollSlots[idx];
    if (!slot) return;

    const chapter = book.chapters[idx]!;
    const stageRect = this.stageEl.getBoundingClientRect();
    const lineY = stageRect.top + this.metrics.paddingTop;
    const beforeRect = slot.getBoundingClientRect();
    const beforeHeight = beforeRect.height;
    const beforeBottom = beforeRect.bottom;

    const el = document.createElement('article');
    el.className = 'chapter';
    el.setAttribute('data-chapter-id', chapter.id);
    el.setAttribute('dir', this.dir);
    el.setAttribute('aria-hidden', 'false');
    el.innerHTML = this.chapterInnerHtml(chapter);
    // F18: hide diacritics before the (flow) layout is read.
    applyTashkeelToElement(el, this.settings.tashkeel);
    // The frozen height described the chapter that was here before; the live one sizes itself.
    slot.style.minHeight = '';
    slot.style.height = '';
    delete slot.dataset.scrollFrozen;
    slot.appendChild(el);

    const blockEls: HTMLElement[] = [];
    const blockById = new Map<string, HTMLElement>();
    let child = el.firstElementChild as HTMLElement | null;
    while (child) {
      const id = child.getAttribute('data-block-id');
      if (id) {
        blockEls.push(child);
        blockById.set(id, child);
      }
      child = child.nextElementSibling as HTMLElement | null;
    }

    const entry: RenderedChapter = {
      index: idx,
      chapter,
      el,
      pageCount: 1,
      layoutPageCount: 1,
      padPageCount: 0,
      mountedBlockCount: chapter.blocks.length,
      mountedWordCount: chapter.wordCount,
      isComplete: true,
      blockEls,
      blockById,
    };
    // F46: scene frames occupy flow height, so they must be in the DOM *before* the slot's
    // height is read — otherwise the reserved height is short by the frame's height.
    this.syncSceneFigures(entry);
    this.applyChapterMeasurements(entry);
    this.rendered.set(idx, entry);
    this.invalidateScrollSlots();

    // Filling a reserved slot changes the height of everything below it. When the slot sat
    // *above* the reading line, shift by the same delta so the line stays on the same text.
    // A slot that contains the line needs no compensation: its content starts at its own top,
    // so growing its bottom edge moves nothing under the line.
    if (compensate && beforeBottom <= lineY + 0.5) {
      const delta = slot.getBoundingClientRect().height - beforeHeight;
      if (delta !== 0) this.setScrollTop(this.stageEl.scrollTop + delta);
    }
  }

  private ensureScrollChapterMounted(idx: number): void {
    if (!this.book) return;
    if (idx < 0 || idx >= this.book.chapters.length) return;
    if (this.rendered.has(idx)) return;
    this.mountScrollChapter(idx, true);
  }

  /**
   * Reserve an honest height for every chapter that is not mounted.
   *
   * Without this an unmounted chapter is zero pixels tall, so the scroll track would end at
   * the last mounted chapter and the reader could never scroll (or jump) past it. A frozen
   * slot keeps the height it was measured at; a mounted one sizes itself.
   */
  private updateScrollSpacers(): void {
    const book = this.book;
    if (!book) return;
    for (let i = 0; i < this.scrollSlots.length; i++) {
      const slot = this.scrollSlots[i]!;
      if (this.rendered.has(i) || slot.dataset.scrollFrozen === '1') continue;
      slot.style.height = '';
      slot.style.minHeight = `${this.scrollSlotEstimate(i)}px`;
    }
    this.invalidateScrollSlots();
    this.updateScrollTailPadding();
  }

  /** Reserved height (px) for a chapter nobody has measured in this layout yet. */
  private scrollSlotEstimate(idx: number): number {
    const chapter = this.book?.chapters[idx];
    const stageH = Math.max(200, Math.round(this.metrics.height));
    if (!chapter) return stageH;
    const cached = this.pageCache.get(this.cacheKey(chapter));
    const density = Math.max(1, this.measuredDensity());
    const pages =
      cached !== undefined && cached > 0
        ? cached
        : Math.max(1, Math.ceil(chapter.wordCount / density));
    // A chapter takes roughly `pages` screens of the continuous column, so that is the
    // honest space to hold for it. A wrong guess is corrected the moment it mounts (with
    // compensation), so it can never move the line the reader is on.
    return Math.max(1, Math.round(pages * stageH));
  }

  /**
   * Reserve the space a *short final chapter* needs to reach the reading line.
   *
   * `scrollTop` is clamped at `scrollHeight - clientHeight`, so on a book whose last chapter
   * is shorter than the viewport the final chapter can never be brought to the line — the
   * previous chapter stays there and `goto({ chapterId: last })` reports the wrong chapter.
   * Padding the bottom of the track by exactly the missing amount fixes it without leaving a
   * blank page on books whose last chapter is already tall enough.
   */
  private updateScrollTailPadding(): void {
    if (!this.isScrollMode()) return;
    const book = this.book;
    if (!book || this.scrollSlots.length === 0) return;
    const lastSlot = this.scrollSlots[book.chapters.length - 1];
    if (!lastSlot) return;
    const base = Math.max(0, Math.round(this.metrics.paddingBottom));
    const missing =
      this.stageEl.clientHeight - this.metrics.paddingTop - lastSlot.offsetHeight;
    const tail = missing > 0 ? Math.ceil(missing) : base;
    if (this.trackEl.style.paddingBottom === `${tail}px`) return;
    this.trackEl.style.paddingBottom = `${tail}px`;
    this.invalidateScrollSlots();
  }

  /**
   * Idle work while scrolling.
   *
   * The active window is mounted synchronously (scroll frame, settle, `goto`), so this must
   * NOT walk the whole book: an idle mount loop with no eviction grows the DOM without bound
   * and fights the reader's scroll. It only keeps the reserved track and the chrome honest.
   */
  private scheduleScrollMountWork(): void {
    this.cancelIdleWork();
    const book = this.book;
    if (!book || !this.isScrollMode()) return;
    const generation = this.layoutGeneration;

    const run = () => {
      this.idleHandle = null;
      if (generation !== this.layoutGeneration || !this.isScrollMode() || !this.book) return;
      this.updateScrollTailPadding();
      this.updateScrollProgressFill();
      this.callbacks.onBackgroundProgress?.();
    };

    const win = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof win.requestIdleCallback === 'function') {
      this.idleHandle = { kind: 'idle', id: win.requestIdleCallback(run, { timeout: 60 }) };
    } else {
      this.idleHandle = { kind: 'timeout', id: window.setTimeout(run, 0) };
    }
  }

  /** Scroll mode: 0..1 position of the reading line inside the current chapter. */
  private getScrollChapterProgress(): number {
    if (!this.book) return 0;
    const top = this.chapterSlotTop(this.currentChapterIdx);
    const height = this.chapterSlotHeight(this.currentChapterIdx);
    if (height <= 0) return 0;
    const progress = (this.stageEl.scrollTop + this.metrics.paddingTop - top) / height;
    return Math.max(0, Math.min(1, progress));
  }

  /**
   * Re-read the reading line from the track: which chapter owns it, then mount its window.
   *
   * This is the only place `currentChapterIdx` follows a scroll, and it is deliberately
   * geometry-driven (`scrollSlots`), never limited to the mounted set.
   */
  private syncScrollChapter(): void {
    if (!this.book) return;
    const beforeMax = Math.max(0, this.stageEl.scrollHeight - this.stageEl.clientHeight);
    const pinnedToEnd = beforeMax > 0 && this.stageEl.scrollTop >= beforeMax - SCROLL_RESTORE_TOLERANCE;
    this.invalidateScrollSlots();
    const idx = this.scrollVisibleIndex();
    if (idx !== this.currentChapterIdx) {
      this.currentChapterIdx = idx;
      this.currentChapterPage = 0;
    }
    this.mountScrollWindow(idx, true);
    if (pinnedToEnd) {
      // Mounting the final chapters changed how tall the book really is; stay at the end.
      const afterMax = Math.max(0, this.stageEl.scrollHeight - this.stageEl.clientHeight);
      if (afterMax > beforeMax) this.stageEl.scrollTop = afterMax;
    }
  }

  /** The block (and original-text offset) sitting on the top reading line right now. */
  private captureScrollAnchor(): Anchor {
    const entry = this.rendered.get(this.currentChapterIdx);
    const fallbackId = entry?.chapter.blocks[0]?.id ?? entry?.chapter.id ?? 'ch01_p0001';
    if (!entry || entry.blockEls.length === 0) {
      return { blockId: fallbackId, charOffset: 0 };
    }

    const stageRect = this.stageEl.getBoundingClientRect();
    const lineY = stageRect.top + this.metrics.paddingTop;
    const els = entry.blockEls;

    // First block whose bottom edge reaches past the reading line: the block on screen.
    let lo = 0;
    let hi = els.length - 1;
    let target = els.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rect = els[mid]!.getBoundingClientRect();
      if (rect.bottom > lineY) {
        target = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const blockEl = els[target]!;
    const blockId = blockEl.getAttribute('data-block-id') ?? entry.chapter.id;
    const displayOffset = this.characterOffsetAtY(blockEl, lineY);
    return { blockId, charOffset: this.toOriginalAnchorOffset(blockEl, displayOffset) };
  }

  /** First displayed character whose line bottom sits past `lineY` (0 if above the block). */
  private characterOffsetAtY(blockEl: HTMLElement, lineY: number): number {
    const textLen = blockEl.textContent?.length ?? 0;
    if (textLen === 0) return 0;
    const blockRect = blockEl.getBoundingClientRect();
    if (blockRect.bottom <= lineY) return Math.max(0, textLen - 1);
    if (blockRect.top >= lineY) return 0;

    let lo = 0;
    let hi = textLen - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rect = getCharacterRect(blockEl, mid);
      if (!rect) break;
      if (rect.bottom > lineY) {
        found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return found;
  }

  private positionScrollAtChapter(idx: number): void {
    this.ensureScrollChapterMounted(idx);
    this.currentChapterIdx = idx;
    this.currentChapterPage = 0;
    // The tail padding decides whether the *last* chapter can reach the line at all, so it
    // has to be in place before the offset is clamped by the browser.
    this.updateScrollTailPadding();
    const top = this.chapterSlotTop(idx);
    this.setScrollTop(top - this.metrics.paddingTop);
    this.mountScrollWindow(idx, true);
    this.invalidateScrollSlots();
    this.updateScrollProgressFill();
  }

  /** Put `anchor` on the top reading line, character-precise. */
  private positionScrollAtAnchor(anchor: Anchor): void {
    const idx = this.chapterIndexForAnchor(anchor);
    // The anchor is authoritative until the reader scrolls away from where we place them
    // (see `handleScrollSettled`): a deep link must come back with its exact `charOffset`.
    this.rememberRestoredAnchor(anchor);
    this.ensureScrollChapterMounted(idx);
    this.currentChapterIdx = idx;
    this.currentChapterPage = 0;

    const entry = this.rendered.get(idx);
    const blockEl = entry?.blockById.get(anchor.blockId);
    if (!entry || !blockEl) {
      this.positionScrollAtChapter(idx);
      return;
    }

    this.updateScrollTailPadding();
    const stageRect = this.stageEl.getBoundingClientRect();
    const blockRect = blockEl.getBoundingClientRect();
    const blockDocTop = blockRect.top - stageRect.top + this.stageEl.scrollTop;
    let charTop = 0;
    const displayOffset = this.toDisplayAnchorOffset(blockEl, anchor.charOffset);
    if (displayOffset > 0) {
      const charRect = getCharacterRect(blockEl, displayOffset);
      if (charRect) charTop = charRect.top - blockRect.top;
    }

    this.setScrollTop(blockDocTop + charTop - this.metrics.paddingTop);
    this.mountScrollWindow(idx, true);
    this.invalidateScrollSlots();
    this.updateScrollProgressFill();
  }

  private gotoScroll(target: { anchor?: Anchor; chapterId?: string; page?: number }): boolean {
    const book = this.book;
    if (!book) return false;

    if (target.anchor) {
      // `positionScrollAtAnchor` remembers the anchor itself; a jump to an anchor is the
      // same promise as a restored position (exact block **and** character offset).
      this.positionScrollAtAnchor(target.anchor);
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    if (target.chapterId) {
      const idx = book.chapters.findIndex((ch) => ch.id === target.chapterId);
      if (idx < 0) return false;
      this.clearRestoredAnchor();
      this.currentChapterIdx = idx;
      this.mountScrollWindow(idx, false);
      if (target.page !== undefined) {
        this.scrollToPageWithinChapter(idx, Math.max(0, Math.floor(target.page) - 1));
      } else {
        this.positionScrollAtChapter(idx);
      }
      this.mountScrollWindow(idx, true);
      this.invalidateScrollSlots();
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    if (typeof target.page === 'number' && Number.isFinite(target.page)) {
      const desiredGlobalZero = Math.max(0, Math.floor(target.page) - 1);
      const counts = this.refreshPageMap().counts;
      let offset = 0;
      let targetIdx = book.chapters.length - 1;
      let pageInChapter = 0;
      for (let i = 0; i < counts.length; i++) {
        const c = counts[i] ?? 1;
        if (desiredGlobalZero < offset + c || i === counts.length - 1) {
          targetIdx = i;
          pageInChapter = Math.max(0, desiredGlobalZero - offset);
          break;
        }
        offset += c;
      }
      this.clearRestoredAnchor();
      this.currentChapterIdx = targetIdx;
      this.mountScrollWindow(targetIdx, false);
      this.scrollToPageWithinChapter(targetIdx, pageInChapter);
      this.mountScrollWindow(targetIdx, true);
      this.invalidateScrollSlots();
      this.renderHighlights();
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
  }

  /** Scroll so the middle of `pageIndex` (0-based, in-chapter) is under the reading line. */
  private scrollToPageWithinChapter(idx: number, pageIndex: number): void {
    // P2-2: in scroll mode the chapter's own `pageCount` is a frozen density estimate; the
    // authoritative in-chapter count is what the page map (offscreen exact pass) measured.
    const counts = this.refreshPageMap().counts;
    const count = Math.max(1, counts[idx] ?? this.rendered.get(idx)?.pageCount ?? 1);
    const clamped = Math.max(0, Math.min(count - 1, pageIndex));
    const fraction = (clamped + 0.5) / count;
    this.currentChapterPage = clamped;
    const top = this.chapterSlotTop(idx);
    const height = this.chapterSlotHeight(idx);
    const target = top + fraction * height - this.metrics.paddingTop;
    this.setScrollTop(target);
    this.updateScrollProgressFill();
  }

  /** `next`/`prev` in scroll mode: one comfortable screenful, never past the ends. */
  private scrollByViewport(direction: 1 | -1): boolean {
    const stage = this.stageEl;
    const max = Math.max(0, stage.scrollHeight - stage.clientHeight);
    const step = Math.max(1, Math.round(stage.clientHeight * 0.85));
    const before = stage.scrollTop;
    const next = Math.max(0, Math.min(max, before + direction * step));
    if (next === before) return false;
    stage.scrollTop = next;
    this.syncScrollChapter();
    this.updateScrollProgressFill();
    this.scheduleBackgroundWork();
    return true;
  }

  /** Called on every scroll frame (rAF-coalesced) by the engine. */
  handleScrollFrame(): void {
    if (!this.isScrollMode()) return;
    if (this.scrollRaf !== null) return;
    this.scrollRaf = window.requestAnimationFrame(() => {
      this.scrollRaf = null;
      if (!this.isScrollMode()) return;
      this.updateScrollProgressFill();
      // P2-1: the window has to exist *while* the reader is scrolling, not 100 ms later.
      // Resolve the visible chapter from slot geometry and mount `[n-1, n, n+1]` on this
      // frame. The early exit keeps a steady scroll free of repeated layout work.
      const idx = this.scrollVisibleIndex();
      if (idx !== this.currentChapterIdx || !this.isScrollWindowMounted(idx)) {
        this.syncScrollChapter();
      }
    });
  }

  /** true when every chapter in `[center - 1, center + 1]` is already in the DOM. */
  private isScrollWindowMounted(center: number): boolean {
    const book = this.book;
    if (!book) return false;
    for (let offset = -SCROLL_WINDOW_RADIUS; offset <= SCROLL_WINDOW_RADIUS; offset++) {
      const idx = center + offset;
      if (idx < 0 || idx >= book.chapters.length) continue;
      if (!this.rendered.has(idx)) return false;
    }
    return true;
  }

  /** Called ~100 ms after the last scroll event, once the reading line has settled. */
  handleScrollSettled(): void {
    if (!this.isScrollMode() || !this.book) return;
    this.syncScrollChapter();
    // P1-1: a position restored from the host (`charOffset`) must survive
    // paginated → scroll → paginated without the reader moving. Programmatic placement
    // (including the compensation a neighbour mount does) updates `scrollRestoredTop`, so
    // a settle within tolerance is not a user scroll and the anchor stays authoritative.
    const restoreDrift =
      this.restoredAnchor && this.scrollRestoredTop !== null
        ? Math.abs(this.stageEl.scrollTop - this.scrollRestoredTop)
        : Number.POSITIVE_INFINITY;
    if (restoreDrift > SCROLL_RESTORE_TOLERANCE) {
      // A real scroll: the reader moved the page under the line, so geometry wins again
      // and the character offset is re-derived from whatever block is now there.
      this.clearRestoredAnchor();
    }
    this.updateScrollProgressFill();
    this.scheduleBackgroundWork();
  }

  private updateScrollProgressFill(): void {
    if (!this.book) return;
    const fill = this.rootEl.querySelector<HTMLElement>('.scroll-progress-fill');
    if (!fill) return;
    const scrollable = this.stageEl.scrollHeight - this.stageEl.clientHeight;
    const progress = scrollable > 0 ? this.stageEl.scrollTop / scrollable : 0;
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, progress)).toFixed(4)})`;
  }

  private getScrollPositionSnapshot(): PositionSnapshot | null {
    const book = this.book;
    if (!book) return null;
    this.syncScrollChapter();
    const chapter = book.chapters[this.currentChapterIdx];
    if (!chapter) return null;

    const map = this.refreshPageMap();
    const counts = map.counts;
    let pagesBefore = 0;
    for (let i = 0; i < this.currentChapterIdx; i++) {
      pagesBefore += counts[i] ?? 1;
    }
    const totalPages = Math.max(1, map.total);
    const chapterPageCount = Math.max(1, counts[this.currentChapterIdx] ?? 1);
    const progress = this.getScrollChapterProgress();
    const chapterPageIndex = Math.max(
      0,
      Math.min(chapterPageCount - 1, Math.floor(progress * chapterPageCount)),
    );
    const globalPage = Math.max(1, Math.min(totalPages, pagesBefore + chapterPageIndex + 1));
    const bookProgress = totalPages <= 1 ? 1 : (globalPage - 1) / (totalPages - 1);

    return {
      anchor: this.captureCurrentAnchor(),
      chapterId: chapter.id,
      page: globalPage,
      pageCount: totalPages,
      chapterPage: chapterPageIndex + 1,
      chapterPageCount,
      bookProgress: Math.max(0, Math.min(1, Number(bookProgress.toFixed(6)))),
      spread: false,
      estimated: map.estimated,
      chapterProgress: Number(progress.toFixed(6)),
      readingMode: 'scroll',
    };
  }

  private cancelIdleWork(): void {
    this.backgroundWanted = false;
    if (this.backgroundFallbackTimer !== null) {
      window.clearTimeout(this.backgroundFallbackTimer);
      this.backgroundFallbackTimer = null;
    }
    if (!this.idleHandle) return;
    if (this.idleHandle.kind === 'idle') {
      const win = window as unknown as { cancelIdleCallback?: (id: number) => void };
      win.cancelIdleCallback?.(this.idleHandle.id);
    } else {
      window.clearTimeout(this.idleHandle.id);
    }
    this.idleHandle = null;
  }

  private clearRenderedDom(): void {
    for (const entry of this.rendered.values()) {
      entry.el.remove();
    }
    this.rendered.clear();
  }
}
