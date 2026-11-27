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
import { ScenePromptEditor } from './scene-placeholder.js';
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
/**
 * How long the image proof keeps re-reading the mounted figures before it gives up and reports
 * `count: 0`. Long enough for a `file://` figure on a cold emulator, short enough that a journey
 * waiting on `reader-image-error` is not left hanging.
 */
const IMAGE_PROOF_POLL_MS = 120;
const IMAGE_PROOF_MAX_TRIES = 25;
/**
 * Slow tail of the same loop, for a cold emulator where a `file://` figure can take seconds to
 * decode. Kept slower than the fast window so a book without figures costs almost nothing.
 */
const IMAGE_PROOF_SLOW_MS = 500;
const IMAGE_PROOF_SLOW_TRIES = 20;
/**
 * Extra looks granted when the mounted pages hold no figure at all. A `goto` can report before the
 * target chapter is attached, and one more frame is all that separates "no figure here" from
 * "the figure is about to appear".
 */
const IMAGE_PROOF_EMPTY_CHECKS = 5;
/**
 * Quiet window (ms) after the last scroll event before the reading line is read. Below this
 * a finger is still moving; above it the reader has stopped and the position is worth sending.
 */
const SCROLL_SETTLE_MS = 100;

export class ReaderEngine {
  private readonly rootEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly trackEl: HTMLElement;
  private readonly footnoteBackdrop: HTMLElement;
  private readonly footnotePopover: HTMLElement;
  private readonly footnoteTitle: HTMLElement;
  private readonly footnoteBody: HTMLElement;
  private readonly footnoteCloseBtn: HTMLElement;
  /** Visually hidden live region that announces settled page turns to TalkBack/VoiceOver. */
  private readonly liveRegion: HTMLElement;

  private readonly paginator: Paginator;
  /** F46 — the structured prompt editor, mounted on #reader-root (never in the page flow). */
  private readonly sceneEditor: ScenePromptEditor;
  private book: Book | null = null;
  private pointerStart: { x: number; y: number; time: number } | null = null;
  private longPressTimer: number | null = null;
  private isSelecting = false;
  private selectionAnchor: SelectionWordAnchor | null = null;
  private hadSelectionOnDown = false;
  private gesture: {
    pointerId: number;
    /**
     * What the finger actually landed on, captured at `pointerdown`.
     *
     * Why (bug, found after R5): `pointerdown` calls `setPointerCapture` on the reader root, so
     * every later pointer event of that gesture — `pointerup` included — is retargeted to the
     * root. Reading `e.target` at `pointerup` therefore never sees the footnote link any more,
     * and a real touch stopped opening the sheet at all. (Measured with a real touch on the
     * merged tree: `pointerdown target=a.fn-ref` → `pointerup target=div#reader-root`.) The
     * landing element is only trustworthy at pointerdown, so that is where it is kept.
     */
    downTarget: EventTarget | null;
    startX: number;
    startY: number;
    lastX: number;
    dragging: boolean;
  } | null = null;
  private dragSamples: Array<{ x: number; t: number }> = [];
  private resizeTimer: number | null = null;
  private imageSettleTimer: number | null = null;
  /** Re-report scheduled once a figure is proven painted (see `reportAfterFigureProof`). */
  private imageProofSettleTimer: number | null = null;
  private imageProofTimer: number | null = null;
  private imageProofTries = 0;
  private imageProofEmptyChecks = 0;
  /** Last box reported for the current book, so the pump cannot spam the host. */
  private imageProofSignature = '';
  /** One-line account of the last measurement, quoted in the page when there is nothing painted. */
  private imageProofDetail = '';
  /** Debounce for the post-scroll position report (scroll mode only). */
  private scrollSettleTimer: number | null = null;
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
  /** Element that had focus when the footnote dialog opened; restored when it closes. */
  private footnoteReturnFocus: HTMLElement | null = null;
  /**
   * Last page announced through `#reader-live-region`. Background pagination re-emits the same
   * position many times while it measures; deduping keeps TalkBack from repeating the page.
   */
  private lastAnnouncedPage = '';
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
    this.footnotePopover = document.getElementById('footnote-popover')!;
    this.footnoteTitle = document.getElementById('footnote-title')!;
    this.footnoteBody = document.getElementById('footnote-body')!;
    this.footnoteCloseBtn = document.getElementById('footnote-close')!;
    this.liveRegion = document.getElementById('reader-live-region')!;

