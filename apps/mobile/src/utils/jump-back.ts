import type { Anchor } from '@rewiaty/book-format';

/**
 * F26 «صباعك بين الصفحات»: after a reader jumps away from where they were reading (a TOC chapter,
 * the page scrubber, a bookmark or a highlight), the reader keeps a small floating pill that carries
 * them straight back to the page they left.
 *
 * This module is the whole decision: a pure state machine with no React, no timers and no storage,
 * so every rule below can be proven by a unit test instead of by watching a phone.
 */

/** How many page turns in the new spot count as "the reader kept reading" and retire the pill. */
export const JUMP_BACK_AUTO_DISMISS_TURNS = 3;

/**
 * Reading actively in the new spot for longer than this retires the pill too — a reader who has
 * settled somewhere else does not want a way back nagging them.
 */
export const JUMP_BACK_AUTO_EXPIRE_MS = 120_000;

/**
 * How far the engine's reported `charOffset` may drift inside the same block and still count as
 * "the same spot" when judging whether the reader got back to where they left. A reflow moves the
 * global page number and nudges the top-of-page anchor by a line or two; the text block does not.
 */
export const JUMP_BACK_ORIGIN_CHAR_TOLERANCE = 200;

/** Where the reader was when they jumped away. */
export type JumpOrigin = {
  anchor: Anchor | null;
  chapterId: string;
  chapterTitle: string;
  page: number;
  createdAt: number;
};

/** The destination of a jump, as far as it is known at the moment of the jump. */
export type JumpTarget = {
  chapterId: string;
  /** `0`/`null`/absent when the destination page is not known (an anchor jump). */
  page?: number | null;
  /** Present for bookmark / highlight jumps, where the exact block is known. */
  anchor?: Anchor | null;
};

export type JumpBackState = {
  origin: JumpOrigin | null;
  /**
   * The spot the reader occupied at the moment of the latest jump — in an A -> B -> A chain that is
   * B, not A. Its own (possibly late) position report is the stale pre-jump pose and must not be
   * read as anything while the jump is landing.
   */
  pendingDepartureKey: string | null;
  turnsInNewSpot: number;
  /**
   * `null` while the jump is still landing: the first position report after a jump is the jump's
   * own landing, never a page turn.
   */
  lastPositionKey: string | null;
};

export function emptyJumpBackState(): JumpBackState {
  return { origin: null, pendingDepartureKey: null, turnsInNewSpot: 0, lastPositionKey: null };
}

export function positionKey(chapterId: string, page: number): string {
  return `${chapterId}:${page}`;
}

/** The chapter a block id belongs to (`ch01_p0007` -> `ch01`), or `null` when it has no prefix. */
export function chapterIdFromAnchor(anchor: Anchor): string | null {
  const match = /^(.*)_p\d+$/.exec(anchor.blockId);
  return match ? match[1]! : null;
}

/** True when two anchors name the same spot in the text (same block, same offset). */
export function isSameAnchorSpot(a: Anchor, b: Anchor): boolean {
  return a.blockId === b.blockId && a.charOffset === b.charOffset;
}

function chapterIdOfPositionKey(key: string): string | null {
  const index = key.lastIndexOf(':');
  return index > 0 ? key.slice(0, index) : null;
}

function anchorSpotWithin(a: Anchor, b: Anchor, tolerance: number): boolean {
  if (a.blockId !== b.blockId) return false;
  return Math.abs(a.charOffset - b.charOffset) <= tolerance;
}

function isSameSpot(origin: JumpOrigin, target: JumpTarget): boolean {
  if (target.anchor && origin.anchor) {
    // Why (Codex #42 P2): the resolved anchor is the truth, never the stored page number — a
    // bookmark keeps the page it had when it was created and re-pagination moves that page. And a
    // long paragraph can run across two pages, so a different offset in the same block is a
    // different spot, not "the place I am standing".
    return isSameAnchorSpot(target.anchor, origin.anchor);
  }
  if (target.anchor) {
    // Only the destination is anchored (the reader has not reported a text anchor yet): there is no
    // text signal to compare, so a jump into an anchored spot always earns a way back. Erring
    // towards showing the pill is safe — it retires by itself.
    return false;
  }
  if (target.chapterId !== origin.chapterId) return false;
  return typeof target.page === 'number' && target.page > 0 && target.page === origin.page;
}

