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
  turnsInNewSpot: number;
  /**
   * `null` while the jump is still landing: the first position report after a jump is the jump's
   * own landing, never a page turn.
   */
  lastPositionKey: string | null;
};

export function emptyJumpBackState(): JumpBackState {
  return { origin: null, turnsInNewSpot: 0, lastPositionKey: null };
}

export function positionKey(chapterId: string, page: number): string {
  return `${chapterId}:${page}`;
}

function isSameSpot(origin: JumpOrigin, target: JumpTarget): boolean {
  if (target.chapterId !== origin.chapterId) return false;
  if (target.anchor && origin.anchor && target.anchor.blockId === origin.anchor.blockId) {
    return true;
  }
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

  if (state.origin) {
    // Already holding an un-returned origin: keep it, just restart the "reading elsewhere" clock.
    return { ...state, turnsInNewSpot: 0, lastPositionKey: null };
  }

  return {
    origin: currentOrigin,
    turnsInNewSpot: 0,
    lastPositionKey: null,
  };
}

/**
 * Feeds a real position report (a page turn or a jump landing) into the state.
 *
 * The landing itself is not a turn. Once the reader has actually kept reading — three turns, or two
 * minutes of activity — or has navigated back to the page they left, the pill retires by itself.
 * Reports of the page the reader left that arrive while the jump is still landing are ignored.
 */
export function recordReadingProgress(
  state: JumpBackState,
  nextPositionKey: string,
  now: number,
): JumpBackState {
  const origin = state.origin;
  if (!origin) return state;

  const originKey = positionKey(origin.chapterId, origin.page);

  if (state.lastPositionKey === null) {
    // The jump is still landing. A report of the old spot is a stale pre-jump pose, not a landing.
    if (nextPositionKey === originKey) return state;
    return { ...state, lastPositionKey: nextPositionKey };
  }

  if (state.lastPositionKey === nextPositionKey) return state;

  // The reader went back where they came from themselves: nothing left to return to.
  if (nextPositionKey === originKey) return emptyJumpBackState();

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
