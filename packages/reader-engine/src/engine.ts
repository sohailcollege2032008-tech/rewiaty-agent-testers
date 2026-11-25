import type { Block, Book } from '@rewiaty/book-format';
import { postToHost, subscribeHostMessages } from './bridge.js';
import { buildFontFaceCss } from './fonts.js';
import { Paginator } from './paginator.js';
import { DEFAULT_SETTINGS, type ReaderSettings, type RNToWebMessage, type TapZone } from './types.js';

const TAP_MAX_MOVEMENT_PX = 14;
const SWIPE_MIN_DISTANCE_PX = 40;
const LEFT_ZONE_RATIO = 0.3;
const RIGHT_ZONE_RATIO = 0.7;
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
  private resizeTimer: number | null = null;
  private fontStyleEl: HTMLStyleElement | null = null;
  private appliedFontBaseUrl = '';
  /** Bumped on every `load`, so a settle pass for an old book can't report over a new one. */
  private settleToken = 0;
  private suppressTapUntil = 0;
  /**
   * Pointer id of the gesture that opened the footnote popover.
   *
   * Why (bug): the popover opens on `pointerup`, so the `click` the browser synthesises for
   * that same tap is dispatched *after* the backdrop is already on screen. When the tap point
   * sits above the sheet panel (anything in the top ~55% of the page), the browser hit-tests
   * that trailing click against the backdrop and it closed the popover in the same gesture
   * (CI runs 45654469093, 45661209279, 45668376498). The fix is to remember which pointer
   * opened the sheet and drop exactly that click. No timer: a stale id can never swallow a
   * real dismiss, because any new gesture starts with a fresh `pointerdown` that clears it.
   */
  private footnoteOpenPointerId: number | null = null;

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
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    });

    this.rootEl.addEventListener('pointerup', (e) => {
      if (!this.pointerStart) return;
      const start = this.pointerStart;
      this.pointerStart = null;

      // Ignore taps on footnote links
      const target = e.target as HTMLElement | null;
      const fnLink = target?.closest<HTMLElement>('[data-fn]');
      if (fnLink) {
        e.preventDefault();
        const fnId = fnLink.getAttribute('data-fn');
        if (fnId) {
          // The click that follows this pointerup belongs to the same gesture: opening the
          // sheet must not also dismiss it. See footnoteOpenPointerId.
          this.footnoteOpenPointerId = e.pointerId;
          this.openFootnote(fnId);
        }
        return;
      }

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (absX >= SWIPE_MIN_DISTANCE_PX && absX > absY * 1.2) {
        this.handleSwipe(dx);
        return;
      }

      if (absX <= TAP_MAX_MOVEMENT_PX && absY <= TAP_MAX_MOVEMENT_PX) {
        this.handleTap(e.clientX);
      }
    });

    this.rootEl.addEventListener('pointercancel', () => {
      this.pointerStart = null;
    });

    this.rootEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      const fnLink = target?.closest<HTMLElement>('[data-fn]');
      if (fnLink) {
        e.preventDefault();
      }
    });

    this.footnoteCloseBtn.addEventListener('click', () => this.closeFootnote());
    // A fresh gesture that starts on the backdrop is a real dismiss request; whatever click it
    // produces is not the tail of the opening tap.
    this.footnoteBackdrop.addEventListener('pointerdown', () => {
      this.footnoteOpenPointerId = null;
    });
    this.footnoteBackdrop.addEventListener('click', (e) => {
      const pointerId = (e as PointerEvent).pointerId;
      if (
        this.footnoteOpenPointerId !== null &&
        (pointerId === undefined || pointerId === this.footnoteOpenPointerId)
      ) {
        // The click synthesised right after the opening pointerup, not a user dismiss.
        this.footnoteOpenPointerId = null;
        return;
      }
      this.footnoteOpenPointerId = null;
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
        this.closeFootnote();
        this.paginator.setBook(msg.book, merged, msg.anchor, msg.insets);
        postToHost({ type: 'ready' });
        this.paginator.scheduleBackgroundWork();
        this.emitAfterSettle();
        break;
      }
      case 'fonts': {
        this.applyFontFaces(msg.fontBaseUrl);
        if (this.paginator.handleFontLoad()) {
          this.emitPositionAndToc();
        }
        break;
      }
      case 'settings': {
        const partial = msg.partial ?? {};
        this.paginator.updateSettings(partial, msg.insets);
        this.emitPositionAndToc();
        if (partial.fontFamily !== undefined) {
          void document.fonts?.ready?.then(() => this.logFontStatus());
        }
        break;
      }
      case 'goto': {
        this.closeFootnote();
        if (this.paginator.goto(msg)) {
          this.emitPosition();
        }
        break;
      }
      case 'next': {
        this.goNext();
        break;
      }
      case 'prev': {
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
    }
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

  private handleTap(clientX: number): void {
    if (Date.now() < this.suppressTapUntil) {
      return;
    }
    const rect = this.rootEl.getBoundingClientRect();
    const width = rect.width || window.innerWidth || 1;
    const ratio = (clientX - rect.left) / width;
    const dir = this.paginator.getDirection();

    let zone: TapZone;
    if (ratio < LEFT_ZONE_RATIO) {
      zone = dir === 'rtl' ? 'next' : 'prev';
    } else if (ratio > RIGHT_ZONE_RATIO) {
      zone = dir === 'rtl' ? 'prev' : 'next';
    } else {
      zone = 'center';
    }

    postToHost({ type: 'tap', zone });
    if (zone === 'next') {
      this.goNext();
    } else if (zone === 'prev') {
      this.goPrev();
    }
  }

  private handleSwipe(dx: number): void {
    const dir = this.paginator.getDirection();
    // LTR: swipe left (dx < 0) => next; RTL: swipe right (dx > 0) => next
    const isNext = dir === 'rtl' ? dx > 0 : dx < 0;
    if (isNext) {
      this.goNext();
    } else {
      this.goPrev();
    }
  }

  private emitPosition(): void {
    const pos = this.paginator.getPositionSnapshot();
    if (!pos) return;
    postToHost({
      type: 'position',
      ...pos,
    });
  }

  private emitPositionAndToc(): void {
    this.emitPosition();
    const chapters = this.paginator.getTocEntries();
    if (chapters.length > 0) {
      postToHost({ type: 'toc', chapters });
    }
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
