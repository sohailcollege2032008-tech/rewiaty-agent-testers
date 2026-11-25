import type { Block, Book } from '@rewiaty/book-format';
import { postToHost, subscribeHostMessages } from './bridge.js';
import { buildFontFaceCss } from './fonts.js';
import {
  clearDomSelection,
  extendSelectionToPoint,
  extractSelectionInfo,
  hasNonCollapsedSelection,
  selectWordAtPoint,
  type SelectionWordAnchor,
} from './highlights.js';
import { Paginator } from './paginator.js';
import { DEFAULT_SETTINGS, type ReaderSettings, type RNToWebMessage } from './types.js';

const LONG_PRESS_MS = 350;
/**
 * Movement (px) after which a touch is a drag, not a tap. A tap on the page centre
 * toggles the bars; a drag turns the page with the finger.
 */
const DRAG_START_PX = 10;
/** Window (ms) used to read the release velocity out of the last pointer samples. */
const VELOCITY_WINDOW_MS = 120;
/**
 * Upper bound on waiting for `document.fonts.ready` before the first position is
 * reported. A face that never resolves must not leave the reader without page numbers.
 */
const SETTLE_MAX_WAIT_MS = 400;
/**
 * Extra window granted on top of `SETTLE_MAX_WAIT_MS` when a face is still fetching at
 * that point. Long enough to cover a bundled woff2 that lost the race with the first
 * frame, short enough that a wedged face cannot hold the page numbers.
 */
const SETTLE_FONT_GRACE_MS = 400;
/** How often the settle pass re-checks `document.fonts.status` while faces fetch. */
const SETTLE_POLL_MS = 50;
/**
 * Ceiling on withholding the first page number while the exact pagination pass counts a
 * very long book. Normal books finish in well under a second; this only stops a 300-chapter
 * book from leaving the footer empty.
 */
const EXACT_POSITION_MAX_WAIT_MS = 4000;

export class ReaderEngine {
  private readonly rootEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly trackEl: HTMLElement;
  private readonly footnoteBackdrop: HTMLElement;
  private readonly footnoteTitle: HTMLElement;
  private readonly footnoteBody: HTMLElement;
  private readonly footnoteCloseBtn: HTMLElement;

  private readonly paginator: Paginator;
  private book: Book | null = null;
  private pointerStart: { x: number; y: number; time: number } | null = null;
  private longPressTimer: number | null = null;
  private isSelecting = false;
  private selectionAnchor: SelectionWordAnchor | null = null;
  private hadSelectionOnDown = false;
  private gesture: {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    dragging: boolean;
  } | null = null;
  private dragSamples: Array<{ x: number; t: number }> = [];
  private resizeTimer: number | null = null;
  private fontStyleEl: HTMLStyleElement | null = null;
  private appliedFontBaseUrl = '';
  /** Bumped on every `load`, so a settle pass for an old book can't report over a new one. */
  private settleToken = 0;
  private suppressTapUntil = 0;
  /**
   * The first position of a book is withheld until the paginator knows the exact page
   * map, so the reader never sees a page number (or a total) that is about to move.
   */
  private awaitingExactPosition = false;

  constructor() {
    this.rootEl = document.getElementById('reader-root')!;
    this.stageEl = document.getElementById('reader-stage')!;
    this.trackEl = document.getElementById('reader-track')!;
    this.footnoteBackdrop = document.getElementById('footnote-backdrop')!;
    this.footnoteTitle = document.getElementById('footnote-title')!;
    this.footnoteBody = document.getElementById('footnote-body')!;
    this.footnoteCloseBtn = document.getElementById('footnote-close')!;

    this.paginator = new Paginator(this.rootEl, this.stageEl, this.trackEl, DEFAULT_SETTINGS, {
      onBackgroundProgress: () => this.emitPositionAndToc(),
      onChapterLayoutComplete: (chapterId) => postToHost({ type: 'layout-complete', chapterId }),
      onExactPagination: () => this.emitPositionAndToc(),
    });

    this.bindEvents();
  }

