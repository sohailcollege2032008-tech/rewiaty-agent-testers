import type { Block, Book } from '@rewiaty/book-format';
import { postToHost, subscribeHostMessages } from './bridge.js';
import { buildFontFaceCss } from './fonts.js';
import { Paginator } from './paginator.js';
import { DEFAULT_SETTINGS, type ReaderSettings, type RNToWebMessage, type TapZone } from './types.js';

const TAP_MAX_MOVEMENT_PX = 14;
const SWIPE_MIN_DISTANCE_PX = 40;
const LEFT_ZONE_RATIO = 0.3;
const RIGHT_ZONE_RATIO = 0.7;

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
        if (fnId) this.openFootnote(fnId);
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
        }
      }, 30);
    });
    observer.observe(this.stageEl);

    document.fonts?.addEventListener?.('loadingdone', () => {
      if (this.paginator.handleFontLoad()) {
        this.emitPositionAndToc();
      }
    });
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
        this.paginator.setBook(msg.book, merged, msg.anchor);
        postToHost({ type: 'ready' });
        this.emitPositionAndToc();
        this.paginator.scheduleBackgroundWork();
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
        this.paginator.updateSettings(partial);
        this.emitPositionAndToc();
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