/**
 * Records a jump away from `currentOrigin` (where the reader is right now).
 *
 * A chained peek (A -> B -> C) keeps the FIRST origin on purpose: returning must go all the way
 * back to where the reader was actually reading, never to the intermediate peek. A jump to the
 * exact spot the reader already occupies is not a jump and leaves the state untouched.
 */
export function recordJump(
  state: JumpBackState,
  currentOrigin: JumpOrigin,
  target: JumpTarget,
): JumpBackState {
  if (isSameSpot(currentOrigin, target)) return state;

  const pendingDepartureKey = positionKey(currentOrigin.chapterId, currentOrigin.page);

  if (state.origin) {
    // Already holding an un-returned origin: keep it, just restart the "reading elsewhere" clock.
    // The departure spot moves with the reader, so A -> B -> A compares against B, not A.
    return { ...state, turnsInNewSpot: 0, lastPositionKey: null, pendingDepartureKey };
  }

  return {
    origin: currentOrigin,
    pendingDepartureKey,
    turnsInNewSpot: 0,
    lastPositionKey: null,
  };
}

/**
 * Did the reader come back to the spot they left?
 *
 * A text anchor is the stable identity: same chapter, same block, and an offset that only drifted
 * by a reflow. That is what makes A -> B -> A work when the pagination changed under it (a font or
 * size change moved A's page number). The `chapterId:page` key is only the fallback for books that
 * report no anchor at all.
 */
function isAtOrigin(
  origin: JumpOrigin,
  nextPositionKey: string,
  currentAnchor: Anchor | null,
): boolean {
  if (origin.anchor && currentAnchor) {
    const reportChapterId = chapterIdOfPositionKey(nextPositionKey);
    const anchorChapterId = chapterIdFromAnchor(origin.anchor);
    if (
      reportChapterId !== null &&
      (anchorChapterId === null || anchorChapterId === reportChapterId) &&
      anchorSpotWithin(currentAnchor, origin.anchor, JUMP_BACK_ORIGIN_CHAR_TOLERANCE)
    ) {
      return true;
    }
  }
  return nextPositionKey === positionKey(origin.chapterId, origin.page);
}

/**
 * Feeds a real position report (a page turn or a jump landing) into the state.
 *
 * The landing itself is not a turn. Once the reader has actually kept reading — three turns, or two
 * minutes of activity — or has navigated back to the page they left, the pill retires by itself.
 * Reports of the spot the reader just departed are ignored while the jump is still landing.
 */
export function recordReadingProgress(
  state: JumpBackState,
  nextPositionKey: string,
  now: number,
  currentAnchor?: Anchor | null,
): JumpBackState {
  const origin = state.origin;
  if (!origin) return state;

  const backAtOrigin = isAtOrigin(origin, nextPositionKey, currentAnchor ?? null);

  if (state.lastPositionKey === null) {
    // The jump is still landing. The only report that is a stale pre-jump pose is the one for the
    // spot the reader just left — NOT the origin: in A -> B -> A the departure is B, so a report of
    // A is the reader arriving back home and the pill must go at once.
    if (state.pendingDepartureKey !== null && nextPositionKey === state.pendingDepartureKey) {
      return state;
    }
    if (backAtOrigin) return emptyJumpBackState();
    return { ...state, lastPositionKey: nextPositionKey };
  }

  if (state.lastPositionKey === nextPositionKey) return state;

  // The reader went back where they came from themselves: nothing left to return to.
  if (backAtOrigin) return emptyJumpBackState();

  const turnsInNewSpot = state.turnsInNewSpot + 1;
  if (turnsInNewSpot >= JUMP_BACK_AUTO_DISMISS_TURNS) return emptyJumpBackState();
  if (now - origin.createdAt >= JUMP_BACK_AUTO_EXPIRE_MS) return emptyJumpBackState();

  return { ...state, turnsInNewSpot, lastPositionKey: nextPositionKey };
}

/** The pill was tapped: hand the origin back to the reader screen and clear the state. */
export function consumeJumpBack(state: JumpBackState): {
  origin: JumpOrigin | null;
  nextState: JumpBackState;
} {
  return { origin: state.origin, nextState: emptyJumpBackState() };
}

/** The pill was closed by hand. */
export function dismissJumpBack(_state: JumpBackState): JumpBackState {
  return emptyJumpBackState();
}

/** Arabic label for the pill; a chapter title is the fallback when the page number is unknown. */
export function jumpBackLabel(origin: JumpOrigin): string {
  if (origin.page > 0) return `ارجع لصفحة ${origin.page}`;
  return `ارجع لـ ${origin.chapterTitle}`;
}