  private bindEvents(): void {
    subscribeHostMessages(
      (msg) => this.handleMessage(msg),
      (errMsg) => postToHost({ type: 'error', message: errMsg }),
    );

    this.rootEl.addEventListener('pointerdown', (e) => {
      if (!this.footnoteBackdrop.hidden) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.cancelLongPress();
      this.hadSelectionOnDown = hasNonCollapsedSelection();
      this.isSelecting = false;
      this.selectionAnchor = null;
      this.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      this.gesture = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        dragging: false,
      };
      this.dragSamples = [{ x: e.clientX, t: performance.now() }];
      try {
        this.rootEl.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events (tests) have no capturable pointer id.
      }

      const target = e.target as HTMLElement | null;
      const onSelectableText = Boolean(
        target?.closest('.block-p, .block-quote, .block-h2') && !target.closest('.fn-ref'),
      );
      if (onSelectableText) {
        const startX = e.clientX;
        const startY = e.clientY;
        this.longPressTimer = window.setTimeout(() => {
          this.longPressTimer = null;
          if (!this.pointerStart) return;
          // Why (product, F17): a hold is a selection, never a page turn. Dropping the
          // gesture here means the drag pipeline cannot claim the same finger, even if
          // the reader keeps moving it to extend the selection.
          this.pointerStart = null;
          this.gesture = null;
          this.paginator.cancelDrag();
          this.rootEl.classList.add('is-selecting');
          const anchor = selectWordAtPoint(startX, startY);
          if (anchor) {
            this.isSelecting = true;
            this.selectionAnchor = anchor;
          } else {
            this.rootEl.classList.remove('is-selecting');
          }
        }, LONG_PRESS_MS);
      }
    });

    this.rootEl.addEventListener('pointermove', (e) => {
      // Why (product, F17): an active selection owns the finger. Extending it must never
      // slide the page, which is the one thing that separates a hold from a drag.
      if (this.isSelecting) {
        e.preventDefault();
        if (this.selectionAnchor) {
          extendSelectionToPoint(this.selectionAnchor, e.clientX, e.clientY);
        }
        return;
      }

      const gesture = this.gesture;
      if (!gesture) return;

      gesture.lastX = e.clientX;
      this.dragSamples.push({ x: e.clientX, t: performance.now() });
      if (this.dragSamples.length > 12) this.dragSamples.shift();

      if (!gesture.dragging) {
        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;
        if (Math.abs(dx) < DRAG_START_PX) return;
        // A mostly-vertical gesture is not a page turn; ignore it entirely.
        if (Math.abs(dy) > Math.abs(dx)) {
          this.gesture = null;
          return;
        }
        // Text selected before this touch keeps the gesture: the finger extends the
        // selection instead of starting a drag.
        if (this.hadSelectionOnDown || hasNonCollapsedSelection()) {
          this.cancelLongPress();
          this.gesture = null;
          return;
        }
        this.cancelLongPress();
        gesture.dragging = true;
        this.paginator.beginDrag();
      }

      this.paginator.dragBy(e.clientX - gesture.startX);
    });

    this.rootEl.addEventListener(
      'touchmove',
      (e) => {
        if (this.isSelecting) {
          e.preventDefault();
        }
      },
      { passive: false },
    );

