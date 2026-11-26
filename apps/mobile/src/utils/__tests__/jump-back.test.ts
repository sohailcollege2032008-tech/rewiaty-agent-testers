import type { Anchor } from '@rewiaty/book-format';

import {
  consumeJumpBack,
  dismissJumpBack,
  emptyJumpBackState,
  JUMP_BACK_AUTO_DISMISS_TURNS,
  JUMP_BACK_AUTO_EXPIRE_MS,
  jumpBackLabel,
  positionKey,
  recordJump,
  recordReadingProgress,
  type JumpBackState,
  type JumpOrigin,
} from '@/utils/jump-back';

const ANCHOR: Anchor = { blockId: 'ch01_p0001', charOffset: 0 };

/** Where the reader actually was when they jumped away: chapter 1, page 1. */
function originAt(overrides: Partial<JumpOrigin> = {}): JumpOrigin {
  return {
    anchor: ANCHOR,
    chapterId: 'ch01',
    chapterTitle: 'الفصل الأول',
    page: 1,
    createdAt: 1_000,
    ...overrides,
  };
}

/** A jump away from chapter 1 into chapter 3. */
function jumpToChapterThree(state: JumpBackState, now = 1_000): JumpBackState {
  return recordJump(state, originAt({ createdAt: now }), {
    chapterId: 'ch03',
    page: 3,
  });
}

describe('emptyJumpBackState', () => {
  it('starts with no origin, no turns and no landing key', () => {
    expect(emptyJumpBackState()).toEqual({
      origin: null,
      turnsInNewSpot: 0,
      lastPositionKey: null,
    });
  });
});

describe('recordJump', () => {
  it('remembers where the reader left when they select a TOC chapter', () => {
    const next = jumpToChapterThree(emptyJumpBackState(), 42);

    expect(next.origin).toEqual(originAt({ createdAt: 42 }));
    expect(next.turnsInNewSpot).toBe(0);
    // The landing position is not known yet, so the next `position` report is the landing — not a turn.
    expect(next.lastPositionKey).toBeNull();
  });

  it('keeps the FIRST origin while chaining peeks A -> B -> C', () => {
    const atA = jumpToChapterThree(emptyJumpBackState(), 1_000);
    const readingA = recordReadingProgress(atA, positionKey('ch03', 4), 2_000);
    const atB = recordJump(readingA, originAt({ chapterId: 'ch03', page: 4, createdAt: 2_000 }), {
      chapterId: 'ch05',
      page: 9,
    });
    const atC = recordJump(atB, originAt({ chapterId: 'ch05', page: 9, createdAt: 3_000 }), {
      chapterId: 'ch07',
      page: 2,
    });

    // Returning must go all the way back to A (chapter 1, page 1), not to the last peek.
    expect(atC.origin).toEqual(originAt({ createdAt: 1_000 }));
    expect(atC.turnsInNewSpot).toBe(0);
    expect(atC.lastPositionKey).toBeNull();
  });

  it('does not record a jump to the exact page the reader is already on', () => {
    const state = emptyJumpBackState();
    const next = recordJump(state, originAt(), { chapterId: 'ch01', page: 1 });

    expect(next).toBe(state);
  });

  it('does not record a jump to the same anchor block', () => {
    const state = emptyJumpBackState();
    const next = recordJump(state, originAt(), {
      chapterId: 'ch01',
      page: 1,
      anchor: { blockId: 'ch01_p0001', charOffset: 40 },
    });

    expect(next).toBe(state);
  });

  it('records a page seek within the same chapter', () => {
    const next = recordJump(emptyJumpBackState(), originAt({ page: 4 }), {
      chapterId: 'ch01',
      page: 12,
    });

    expect(next.origin).toEqual(originAt({ page: 4 }));
  });

  it('records an anchor jump into the same chapter when the anchor is elsewhere', () => {
    const next = recordJump(emptyJumpBackState(), originAt(), {
      chapterId: 'ch01',
      anchor: { blockId: 'ch01_p0040', charOffset: 0 },
    });

    expect(next.origin).toEqual(originAt());
  });
});