    this.paginator = new Paginator(this.rootEl, this.stageEl, this.trackEl, DEFAULT_SETTINGS, {
      onBackgroundProgress: () => {
        this.emitPositionAndToc();
        this.scheduleImageProof();
      },
      onChapterLayoutComplete: (chapterId) => {
        postToHost({ type: 'layout-complete', chapterId });
        this.scheduleImageProof();
      },
      onExactPagination: () => this.emitPositionAndToc(),
      // F33 — the reading focus is derived from geometry, never from a stored toggle, so every
      // page turn / scroll settle / settings change re-reports it to the host.
      onReadingFocus: (report) => postToHost({ type: 'reading-focus', ...report }),
    });

    this.sceneEditor = new ScenePromptEditor(this.rootEl);

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
      // F46: a scene frame and its prompt editor own every touch that lands on them.
      // Without this the button tap would also become a page-centre tap (`tap` → HUD)
      // or start a text selection behind the control. Same idea as `[data-fn]` below.
      if (this.closestSceneInteractive(e.target)) {
        this.cancelLongPress();
        this.gesture = null;
        this.pointerStart = null;
        return;
      }
      this.cancelLongPress();
      this.hadSelectionOnDown = hasNonCollapsedSelection();
      this.isSelecting = false;
      this.selectionAnchor = null;
      this.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      this.gesture = {
        pointerId: e.pointerId,
        downTarget: e.target,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        dragging: false,
      };
      this.dragSamples = [{ x: e.clientX, t: performance.now() }];
      // Why (F22): in scroll mode the finger owns the vertical axis. Capturing the pointer
      // would keep the browser's native scroller from seeing the move, so a real drag would
      // never scroll the chapter stack.
      if (!this.paginator.isScrollMode()) {
        try {
          this.rootEl.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic pointer events (tests) have no capturable pointer id.
        }
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

      // Why (F22): there is no page to drag in scroll mode — vertical movement is the
      // browser's scroll. Bailing before the gesture bookkeeping keeps `beginDrag` from
      // ever firing, so the tap/selection paths stay untouched.
      if (this.paginator.isScrollMode()) return;

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

      // Ignore taps on footnote links. The element has to come from the gesture's own landing
      // target: pointer capture retargets this event to the root (see gesture.downTarget).
      const target = (gesture.downTarget ?? e.target) as HTMLElement | null;
      const fnLink = target?.closest?.<HTMLElement>('[data-fn]') ?? null;
      if (fnLink && !gesture.dragging) {
        e.preventDefault();
        const fnId = fnLink.getAttribute('data-fn');
        if (fnId) {
          // The click that follows this pointerup belongs to the same gesture: opening the
          // sheet must not also dismiss it. See footnoteOpenPointerId.
          this.footnoteOpenPointerId = e.pointerId;
          this.openFootnote(fnId, fnLink);
        }
        return;
      }

      if (gesture.dragging) {
        this.dragSamples.push({ x: e.clientX, t: performance.now() });
        this.paginator.endDrag(e.clientX - gesture.startX, this.releaseVelocity(), () =>
          this.emitPosition(true),
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
          const selection = extractSelectionInfo((el, offset) =>
            this.paginator.toOriginalOffsetInBlock(el, offset),
          );
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

      // F46: scene controls are ordinary buttons in the page; handle them here so the
      // paginator never sees their gestures (see the pointerdown guard above).
      const sceneAction = target?.closest<HTMLElement>('[data-scene-action]');
      if (sceneAction) {
        e.preventDefault();
        this.handleSceneAction(sceneAction);
        return;
      }

      const promptEditor = target?.closest<HTMLElement>('[data-scene-prompt-editor]');
      if (promptEditor) {
        e.preventDefault();
        // Only the backdrop itself dismisses; a click inside the panel is a form control.
        if (target === promptEditor) this.closeScenePromptEditor();
        return;
      }

      const fnLink = target?.closest<HTMLElement>('[data-fn]');
      if (fnLink) {
        e.preventDefault();
        // Assistive tech (TalkBack's double-tap, Switch Access) activates a control with a
        // plain `click` and no pointer gesture. The pointer path already opened the sheet, so
        // only a click that finds it closed has to open it here.
        if (this.footnoteBackdrop.hidden) {
          const fnId = fnLink.getAttribute('data-fn');
          if (fnId) this.openFootnote(fnId, fnLink);
        }
        return;
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
      // The prompt editor is a form. While it is open every key belongs to it (caret
      // movement, panel scroll), so none of the reader's page shortcuts may run.
      if (this.sceneEditor.isOpen()) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeScenePromptEditor();
        }
        return;
      }

      // Issue #50 (QA r1): a footnote reference is a `role="button"`; it has to answer the
      // keyboard like one. Enter/Space open the sheet, and the opener is remembered so closing
      // puts the caret back on that reference (also when the sheet was opened by touch).
      const keyTarget = e.target as HTMLElement | null;
      const keyFnRef = keyTarget?.closest?.<HTMLElement>('[data-fn]') ?? null;
      if (keyFnRef && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
        e.preventDefault();
        const fnId = keyFnRef.getAttribute('data-fn');
        if (fnId && this.footnoteBackdrop.hidden) this.openFootnote(fnId, keyFnRef);
        return;
      }

      if (!this.footnoteBackdrop.hidden) {
        if (e.key === 'Escape') {
          this.closeFootnote();
          return;
        }
        if (e.key === 'Tab') {
          this.trapFootnoteFocus(e);
          return;
        }
        // A modal dialog owns the keyboard: no page shortcut may run behind it.
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

    // `load` does not bubble but capture catches it for every image inserted later. A figure
    // landing after the first measurement changes the chapter height, so remeasure and re-report.
    //
    // Capture on the container is a *convenience*, not the contract: Android WebView can insert
    // an `<img>` that is already decoded (Chromium starts fetching on `src` assignment, and a
    // detached element can finish before it is appended), in which case the browser dispatches
    // **no** `load` at insertion. Relying on the event alone meant the on-device proof never
    // arrived while the figure was plainly painted on screen (CI run 45687065853). The pump in
    // `scheduleImageProof()` reads the DOM instead, so it cannot miss that case.
    this.trackEl.addEventListener('load', this.handleImageLoad, true);
    this.trackEl.addEventListener('error', this.handleImageError, true);

    // Why (F22): in scroll mode the stage is the scroller, so the progress bar has to follow
    // `scrollTop` on every frame while the position is only worth reporting once the finger
    // stops. Both are coalesced here: rAF for the paint, a quiet window for the message.
    this.stageEl.addEventListener(
      'scroll',
      () => {
        if (!this.paginator.isScrollMode()) return;
        this.paginator.handleScrollFrame();
        if (this.scrollSettleTimer !== null) {
          window.clearTimeout(this.scrollSettleTimer);
        }
        this.scrollSettleTimer = window.setTimeout(() => {
          this.scrollSettleTimer = null;
          if (!this.paginator.isScrollMode()) return;
          this.paginator.handleScrollSettled();
          this.emitPosition();
        }, SCROLL_SETTLE_MS);
      },
      { passive: true },
    );

    document.fonts?.addEventListener?.('loadingdone', () => {
      if (this.paginator.handleFontLoad()) {
        this.emitPositionAndToc();
      }
      this.logFontStatus();
    });
  }

  private readonly handleImageLoad = (event: Event): void => {
    if (!(event.target instanceof HTMLImageElement)) return;
    if (this.imageSettleTimer !== null) window.clearTimeout(this.imageSettleTimer);
    this.imageSettleTimer = window.setTimeout(() => {
      this.imageSettleTimer = null;
      if (this.paginator.settleLayout()) this.emitPositionAndToc();
      this.scheduleImageProof();
    }, 60);
  };

  /**
   * A figure failed to decode. It is still *mounted*, which is what the negative control needs:
   * the host must be told `count: 0` so a broken image is distinguishable from "no image here".
   */
  private readonly handleImageError = (event: Event): void => {
    if (!(event.target instanceof HTMLImageElement)) return;
    this.scheduleImageProof();
  };

  /** A new book starts with no figure reported, so the same box can be reported again. */
  private resetImageProof(): void {
    if (this.imageProofTimer !== null) {
      window.clearTimeout(this.imageProofTimer);
      this.imageProofTimer = null;
    }
    if (this.imageProofSettleTimer !== null) {
      window.clearTimeout(this.imageProofSettleTimer);
      this.imageProofSettleTimer = null;
    }
    this.imageProofTries = 0;
    this.imageProofEmptyChecks = 0;
    this.imageProofSignature = '';
    for (const id of ['reader-image-proof', 'reader-image-error', 'reader-image-probe']) {
      document.getElementById(id)?.remove();
    }
  }

  /**
   * Start (or keep) looking for a figure that has painted.
   *
   * Deliberately DOM-driven: a mounted `<img>` that is `complete` *without* a `load` event
   * (already decoded before insertion) is the normal case on Android, so the engine measures
   * the track on a short bounded loop instead of waiting to be told.
   */
  private scheduleImageProof(): void {
    if (this.imageProofTimer !== null) return;
    this.stepImageProof();
  }

  private stepImageProof(): void {
    this.imageProofTimer = null;
    const mounted = this.paginator.getImages();
    if (mounted.length === 0) {
      // No figure on the mounted pages yet. Nothing to prove and nothing to fail, but the chapter
      // holding one may be attached a frame later, so grant a few quick re-checks first.
      this.imageProofTries = 0;
      this.imageProofEmptyChecks += 1;
      if (this.imageProofEmptyChecks > IMAGE_PROOF_EMPTY_CHECKS) {
        this.imageProofEmptyChecks = 0;
        return;
      }
      this.imageProofTimer = window.setTimeout(() => this.stepImageProof(), IMAGE_PROOF_POLL_MS);
      return;
    }
    this.imageProofEmptyChecks = 0;

    const report = this.paginator.measureImages();
    this.imageProofDetail = this.describeImages(mounted, report.rendered);
    this.writeImageProbe();

    // A decoded figure with a real box is the proof. A decoded figure with no box is not: the
    // reader cannot see it, so it keeps counting as "not painted" until the window ends.
    if (report.rendered > 0 && report.width > 0 && report.height > 0) {
      this.imageProofTries = 0;
      this.postImageProof(report.rendered, report.width, report.height);
      return;
    }

    // Every mounted figure has finished loading and none of them produced pixels: that is a
    // broken image, reported as count 0 rather than staying silent.
    const decided =
      report.rendered === 0 &&
      mounted.every((img) => img.complete && (img.getAttribute('src') ?? '') !== '');
    if (decided) {
      this.imageProofTries = 0;
      this.postImageProof(0, 0, 0);
      return;
    }

    this.imageProofTries += 1;
    if (this.imageProofTries > IMAGE_PROOF_MAX_TRIES + IMAGE_PROOF_SLOW_TRIES) {
      // A figure is mounted and none ever produced a box. Say so instead of going quiet: the host
      // turns this into a visible error, so "mounted but painted nothing" is never mistaken for
      // "nothing to report" (the negative control depends on that difference).
      this.imageProofTries = 0;
      this.postImageProof(0, 0, 0);
      return;
    }
    const delay =
      this.imageProofTries > IMAGE_PROOF_MAX_TRIES ? IMAGE_PROOF_SLOW_MS : IMAGE_PROOF_POLL_MS;
    this.imageProofTimer = window.setTimeout(() => this.stepImageProof(), delay);
  }

  /**
   * Write the measurement into the page as text.
   *
   * Why (tech): a release WebView forwards neither its console to logcat nor a page exception, so a
   * silent proof could only be guessed at from outside — and a `console.log` bridge produced zero
   * lines on device (CI run 45701668793). DOM *text* is exposed to the accessibility tree (the
   * figure's own alt text is, in `hierarchy-import-epub.xml`), so this line is readable both by
   * Maestro and from an evidence dump.
   */
  private writeImageProbe(): void {
    // Once an outcome has been reported, more counters would only talk over it.
    if (this.imageProofSignature !== '') return;
    this.pageMarker('reader-image-probe', `reader-image-probe step=${this.imageProofTries} ${this.imageProofDetail}`);
  }

  /** What was mounted and what it measured, in words a dumped hierarchy can be read from. */
  private describeImages(mounted: HTMLImageElement[], rendered: number): string {
    const first = mounted[0];
    const rect = first ? first.getBoundingClientRect() : null;
    const detail = first
      ? `complete=${first.complete ? 1 : 0} nw=${first.naturalWidth} box=${Math.round(rect!.width)}x${Math.round(rect!.height)}`
      : 'none';
    return `mounted=${mounted.length} rendered=${rendered} ${detail}`;
  }

  /** TEMP: a bottom-strip text node, transparent so the reader sees nothing. */
  private pageMarker(id: string, text: string): void {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText =
        // Mid-page, not on the bottom edge: the app lays its own footer over the bottom of the
        // WebView, and a marker hidden behind it would look like a failure it is not.
        'position:fixed;left:0;top:50%;width:100%;height:14px;overflow:hidden;white-space:nowrap;font-size:11px;line-height:14px;color:rgba(0,0,0,0);pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  /**
   * The outcome the journey asserts, written into the page itself.
   *
   * It lives in the page (not only in the app) because the page is the surface being proven, and
   * because the accessibility tree exposes DOM text — which is how a device run can tell "the page
   * measured a painted figure" apart from "the bridge lost the message".
   */
  private writeOutcomeMarker(count: number, width: number, height: number): void {
    const painted = count > 0 && width > 0 && height > 0;
    const other = painted ? 'reader-image-error' : 'reader-image-proof';
    document.getElementById(other)?.remove();
    // The step-by-step probe has done its job once there is an answer; keeping it would leave a
    // screen reader reading diagnostic counters over the page.
    document.getElementById('reader-image-probe')?.remove();
    this.pageMarker(
      painted ? 'reader-image-proof' : 'reader-image-error',
      painted
        ? `reader-image-proof ${width}x${height}`
        : // Say *why* nothing is painted. `mounted=1 rendered=0 nw=0` is a figure the reader
          // cannot see; an empty error line would leave that to be guessed at.
          `reader-image-error ${this.imageProofDetail}`,
    );
  }

  /** Tell the host what a figure did: `count` 0 means a figure was mounted but painted nothing. */
  private postImageProof(count: number, width: number, height: number): void {
    const signature = `${count}:${width}:${height}`;
    if (signature === this.imageProofSignature) return;
    this.imageProofSignature = signature;
    this.writeOutcomeMarker(count, width, height);
    postToHost({ type: 'image-rendered', count, width, height });
    if (count > 0 && width > 0 && height > 0) this.reportAfterFigureProof();
  }

  /**
   * Re-measure and re-report the position *after* the painted-figure proof.
   *
   * Why (bug, Issue #47): a figure that decodes after the first measurement changes the height
   * its chapter is measured against, so the page map must be re-derived. `handleImageLoad` does
   * that on a `load` event — but it emits the position *before* the proof, and on Android a
   * data-URL figure is already decoded when it is inserted, so no `load` is dispatched at all
   * (the same reason the proof itself is DOM-driven, see `scheduleImageProof`). The only report
   * then arrives before the figure is proven painted, or not at all, so "the page map after the
   * figure" was a race. With this pass the proof is always followed by a settled position, which
   * is the report the host can key the map it trusts on.
   */
  private reportAfterFigureProof(): void {
    if (this.imageProofSettleTimer !== null) {
      window.clearTimeout(this.imageProofSettleTimer);
    }
    this.imageProofSettleTimer = window.setTimeout(() => {
      this.imageProofSettleTimer = null;
      // The proof read a real box, so layout has already applied; this pass re-derives the page
      // counts from the box the reader will actually see. Report even when the count is
      // unchanged: a figure can move page boundaries without changing the total.
      this.paginator.settleLayout();
      this.emitPositionAndToc();
    }, 0);
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
        this.closeScenePromptEditor();
        this.gesture = null;
        this.paginator.cancelDrag();
        if (this.scrollSettleTimer !== null) {
          window.clearTimeout(this.scrollSettleTimer);
          this.scrollSettleTimer = null;
        }
        this.awaitingExactPosition = true;
        this.resetImageProof();
        // F46: install the scene set BEFORE the book is mounted, so the very first
        // measurement already counts the frames (no post-`ready` page-count correction).
        this.paginator.setScenePlaceholders(
          msg.scenePlaceholders,
          msg.sceneDisplayMode ?? 'expanded',
          false,
        );
        this.paginator.setBook(
          msg.book,
          merged,
          msg.anchor,
          msg.insets,
          msg.highlights,
          msg.chapterId,
        );
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
        if (this.scrollSettleTimer !== null) {
          window.clearTimeout(this.scrollSettleTimer);
          this.scrollSettleTimer = null;
          if (this.paginator.isScrollMode()) {
            this.paginator.handleScrollSettled();
          }
        }
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
          this.emitPosition(true);
          // A TOC jump remounts chapters without a `load`/`error` event when the figure is
          // already decoded, so ask the pump to look at what is on screen now.
          this.scheduleImageProof();
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
      case 'scene-placeholders': {
        this.paginator.setScenePlaceholders(msg.placeholders, msg.displayMode);
        break;
      }
      case 'scene-update': {
        if (msg.placeholder) this.paginator.updateScenePlaceholder(msg.placeholder);
        break;
      }
      case 'scene-display-mode': {
        this.paginator.setSceneDisplayMode(msg.mode);
        break;
      }
    }
  }

  /** F46 — true when a pointer landed on a scene frame or its prompt editor. */
  private closestSceneInteractive(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(el.closest('.scene-placeholder, [data-scene-prompt-editor]'));
  }

  /**
   * F46 — one delegated handler for every `data-scene-action` button.
   *
   * The figure itself never carries behaviour: the prompt and the status always come from
   * the paginator's model, so a re-mounted frame (batch append, reflow) keeps working.
   */
  private handleSceneAction(button: HTMLElement): void {
    const action = button.getAttribute('data-scene-action');
    if (!action) return;

    if (action === 'save-prompt') {
      this.saveScenePrompt();
      return;
    }
    if (action === 'cancel-prompt') {
      this.closeScenePromptEditor();
      return;
    }

    const figure = button.closest<HTMLElement>('figure.scene-placeholder');
    const sceneId =
      figure?.getAttribute('data-scene-id') ?? this.sceneEditor.getSceneId() ?? null;
    if (!sceneId) return;

    const placeholder = this.paginator.getScenePlaceholder(sceneId);
    if (!placeholder) return;

    switch (action) {
      case 'generate': {
        if (placeholder.status === 'queued' || placeholder.status === 'generating') return;
        postToHost({ type: 'scene-generate', sceneId, prompt: placeholder.prompt });
        break;
      }
      case 'edit-prompt': {
        this.sceneEditor.open(placeholder, this.paginator.getDirection());
        break;
      }
      case 'toggle-collapse': {
        const currentlyCollapsed = figure?.getAttribute('data-collapsed') === 'true';
        const collapsed = !currentlyCollapsed;
        this.paginator.setSceneCollapsed(sceneId, collapsed);
        const updated = this.paginator.getScenePlaceholder(sceneId);
        postToHost({
          type: 'scene-toggle-collapse',
          sceneId,
          collapsed: updated?.collapsed ?? collapsed,
        });
        break;
      }
      default:
        break;
    }
  }

  private saveScenePrompt(): void {
    const sceneId = this.sceneEditor.getSceneId();
    if (!sceneId) {
      this.closeScenePromptEditor();
      return;
    }
    const prompt = this.sceneEditor.readPrompt();
    // Local first: the next `✨ ارسم` must use what the reader just typed.
    this.paginator.updateScenePlaceholderPrompt(sceneId, prompt);
    this.closeScenePromptEditor();
    postToHost({ type: 'scene-prompt-edit', sceneId, prompt });
  }

  private closeScenePromptEditor(): void {
    this.sceneEditor.close();
  }

  private finishSelectionGesture(): void {
    if (!this.isSelecting) return;
    this.isSelecting = false;
    this.selectionAnchor = null;
    this.pointerStart = null;
    const selection = extractSelectionInfo((el, offset) =>
      this.paginator.toOriginalOffsetInBlock(el, offset),
    );
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
      this.emitPosition(true);
    }
  }

  private goPrev(): void {
    if (this.paginator.prevPage()) {
      this.emitPosition(true);
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

  private emitPosition(userNavigated = false): void {
    const pos = this.paginator.getPositionSnapshot();
    if (!pos) return;
    // A number is on screen now; stop withholding the rest of the session's reports.
    this.awaitingExactPosition = false;
    this.announcePosition(pos.page, pos.pageCount);
    postToHost({
      type: 'position',
      ...pos,
      ...(userNavigated ? { userNavigated: true } : {}),
    });
  }

  /**
   * Tell assistive tech which page the reader landed on.
   *
   * Called from `emitPosition`, which only fires on a *settled* move (a drag release, a
   * keyboard turn, a goto). Two things keep TalkBack from chattering (Issue #50, QA r1):
   * the page number is the only thing announced — a background pass that refines the
   * *total* never re-announces the same page — and nothing is announced while the finger
   * still owns the drag (the release reports, which is the settled state).
   *
   * The WebView is the single live source; the RN HUD counter must not also carry
   * `accessibilityLiveRegion` or every turn is spoken twice.
   */
  private announcePosition(page: number, pageCount: number): void {
    if (this.paginator.isDragging()) return;
    if (String(page) === this.lastAnnouncedPage) return;
    this.lastAnnouncedPage = String(page);
    this.liveRegion.textContent = `صفحة ${page} من ${pageCount}`;
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
    // Any settled, published state is also a chance that a figure is now on screen. The pump is
    // idempotent (a pending timer short-circuits, a reported box is deduped), so this is the
    // catch-all that makes the proof independent of which callback happened to fire first.
    this.scheduleImageProof();
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
      this.scheduleImageProof();
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

  private openFootnote(fnId: string, opener?: HTMLElement | null): void {
    const blocks: Block[] | undefined = this.book?.footnotes[fnId];
    if (!blocks || blocks.length === 0) return;
    const dir = this.paginator.getDirection();
    this.footnoteBackdrop.setAttribute('dir', dir);
    this.footnoteTitle.textContent = dir === 'rtl' ? `حاشية [${fnId}]` : `Footnote [${fnId}]`;
    this.footnoteBody.innerHTML = blocks.map((b) => `<p>${b.html}</p>`).join('');
    // A dialog is a focus context: remember where the reader was so closing it puts the
    // caret back exactly there (keyboard/Switch Access users otherwise lose their place).
    // The opener is passed explicitly because a touch does not always leave it focused.
    const active = document.activeElement;
    const candidate = opener ?? (active instanceof HTMLElement ? active : null);
    this.footnoteReturnFocus =
      candidate && candidate !== document.body && candidate.isConnected ? candidate : null;
    // The page behind the sheet is not part of the dialog: inert keeps Tab, TalkBack and
    // Switch Access inside `#footnote-popover` until it closes.
    this.stageEl.setAttribute('inert', '');
    this.footnoteBackdrop.hidden = false;
    this.footnoteCloseBtn.focus();
  }

  /** Keep Tab / Shift+Tab cycling inside the open footnote dialog (Issue #50, QA r1). */
  private trapFootnoteFocus(event: KeyboardEvent): void {
    const selector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(this.footnotePopover.querySelectorAll<HTMLElement>(selector)).filter(
      (node) => node.getClientRects().length > 0,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      this.footnotePopover.focus();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const index = active ? focusable.indexOf(active) : -1;
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]!.focus();
      }
      return;
    }
    if (index === -1 || index === focusable.length - 1) {
      event.preventDefault();
      focusable[0]!.focus();
    }
  }

  private closeFootnote(): void {
    if (this.footnoteBackdrop.hidden) return;
    this.footnoteBackdrop.hidden = true;
    this.stageEl.removeAttribute('inert');
    const target = this.footnoteReturnFocus;
    this.footnoteReturnFocus = null;
    if (target && target.isConnected) {
      target.focus();
    } else if (this.footnotePopover.contains(document.activeElement)) {
      // The remembered node may be gone (a page turn remounted the chapter). Never leave
      // focus on a hidden dialog: hand it back to the document instead.
      this.footnoteCloseBtn.blur();
    }
  }
}

new ReaderEngine();