    this.rootEl.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.chapter')) {
        e.preventDefault();
      }
    });

    this.rootEl.addEventListener('pointerup', (e) => {
      this.cancelLongPress();

      if (this.isSelecting) {
        this.finishSelectionGesture();
        return;
      }

      const gesture = this.gesture;
      this.gesture = null;
      this.pointerStart = null;
      if (!gesture) return;

      // Ignore taps on footnote links
      const target = e.target as HTMLElement | null;
      const fnLink = target?.closest<HTMLElement>('[data-fn]');
      if (fnLink && !gesture.dragging) {
        e.preventDefault();
        const fnId = fnLink.getAttribute('data-fn');
        if (fnId) this.openFootnote(fnId);
        return;
      }

      if (gesture.dragging) {
        this.dragSamples.push({ x: e.clientX, t: performance.now() });
        this.paginator.endDrag(e.clientX - gesture.startX, this.releaseVelocity(), () =>
          this.emitPosition(),
        );
        return;
      }

      const absX = Math.abs(e.clientX - gesture.startX);
      const absY = Math.abs(e.clientY - gesture.startY);

      if (this.hadSelectionOnDown || hasNonCollapsedSelection()) {
        // Dismiss active selection cleanly without turning the page or toggling HUD.
        if (absX <= DRAG_START_PX && absY <= DRAG_START_PX) {
          this.clearSelection();
          postToHost({ type: 'selection', selection: null });
        } else {
          const selection = extractSelectionInfo();
          if (selection) {
            postToHost({ type: 'selection', selection });
          }
        }
        return;
      }

      if (absX <= DRAG_START_PX && absY <= DRAG_START_PX) {
        const hitHl = this.paginator.hitTestHighlight(e.clientX, e.clientY);
        if (hitHl) {
          postToHost({ type: 'highlight-tap', highlightId: hitHl.highlight.id, rect: hitHl.rect });
          return;
        }
        this.handleTap();
      }
    });

    this.rootEl.addEventListener('pointercancel', () => {
      this.cancelLongPress();
      this.pointerStart = null;
      this.gesture = null;
      this.paginator.cancelDrag();
      this.finishSelectionGesture();
    });

    // Why (product, F17): Android can end a touch without a matching pointerup when the
    // selection magnifier takes the pointer, which would leave `isSelecting` stuck on.
    window.addEventListener('touchend', () => {
      this.cancelLongPress();
      this.finishSelectionGesture();
    });

    window.addEventListener('touchcancel', () => {
      this.cancelLongPress();
      this.pointerStart = null;
      this.gesture = null;
      this.paginator.cancelDrag();
      this.finishSelectionGesture();
    });

    this.rootEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const fnLink = target?.closest<HTMLElement>('[data-fn]');
      if (fnLink) {
        e.preventDefault();
      }
    });

    this.footnoteCloseBtn.addEventListener('click', () => this.closeFootnote());
    this.footnoteBackdrop.addEventListener('click', (e) => {
      if (e.target === this.footnoteBackdrop) {
        this.closeFootnote();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.footnoteBackdrop.hidden && e.key === 'Escape') {
        this.closeFootnote();
        return;
      }
      const dir = this.paginator.getDirection();
      if (e.key === 'ArrowLeft') {
        if (dir === 'rtl') this.goNext();
        else this.goPrev();
      } else if (e.key === 'ArrowRight') {
        if (dir === 'rtl') this.goPrev();
        else this.goNext();
      } else if (e.key === 'PageDown') {
        this.goNext();
      } else if (e.key === 'PageUp') {
        this.goPrev();
      }
    });

    const observer = new ResizeObserver(() => {
      if (this.resizeTimer !== null) {
        window.clearTimeout(this.resizeTimer);
      }
      this.resizeTimer = window.setTimeout(() => {
        this.resizeTimer = null;
        if (this.paginator.handleViewportResize()) {
          this.emitPositionAndToc();
          this.paginator.startExactPagination();
        }
      }, 30);
    });
    observer.observe(this.rootEl);

    document.fonts?.addEventListener?.('loadingdone', () => {
      if (this.paginator.handleFontLoad()) {
        this.emitPositionAndToc();
      }
      this.logFontStatus();
    });
  }

  private logFontStatus(): void {
    const fonts = document.fonts;
    if (!fonts) return;
    const loadedFamilies: string[] = [];
    fonts.forEach((face) => {
      if (face.status === 'loaded' && !loadedFamilies.includes(face.family)) {
        loadedFamilies.push(face.family);
      }
    });
    console.info(
      `[rewiaty-fonts] amiri=${fonts.check('16px "Amiri"')} loaded=${loadedFamilies.join(',')}`,
    );
  }

  private applyFontFaces(fontBaseUrl?: string): void {
    const trimmed = fontBaseUrl?.trim() ?? '';
    if (!trimmed || trimmed === this.appliedFontBaseUrl) return;
    const css = buildFontFaceCss(trimmed);
    if (!css) return;

    if (!this.fontStyleEl) {
      this.fontStyleEl = document.getElementById('rewiaty-font-faces') as HTMLStyleElement | null;
      if (!this.fontStyleEl) {
        this.fontStyleEl = document.createElement('style');
        this.fontStyleEl.id = 'rewiaty-font-faces';
        document.head.appendChild(this.fontStyleEl);
      }
    }
    this.fontStyleEl.textContent = css;
    this.appliedFontBaseUrl = trimmed;
  }

  private handleMessage(msg: RNToWebMessage): void {
    switch (msg.type) {
      case 'load': {
        this.book = msg.book;
        if (msg.fontBaseUrl) {
          this.applyFontFaces(msg.fontBaseUrl);
        }
        const merged: ReaderSettings = {
          ...DEFAULT_SETTINGS,
          lineHeight: msg.book.meta.dir === 'ltr' ? 1.7 : 1.95,
          ...(msg.settings ?? {}),
        };
        this.clearSelection();
        this.closeFootnote();
        this.gesture = null;
        this.paginator.cancelDrag();
        this.awaitingExactPosition = true;
        this.paginator.setBook(msg.book, merged, msg.anchor, msg.insets, msg.highlights);
        postToHost({ type: 'ready' });
        this.paginator.scheduleBackgroundWork();
        this.emitAfterSettle();
        break;
      }
      case 'fonts': {
        this.applyFontFaces(msg.fontBaseUrl);
        if (this.paginator.handleFontLoad()) {
          this.emitPositionAndToc();
          this.paginator.startExactPagination();
        }
        break;
      }
      case 'settings': {
        const partial = msg.partial ?? {};
        this.paginator.updateSettings(partial, msg.insets);
        this.emitPositionAndToc();
        // Re-count the book for the new typography so the page numbers converge on the
        // real ones (the first report above is allowed to be an estimate).
        this.paginator.startExactPagination();
        if (partial.fontFamily !== undefined) {
          void document.fonts?.ready?.then(() => this.logFontStatus());
        }
        break;
      }
      case 'goto': {
        this.clearSelection();
        this.closeFootnote();
        if (this.paginator.goto(msg)) {
          this.emitPosition();
        }
        break;
      }
      case 'next': {
        this.clearSelection();
        this.goNext();
        break;
      }
      case 'prev': {
        this.clearSelection();
        this.goPrev();
        break;
      }
      case 'suppress-taps': {
        const duration =
          typeof msg.durationMs === 'number' && Number.isFinite(msg.durationMs)
            ? Math.max(0, msg.durationMs)
            : 0;
        this.suppressTapUntil = Date.now() + duration;
        break;
      }
      case 'highlights': {
        this.paginator.setHighlights(msg.highlights ?? []);
        break;
      }
      case 'clear-selection': {
        this.clearSelection();
        break;
      }
    }
  }

  private finishSelectionGesture(): void {
    if (!this.isSelecting) return;
    this.isSelecting = false;
    this.selectionAnchor = null;
    this.pointerStart = null;
    const selection = extractSelectionInfo();
    if (!selection) {
      this.rootEl.classList.remove('is-selecting');
    }
    postToHost({ type: 'selection', selection });
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private clearSelection(): void {
    this.cancelLongPress();
    this.isSelecting = false;
    this.selectionAnchor = null;
    clearDomSelection();
    this.rootEl.classList.remove('is-selecting');
  }

  private goNext(): void {
    if (this.paginator.nextPage()) {
      this.emitPosition();
    }
  }

  private goPrev(): void {
    if (this.paginator.prevPage()) {
      this.emitPosition();
    }
  }

  private handleTap(): void {
    if (Date.now() < this.suppressTapUntil) {
      return;
    }
    // Why (product, R5/A4): edges no longer turn pages. Every tap is a centre tap that
    // shows or hides the bars; page turns are made with the finger.
    postToHost({ type: 'tap', zone: 'center' });
  }

  /** Horizontal velocity (px/ms) of the last `VELOCITY_WINDOW_MS` of the gesture. */
  private releaseVelocity(): number {
    const samples = this.dragSamples;
    const last = samples[samples.length - 1];
    if (!last || samples.length < 2) return 0;
    let first = samples[0]!;
    for (let i = samples.length - 1; i >= 0; i--) {
      const sample = samples[i]!;
      if (last.t - sample.t > VELOCITY_WINDOW_MS) {
        first = samples[i + 1] ?? sample;
        break;
      }
      first = sample;
    }
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return (last.x - first.x) / dt;
  }

  private emitPosition(): void {
    const pos = this.paginator.getPositionSnapshot();
    if (!pos) return;
    // A number is on screen now; stop withholding the rest of the session's reports.
    this.awaitingExactPosition = false;
    postToHost({
      type: 'position',
      ...pos,
    });
  }

  private emitToc(): void {
    const chapters = this.paginator.getTocEntries();
    if (chapters.length > 0) {
      postToHost({ type: 'toc', chapters });
    }
  }

  private emitPositionAndToc(): void {
    // The first page number of a book waits for the exact page map (see `emitAfterSettle`),
    // so the reader never watches "صفحة 9 من 43" turn into "من 78".
    if (this.awaitingExactPosition) {
      if (this.paginator.isPageMapExact()) {
        this.awaitingExactPosition = false;
      } else {
        this.emitToc();
        return;
      }
    }
    this.emitPosition();
    this.emitToc();
  }

  /**
   * Report the first position only once the layout has had a frame to settle.
   *
   * `setBook` measures against the face available at that instant. If the host paints
   * a webfont a moment later the text reflows, and the first number the reader saw was
   * computed from the wrong metrics — the root of "page 3 of 6" becoming "page 3 of 5".
   * Fonts are awaited (bounded, so a slow face cannot hold the reader on an empty
   * page), then the mounted chapters are re-measured and only then reported.
   */
  private emitAfterSettle(): void {
    const token = ++this.settleToken;
    const startedAt = Date.now();
    const fonts = document.fonts;

    const flush = () => {
      if (token !== this.settleToken) return;
      this.paginator.settleLayout();
      this.emitPositionAndToc();
      if (this.awaitingExactPosition) {
        window.setTimeout(() => {
          if (token !== this.settleToken || !this.awaitingExactPosition) return;
          this.awaitingExactPosition = false;
          this.emitPositionAndToc();
        }, EXACT_POSITION_MAX_WAIT_MS);
      }
    };

    const attempt = () => {
      if (token !== this.settleToken) return;
      // `fonts.ready` only covers the loads that were pending when it was awaited. A
      // face requested by the first layout can still be fetching, and measuring now
      // pins page counts to the fallback metrics — the exact numbers the reader would
      // then watch change. Wait for the faces to land (bounded) before quoting anything.
      const stillFetching = fonts?.status === 'loading';
      if (
        stillFetching &&
        Date.now() - startedAt < SETTLE_MAX_WAIT_MS + SETTLE_FONT_GRACE_MS
      ) {
        window.setTimeout(attempt, SETTLE_POLL_MS);
        return;
      }
      window.requestAnimationFrame(flush);
    };

    const bounded = new Promise<void>((resolve) => {
      window.setTimeout(resolve, SETTLE_MAX_WAIT_MS);
    });
    const fontsReady: Promise<void> = fonts?.ready ? fonts.ready.then(() => undefined) : Promise.resolve();
    void Promise.race([fontsReady, bounded]).then(attempt);
  }

  private openFootnote(fnId: string): void {
    const blocks: Block[] | undefined = this.book?.footnotes[fnId];
    if (!blocks || blocks.length === 0) return;
    const dir = this.paginator.getDirection();
    this.footnoteBackdrop.setAttribute('dir', dir);
    this.footnoteTitle.textContent = dir === 'rtl' ? `حاشية [${fnId}]` : `Footnote [${fnId}]`;
    this.footnoteBody.innerHTML = blocks.map((b) => `<p>${b.html}</p>`).join('');
    this.footnoteBackdrop.hidden = false;
  }

  private closeFootnote(): void {
    this.footnoteBackdrop.hidden = true;
  }
}

new ReaderEngine();