describe('recordReadingProgress', () => {
  it('does not count the initial jump landing as a turn', () => {
    const state = jumpToChapterThree(emptyJumpBackState());
    const landed = recordReadingProgress(state, positionKey('ch03', 3), 1_500);

    expect(landed.origin).toEqual(originAt());
    expect(landed.turnsInNewSpot).toBe(0);
    expect(landed.lastPositionKey).toBe(positionKey('ch03', 3));
  });

  it('ignores the stale report of the page the reader left while the jump is landing', () => {
    const state = jumpToChapterThree(emptyJumpBackState());
    const stale = recordReadingProgress(state, positionKey('ch01', 1), 1_200);
    const landed = recordReadingProgress(stale, positionKey('ch03', 3), 1_500);

    expect(landed.turnsInNewSpot).toBe(0);
    expect(landed.origin).toEqual(originAt());
  });

  it('does not count the same position twice', () => {
    const landed = recordReadingProgress(
      jumpToChapterThree(emptyJumpBackState()),
      positionKey('ch03', 3),
      1_500,
    );
    const again = recordReadingProgress(landed, positionKey('ch03', 3), 1_600);

    expect(again).toBe(landed);
  });

  it(`auto-dismisses after ${JUMP_BACK_AUTO_DISMISS_TURNS} page turns in the new spot`, () => {
    let state = recordReadingProgress(
      jumpToChapterThree(emptyJumpBackState()),
      positionKey('ch03', 3),
      1_500,
    );

    state = recordReadingProgress(state, positionKey('ch03', 4), 1_600);
    expect(state.turnsInNewSpot).toBe(1);
    state = recordReadingProgress(state, positionKey('ch03', 5), 1_700);
    expect(state.turnsInNewSpot).toBe(2);
    state = recordReadingProgress(state, positionKey('ch03', 6), 1_800);

    expect(state).toEqual(emptyJumpBackState());
  });

  it('auto-dismisses when the reader navigates back to the origin page themselves', () => {
    const reading = recordReadingProgress(
      jumpToChapterThree(emptyJumpBackState()),
      positionKey('ch03', 3),
      1_500,
    );
    const backHome = recordReadingProgress(reading, positionKey('ch01', 1), 1_600);

    expect(backHome).toEqual(emptyJumpBackState());
  });

  it('auto-dismisses after two minutes of active reading in the new spot', () => {
    const state = jumpToChapterThree(emptyJumpBackState(), 10_000);
    const reading = recordReadingProgress(state, positionKey('ch03', 3), 10_500);
    const stillPeeking = recordReadingProgress(reading, positionKey('ch03', 4), 11_000);

    // A slow reader is still on the pill…
    expect(stillPeeking.origin).not.toBeNull();

    const expired = recordReadingProgress(
      stillPeeking,
      positionKey('ch03', 5),
      10_000 + JUMP_BACK_AUTO_EXPIRE_MS + 1,
    );

    expect(expired).toEqual(emptyJumpBackState());
  });

  it('keeps the pill for a brief peek that never turns a page', () => {
    const state = jumpToChapterThree(emptyJumpBackState(), 10_000);
    const landed = recordReadingProgress(state, positionKey('ch03', 3), 10_400);
    const later = recordReadingProgress(landed, positionKey('ch03', 3), 10_000 + JUMP_BACK_AUTO_EXPIRE_MS * 5);

    expect(later.origin).toEqual(originAt({ createdAt: 10_000 }));
  });

  it('is a no-op when there is nothing to return to', () => {
    const empty = emptyJumpBackState();

    expect(recordReadingProgress(empty, positionKey('ch02', 2), 5_000)).toBe(empty);
  });
});

describe('consumeJumpBack / dismissJumpBack', () => {
  it('hands the origin back and clears the state', () => {
    const state = jumpToChapterThree(emptyJumpBackState());
    const { origin, nextState } = consumeJumpBack(state);

    expect(origin).toEqual(originAt());
    expect(nextState).toEqual(emptyJumpBackState());
  });

  it('consumes an empty state safely', () => {
    const { origin, nextState } = consumeJumpBack(emptyJumpBackState());

    expect(origin).toBeNull();
    expect(nextState).toEqual(emptyJumpBackState());
  });

  it('dismisses to the empty state', () => {
    expect(dismissJumpBack(jumpToChapterThree(emptyJumpBackState()))).toEqual(
      emptyJumpBackState(),
    );
  });
});

describe('jumpBackLabel', () => {
  it('names the page the reader left', () => {
    expect(jumpBackLabel(originAt({ page: 142 }))).toBe('ارجع لصفحة 142');
  });

  it('falls back to the chapter title when the page is unknown', () => {
    expect(jumpBackLabel(originAt({ page: 0, chapterTitle: 'الفصل الثاني' }))).toBe(
      'ارجع لـ الفصل الثاني',
    );
  });
});
