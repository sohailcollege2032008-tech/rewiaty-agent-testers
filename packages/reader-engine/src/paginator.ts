import type { Anchor, Block, Book, Chapter } from '@rewiaty/book-format';
import { escapeHtml } from '@rewiaty/book-format';
import { THEMES, type ReaderSettings, type TocEntry } from './types.js';

const INITIAL_WORD_BUDGET = 2500;
const BATCH_WORD_BUDGET = 2000;

export type ViewportMetrics = {
  width: number;
  height: number;
  marginH: number;
  marginV: number;
};

export type RenderedChapter = {
  index: number;
  chapter: Chapter;
  el: HTMLElement;
  pageCount: number; // measured pages for mounted prefix
  estimatedTotalPages: number; // extrapolated total pages until mountedBlockCount === chapter.blocks.length
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
  pageCount: number; // total book pages (exact for measured, estimated for unmeasured)
  chapterPage: number; // 1-based page in current chapter
  chapterPageCount: number;
  bookProgress: number; // 0..1
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
  private dir: 'rtl' | 'ltr' = 'rtl';
  private metrics: ViewportMetrics = { width: 390, height: 844, marginH: 24, marginV: 24 };

  private currentChapterIdx = 0;
  private currentChapterPage = 0;

  // Virtualized DOM map: only [currentIdx - 1, currentIdx, currentIdx + 1]
  private rendered = new Map<number, RenderedChapter>();
  // Page count cache keyed by `${chapter.id}:${chapter.hash}:${layoutKey}`
  private pageCache = new Map<string, number>();

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

  setBook(book: Book, settings: ReaderSettings, initialAnchor?: Anchor): void {
    this.cancelIdleWork();
    this.layoutGeneration++;
    this.book = book;
    this.settings = { ...settings };
    this.clearRenderedDom();

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
      this.currentChapterPage = this.resolveAnchorPageInCurrentChapter({
        blockId: targetBlockId,
        charOffset: targetOffset,
      });
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

  updateSettings(partial: Partial<ReaderSettings>): void {
    this.cancelIdleWork();
    this.layoutGeneration++;

    const anchorBefore = this.book ? this.captureCurrentAnchor() : null;
    this.settings = { ...this.settings, ...partial };
    this.resolveEffectiveDirection();

    for (const entry of this.rendered.values()) {
      entry.el.setAttribute('dir', this.dir);
    }

    this.applyStylesAndMeasureViewport();

    if (!this.book) return;

    // Ensure anchor's chapter is mounted enough to cover anchor, then re-measure mounted chapters
    for (const entry of this.rendered.values()) {
      entry.pageCount = this.measureChapterScrollPages(entry.el);
      entry.estimatedTotalPages = this.computeEstimatedTotalPages(entry);
      if (entry.isComplete) {
        this.pageCache.set(this.cacheKey(entry.chapter), entry.pageCount);
      }
    }

    this.layoutVirtualizedChapterOffsets();

    if (anchorBefore) {
      this.currentChapterPage = this.resolveAnchorPageInCurrentChapter(anchorBefore);
    } else {
      const curr = this.rendered.get(this.currentChapterIdx);
      const maxPage = curr ? curr.pageCount - 1 : 0;
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

    for (const entry of this.rendered.values()) {
      entry.pageCount = this.measureChapterScrollPages(entry.el);
      entry.estimatedTotalPages = this.computeEstimatedTotalPages(entry);
      if (entry.isComplete) {
        this.pageCache.set(this.cacheKey(entry.chapter), entry.pageCount);
      }
    }
    this.layoutVirtualizedChapterOffsets();

    if (anchorBefore) {
      this.currentChapterPage = this.resolveAnchorPageInCurrentChapter(anchorBefore);
    }
    this.applyTrackTransform(false);
    this.scheduleBackgroundWork();
    return true;
  }

  nextPage(): boolean {
    if (!this.book) return false;
    const curr = this.rendered.get(this.currentChapterIdx);
    if (!curr) return false;

    // If approaching the end of a partially mounted chapter, mount the next batch synchronously
    if (!curr.isComplete && this.currentChapterPage + 2 >= curr.pageCount) {
      this.appendNextBatch(curr, BATCH_WORD_BUDGET);
      this.layoutVirtualizedChapterOffsets();
      if (curr.isComplete) {
        this.callbacks.onChapterLayoutComplete?.(curr.chapter.id);
      }
    }

    if (this.currentChapterPage + 1 < curr.pageCount) {
      this.currentChapterPage += 1;
      this.applyTrackTransform(!this.settings.disableAnimation);
      return true;
    }

    if (this.currentChapterIdx + 1 < this.book.chapters.length) {
      this.currentChapterIdx += 1;
      this.currentChapterPage = 0;
      this.syncActiveAndEvict(0);
      this.applyTrackTransform(false);
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
  }

  prevPage(): boolean {
    if (!this.book) return false;

    if (this.currentChapterPage > 0) {
      this.currentChapterPage -= 1;
      this.applyTrackTransform(!this.settings.disableAnimation);
      return true;
    }

    if (this.currentChapterIdx > 0) {
      this.currentChapterIdx -= 1;
      const targetChapter = this.book.chapters[this.currentChapterIdx]!;
      // Going backwards to the end of the previous chapter requires all its blocks mounted
      this.syncActiveAndEvict(targetChapter.blocks.length);
      const curr = this.rendered.get(this.currentChapterIdx);
      this.currentChapterPage = curr ? Math.max(0, curr.pageCount - 1) : 0;
      this.applyTrackTransform(false);
      this.scheduleBackgroundWork();
      return true;
    }

    return false;
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

      this.currentChapterPage = this.resolveAnchorPageInCurrentChapter(target.anchor);
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

      const maxPage = curr ? curr.pageCount - 1 : 0;
      this.currentChapterPage = Math.min(maxPage, requestedZeroBased);
      this.applyTrackTransform(false);
      this.scheduleBackgroundWork();
      return true;
    }

    if (typeof target.page === 'number' && Number.isFinite(target.page)) {
      const desiredGlobalZero = Math.max(0, Math.floor(target.page) - 1);
      const counts = this.getChapterPageEstimates();
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

      const maxPage = curr ? curr.pageCount - 1 : 0;
      this.currentChapterPage = Math.min(maxPage, pageInChapter);
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

    const counts = this.getChapterPageEstimates();
    let pagesBefore = 0;
    for (let i = 0; i < this.currentChapterIdx; i++) {
      pagesBefore += counts[i] ?? 1;
    }
    const totalPages = counts.reduce((sum, c) => sum + c, 0);
    const chapterPageCount = curr.isComplete ? curr.pageCount : curr.estimatedTotalPages;
    const globalPage = pagesBefore + this.currentChapterPage + 1;
    const bookProgress = totalPages <= 1 ? 1 : (globalPage - 1) / (totalPages - 1);

    return {
      anchor: this.captureCurrentAnchor(),
      chapterId: chapter.id,
      page: globalPage,
      pageCount: Math.max(1, totalPages),
      chapterPage: this.currentChapterPage + 1,
      chapterPageCount,
      bookProgress: Math.max(0, Math.min(1, Number(bookProgress.toFixed(6)))),
    };
  }

  getTocEntries(): TocEntry[] {
    if (!this.book) return [];
    const counts = this.getChapterPageEstimates();
    let startPage = 1;
    return this.book.chapters.map((ch, idx) => {
      const pageCount = counts[idx] ?? 1;
      const entry: TocEntry = {
        id: ch.id,
        title: ch.title,
        wordCount: ch.wordCount,
        pageCount,
        startPage,
      };
      startPage += pageCount;
      return entry;
    });
  }

  captureCurrentAnchor(): Anchor {
    const curr = this.rendered.get(this.currentChapterIdx);
    if (!curr || curr.blockEls.length === 0) {
      const fallbackId = curr?.chapter.blocks[0]?.id ?? curr?.chapter.id ?? 'ch01_p0001';
      return { blockId: fallbackId, charOffset: 0 };
    }

    const chRect = curr.el.getBoundingClientRect();
    const pageW = this.metrics.width;
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
    const col = getColumnForRect(rect, chRect, this.dir, this.metrics.width, 'start');
    return Math.max(0, Math.min(curr.pageCount - 1, col));
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
    const theme = THEMES[this.settings.theme] ?? THEMES['warm-paper'];
    const rootStyle = document.documentElement.style;

    const maxCh = Math.max(45, Math.min(85, Math.round(this.settings.maxReadingWidth)));
    rootStyle.setProperty('--max-width', `${maxCh}ch`);

    const rawW = Math.floor(this.stageEl.clientWidth) || window.innerWidth || 390;
    const rawH = Math.floor(this.stageEl.clientHeight) || window.innerHeight || 844;
    const marginH = Math.max(8, Math.min(Math.floor(rawW / 4), Math.round(this.settings.marginHorizontal)));
    const marginV = Math.max(16, Math.min(Math.floor(rawH / 4), Math.round(this.settings.marginVertical)));

    this.metrics = { width: rawW, height: rawH, marginH, marginV };

    const colWidth = Math.max(80, rawW - 2 * marginH);
    const colGap = 2 * marginH;

    const rawLineHeight = Math.max(1.5, Math.min(2.6, this.settings.lineHeight));
    const fontSize = Math.max(14, Math.min(36, this.settings.fontSize));
    const fontWeight = Math.max(300, Math.min(600, Math.round(this.settings.fontWeight)));

    document.documentElement.setAttribute('dir', this.dir);
    document.documentElement.setAttribute('lang', this.book?.meta.lang ?? (this.dir === 'rtl' ? 'ar' : 'en'));
    this.rootEl.setAttribute('dir', this.dir);

    rootStyle.setProperty('--bg-color', theme.bg);
    rootStyle.setProperty('--text-color', theme.text);
    rootStyle.setProperty('--muted-color', theme.muted);
    rootStyle.setProperty('--quote-bg', theme.quoteBg);
    rootStyle.setProperty('--quote-border', theme.quoteBorder);
    rootStyle.setProperty('--accent-color', theme.accent);
    rootStyle.setProperty('--popover-bg', theme.popoverBg);
    rootStyle.setProperty('--popover-border', theme.popoverBorder);

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

    rootStyle.setProperty('--page-width', `${rawW}px`);
    rootStyle.setProperty('--page-height', `${rawH}px`);
    rootStyle.setProperty('--col-width', `${colWidth}px`);
    rootStyle.setProperty('--col-gap', `${colGap}px`);
    rootStyle.setProperty('--margin-h', `${marginH}px`);
    rootStyle.setProperty('--margin-v', `${marginV}px`);
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

    const pageCount = this.measureChapterScrollPages(el);
    const isComplete = count >= totalBlocks;

    const entry: RenderedChapter = {
      index,
      chapter,
      el,
      pageCount,
      estimatedTotalPages: pageCount,
      mountedBlockCount: count,
      mountedWordCount: wordsMounted,
      isComplete,
      blockEls,
      blockById,
    };
    entry.estimatedTotalPages = this.computeEstimatedTotalPages(entry);
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
    entry.pageCount = this.measureChapterScrollPages(entry.el);
    entry.estimatedTotalPages = this.computeEstimatedTotalPages(entry);

    if (entry.isComplete) {
      this.pageCache.set(this.cacheKey(entry.chapter), entry.pageCount);
    }
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
    entry.pageCount = this.measureChapterScrollPages(entry.el);
    entry.estimatedTotalPages = this.computeEstimatedTotalPages(entry);

    if (entry.isComplete) {
      this.pageCache.set(this.cacheKey(entry.chapter), entry.pageCount);
    }
  }

  /**
   * Single O(1) measurement using scrollWidth / pageWidth (no line-box loops).
   */
  private measureChapterScrollPages(el: HTMLElement): number {
    const pageW = this.metrics.width;
    if (pageW <= 0) return 1;
    const sw = el.scrollWidth;
    if (sw <= pageW) return 1;
    return Math.max(1, Math.ceil(sw / pageW));
  }

  private computeEstimatedTotalPages(entry: RenderedChapter): number {
    if (entry.isComplete) return entry.pageCount;
    if (entry.mountedWordCount <= 0 || entry.chapter.wordCount <= entry.mountedWordCount) {
      return entry.pageCount;
    }
    const ratio = entry.chapter.wordCount / entry.mountedWordCount;
    return Math.max(entry.pageCount, Math.ceil(entry.pageCount * ratio));
  }

  private layoutVirtualizedChapterOffsets(): void {
    const pageW = this.metrics.width;
    const curr = this.rendered.get(this.currentChapterIdx);
    const prev = this.rendered.get(this.currentChapterIdx - 1);
    const next = this.rendered.get(this.currentChapterIdx + 1);

    if (curr) {
      curr.el.style.transform = 'translate3d(0px, 0, 0)';
      curr.el.setAttribute('aria-hidden', 'false');
    }

    if (prev) {
      const offsetPx = this.dir === 'rtl' ? prev.pageCount * pageW : -(prev.pageCount * pageW);
      prev.el.style.transform = `translate3d(${offsetPx}px, 0, 0)`;
      prev.el.setAttribute('aria-hidden', 'true');
    }

    if (next && curr) {
      const offsetPx = this.dir === 'rtl' ? -(curr.pageCount * pageW) : curr.pageCount * pageW;
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
        ? this.currentChapterPage * this.metrics.width
        : -(this.currentChapterPage * this.metrics.width);

    this.trackEl.style.transform = `translate3d(${offsetPx}px, 0, 0)`;

    if (!animate && !this.settings.disableAnimation) {
      this.transitionResetRaf = window.requestAnimationFrame(() => {
        this.transitionResetRaf = null;
        this.trackEl.style.transition = '';
      });
    }
  }

  private cacheKey(chapter: Chapter): string {
    const s = this.settings;
    return [
      chapter.id,
      chapter.hash,
      this.metrics.width,
      this.metrics.height,
      this.metrics.marginH,
      this.metrics.marginV,
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

  private getChapterPageEstimates(): number[] {
    if (!this.book) return [];

    let measuredWords = 0;
    let measuredPages = 0;
    for (const ch of this.book.chapters) {
      const cached = this.pageCache.get(this.cacheKey(ch));
      if (cached !== undefined) {
        measuredWords += ch.wordCount;
        measuredPages += cached;
      }
    }
    const wordsPerPage =
      measuredPages > 0 && measuredWords > 0 ? Math.max(40, measuredWords / measuredPages) : 220;

    return this.book.chapters.map((ch, idx) => {
      const cached = this.pageCache.get(this.cacheKey(ch));
      if (cached !== undefined) return cached;
      const active = this.rendered.get(idx);
      if (active) return active.estimatedTotalPages;
      return Math.max(1, Math.ceil(ch.wordCount / wordsPerPage));
    });
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
