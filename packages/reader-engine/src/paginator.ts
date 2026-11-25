import type { Anchor, Block, Book, Chapter } from '@rewiaty/book-format';
import { escapeHtml } from '@rewiaty/book-format';
import {
  SPREAD_GUTTER_PX,
  SPREAD_MIN_VIEWPORT_PX,
  measureChToPx,
  spineTokensFor,
} from './spread.js';
import { THEMES, type ReaderInsets, type ReaderSettings, type TocEntry } from './types.js';

function normalizeInsets(insets?: ReaderInsets | null): ReaderInsets {
  const top = typeof insets?.top === 'number' && Number.isFinite(insets.top) ? Math.max(0, Math.round(insets.top)) : 0;
  const bottom =
    typeof insets?.bottom === 'number' && Number.isFinite(insets.bottom) ? Math.max(0, Math.round(insets.bottom)) : 0;
  return { top, bottom };
}

const INITIAL_WORD_BUDGET = 2500;
const BATCH_WORD_BUDGET = 2000;

/** Element that pads a chapter to an even page count so every chapter starts on the same side. */
const CHAPTER_PAD_CLASS = 'chapter-pad';

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

  private idleHandle: { kind: 'idle' | 'timeout'; id: number } | null = null;
  private transitionResetRaf: number | null = null;
  private layoutGeneration = 0;

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

  setBook(book: Book, settings: ReaderSettings, initialAnchor?: Anchor, insets?: ReaderInsets): void {
    this.cancelIdleWork();
    this.layoutGeneration++;
    this.book = book;
    this.settings = { ...settings };
    this.insets = normalizeInsets(insets);
    this.clearRenderedDom();
    this.clearRestoredAnchor();
    this.invalidatePageMap();
    this.settledSignature = null;

    this.resolveEffectiveDirection();
    this.applyStylesAndMeasureViewport();

    let targetChapterIdx = 0;
    let targetBlockIdx = 0;
    let targetBlockId: string | undefined;
    let targetOffset = 0;

    if (initialAnchor) {
      for (let c = 0; c < book.chapters.length; c++) {
        const ch = book.chapters[c]!;
        const bIdx = ch.blocks.findIndex((b) => b.id === initialAnchor.blockId);
        if (bIdx >= 0) {
          targetChapterIdx = c;
          targetBlockIdx = bIdx;
          targetBlockId = initialAnchor.blockId;
          targetOffset = initialAnchor.charOffset;
          break;
        }
      }
    }

    this.currentChapterIdx = targetChapterIdx;
    this.currentChapterPage = 0;

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
      // A deep link must report the very anchor it was opened at, not the block that
      // happens to sit on top of the page its column landed on.
      this.rememberRestoredAnchor({ blockId: targetBlockId, charOffset: targetOffset });
    }

    this.applyTrackTransform(false);
  }

  /**
   * Kick off idle progressive mounting for the rest of the current chapter
   * and adjacent virtualized chapters (-1 and +1). Called right after `ready`.
   */
  scheduleBackgroundWork(): void {
    this.cancelIdleWork();
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
          if (!adj.isComplete || this.hasUnmountedAdjacentChapters()) {
            scheduleNext(step);
          }
          return;
        }
        if (!adj.isComplete) {
          this.appendNextBatch(adj, BATCH_WORD_BUDGET);
          this.layoutVirtualizedChapterOffsets();
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
    this.layoutGeneration++;

    const anchorBefore = this.book ? this.captureCurrentAnchor() : null;
    // The anchor is authoritative across the reflow: report it back verbatim instead of
    // re-deriving a (lossy) top-of-page block from the new layout.
    this.rememberRestoredAnchor(anchorBefore);
    this.settings = { ...this.settings, ...partial };
    if (insets !== undefined) {
      this.insets = normalizeInsets(insets);
    }
    this.resolveEffectiveDirection();

    for (const entry of this.rendered.values()) {
      entry.el.setAttribute('dir', this.dir);
    }

    this.applyStylesAndMeasureViewport();

    if (!this.book) return;

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
    this.layoutGeneration++;
    this.rememberRestoredAnchor(anchorBefore);

    for (const entry of this.rendered.values()) {
      this.remeasureChapter(entry);
    }
    this.layoutVirtualizedChapterOffsets();

    if (anchorBefore) {
      this.currentChapterPage = this.alignToSpread(this.resolveAnchorPageInCurrentChapter(anchorBefore));
    }
    this.applyTrackTransform(false);
    this.scheduleBackgroundWork();
    return true;
  }

  handleFontLoad(): boolean {
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
    const signature = this.layoutSignature();
    const firstForSignature = this.settledSignature !== signature;
    this.settledSignature = signature;

    let changed = false;
    if (firstForSignature) {
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

    if (changed || firstForSignature) {
      this.invalidatePageMap();
      this.layoutVirtualizedChapterOffsets();
    }
    return changed;
  }

  nextPage(): boolean {
    if (!this.book) return false;
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
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
  }

  prevPage(): boolean {
    if (!this.book) return false;
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

    if (target.anchor) {
      let chIdx = -1;
      let blockIdx = 0;
      for (let i = 0; i < this.book.chapters.length; i++) {
        const idx = this.book.chapters[i]!.blocks.findIndex((b) => b.id === target.anchor!.blockId);
        if (idx >= 0) {
          chIdx = i;
          blockIdx = idx;
          break;
        }
      }
      if (chIdx < 0) return false;

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

      this.currentChapterPage = this.alignToSpread(this.resolveAnchorPageInCurrentChapter(target.anchor));
      this.clearRestoredAnchor();
      this.applyTrackTransform(false);
      this.scheduleBackgroundWork();
      return true;
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
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
  }

  getPositionSnapshot(): PositionSnapshot | null {
    if (!this.book) return null;
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
  }

  /**
   * true when the remembered anchor still points at a mounted block of the active
   * chapter — otherwise it is stale and geometry has to answer.
   */
  private isRestoredAnchorUsable(): boolean {
    if (!this.restoredAnchor) return false;
    const curr = this.rendered.get(this.currentChapterIdx);
    return Boolean(curr?.blockById.has(this.restoredAnchor.blockId));
  }

  captureCurrentAnchor(): Anchor {
    if (this.isRestoredAnchorUsable()) {
      return { blockId: this.restoredAnchor!.blockId, charOffset: this.restoredAnchor!.charOffset };
    }
    if (this.restoredAnchor) {
      this.clearRestoredAnchor();
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

    return { blockId, charOffset: foundOffset };
  }

  private resolveAnchorPageInCurrentChapter(anchor: Anchor): number {
    const curr = this.rendered.get(this.currentChapterIdx);
    if (!curr) return 0;

    const blockEl = curr.blockById.get(anchor.blockId);
    if (!blockEl) return 0;

    const chRect = curr.el.getBoundingClientRect();
    const rect =
      anchor.charOffset > 0
        ? getCharacterRect(blockEl, anchor.charOffset)
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
    const theme = THEMES[this.settings.theme] ?? THEMES.warraq;
    const spine = spineTokensFor(this.settings.theme);
    const rootStyle = document.documentElement.style;

    const maxCh = Math.max(45, Math.min(85, Math.round(this.settings.maxReadingWidth)));
    const rawLineHeight = Math.max(1.5, Math.min(2.6, this.settings.lineHeight));
    const fontSize = Math.max(14, Math.min(36, this.settings.fontSize));
    const fontWeight = Math.max(300, Math.min(600, Math.round(this.settings.fontWeight)));

    // The spread decision comes from the *viewport*, because the stage width is
    // already capped by --max-width and would feedback-loop on itself.
    const viewportW = Math.floor(this.rootEl.clientWidth) || window.innerWidth || 390;
    const viewportH = Math.floor(this.rootEl.clientHeight) || window.innerHeight || 844;
    const spread =
      this.settings.spread !== 'single' && viewportW >= SPREAD_MIN_VIEWPORT_PX && viewportW > viewportH;

    // Cap the open book so one column never exceeds the design's line measure (54ch).
    const bookMaxPx = measureChToPx(maxCh, fontSize) * 2 + SPREAD_GUTTER_PX;
    if (spread) {
      rootStyle.setProperty('--max-width', `${bookMaxPx}px`);
    } else {
      rootStyle.setProperty('--max-width', `${maxCh}ch`);
    }

    // Read the stage after the width cap so the measurement is final.
    const stageW = Math.floor(this.stageEl.clientWidth) || viewportW;
    const stageH = Math.floor(this.stageEl.clientHeight) || viewportH;

    const pageWidth = spread ? Math.floor(stageW / 2) : stageW;
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
      width: spread ? pageWidth * 2 : stageW,
      height: stageH,
      pageWidth,
      marginH,
      marginV,
      paddingTop,
      paddingBottom,
      spread,
    };

    const colWidth = Math.max(80, pageWidth - 2 * marginH);
    const colGap = 2 * marginH;

    document.documentElement.setAttribute('dir', this.dir);
    document.documentElement.setAttribute('lang', this.book?.meta.lang ?? (this.dir === 'rtl' ? 'ar' : 'en'));
    this.rootEl.setAttribute('dir', this.dir);
    this.rootEl.classList.toggle('spread-mode', spread);

    rootStyle.setProperty('--bg-color', theme.bg);
    rootStyle.setProperty('--text-color', theme.text);
    rootStyle.setProperty('--muted-color', theme.muted);
    rootStyle.setProperty('--quote-bg', theme.quoteBg);
    rootStyle.setProperty('--quote-border', theme.quoteBorder);
    rootStyle.setProperty('--accent-color', theme.accent);
    rootStyle.setProperty('--popover-bg', theme.popoverBg);
    rootStyle.setProperty('--popover-border', theme.popoverBorder);

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

    const sliceHtml = chapter.blocks.slice(0, count).map(renderBlockHtml).join('');
    el.innerHTML = `<header class="chapter-header"><h1 class="chapter-title">${escapeHtml(chapter.title)}</h1><div class="chapter-ornament" aria-hidden="true">✦</div></header>${sliceHtml}`;
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
      }
      cursor = cursor.nextElementSibling as HTMLElement | null;
    }

    entry.mountedBlockCount = endIdx;
    entry.mountedWordCount += batchWords;
    entry.isComplete = endIdx >= blocks.length;
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
      }
      cursor = cursor.nextElementSibling as HTMLElement | null;
    }

    entry.mountedBlockCount = endIdx;
    entry.mountedWordCount += addedWords;
    entry.isComplete = endIdx >= blocks.length;
    this.remeasureChapter(entry);
  }

  private remeasureChapter(entry: RenderedChapter): void {
    this.applyChapterMeasurements(entry);
    if (entry.isComplete) {
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
    const pageW = this.metrics.pageWidth;
    const curr = this.rendered.get(this.currentChapterIdx);
    const prev = this.rendered.get(this.currentChapterIdx - 1);
    const next = this.rendered.get(this.currentChapterIdx + 1);

    if (curr) {
      curr.el.style.transform = 'translate3d(0px, 0, 0)';
      curr.el.setAttribute('aria-hidden', 'false');
    }

    if (prev) {
      const offsetPx = this.dir === 'rtl' ? prev.layoutPageCount * pageW : -(prev.layoutPageCount * pageW);
      prev.el.style.transform = `translate3d(${offsetPx}px, 0, 0)`;
      prev.el.setAttribute('aria-hidden', 'true');
    }

    if (next && curr) {
      const offsetPx = this.dir === 'rtl' ? -(curr.layoutPageCount * pageW) : curr.layoutPageCount * pageW;
      next.el.style.transform = `translate3d(${offsetPx}px, 0, 0)`;
      next.el.setAttribute('aria-hidden', 'true');
    }
  }

  private applyTrackTransform(animate: boolean): void {
    if (this.transitionResetRaf !== null) {
      window.cancelAnimationFrame(this.transitionResetRaf);
      this.transitionResetRaf = null;
    }

    if (!animate) {
      this.trackEl.style.transition = 'none';
    } else {
      this.trackEl.style.transition = '';
    }

    const offsetPx =
      this.dir === 'rtl'
        ? this.currentChapterPage * this.metrics.pageWidth
        : -(this.currentChapterPage * this.metrics.pageWidth);

    this.trackEl.style.transform = `translate3d(${offsetPx}px, 0, 0)`;

    if (!animate && !this.settings.disableAnimation) {
      this.transitionResetRaf = window.requestAnimationFrame(() => {
        this.transitionResetRaf = null;
        this.trackEl.style.transition = '';
      });
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
    ].join('|');
  }

  private cacheKey(chapter: Chapter): string {
    return [chapter.id, chapter.hash, this.layoutSignature()].join('|');
  }

  private invalidatePageMap(): void {
    this.pageMap = null;
  }

  /**
   * Words per real page, frozen per layout. Prefers complete chapters (their word
   * count is the book's own number, not an approximation of the mounted DOM), then the
   * exact cache, and only falls back to a partially-mounted slice as a last resort.
   */
  private measuredDensity(): number {
    let words = 0;
    let pages = 0;
    for (const entry of this.rendered.values()) {
      if (entry.isComplete && entry.pageCount > 0 && entry.chapter.wordCount > 0) {
        words += entry.chapter.wordCount;
        pages += entry.pageCount;
      }
    }
    if (words > 0 && pages > 0) return words / pages;

    if (this.book) {
      for (const ch of this.book.chapters) {
        const cached = this.pageCache.get(this.cacheKey(ch));
        if (cached !== undefined && cached > 0 && ch.wordCount > 0) {
          words += ch.wordCount;
          pages += cached;
        }
      }
    }
    if (words > 0 && pages > 0) return words / pages;

    for (const entry of this.rendered.values()) {
      if (entry.pageCount > 0 && entry.mountedWordCount > 0) {
        words += entry.mountedWordCount;
        pages += entry.pageCount;
      }
    }
    return words > 0 && pages > 0 ? words / pages : 220;
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

  private cancelIdleWork(): void {
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
