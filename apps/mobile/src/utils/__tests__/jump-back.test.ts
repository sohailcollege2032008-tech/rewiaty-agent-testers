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
  it('starts with no origin, no departure, no turns and no landing key', () => {
    expect(emptyJumpBackState()).toEqual({
      origin: null,
      pendingDepartureKey: null,
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

  it('does not record a jump to the exact anchor spot the reader is on', () => {
    const state = emptyJumpBackState();
    const next = recordJump(state, originAt(), {
      chapterId: 'ch01',
      page: 1,
      anchor: { blockId: 'ch01_p0001', charOffset: 0 },
    });

    expect(next).toBe(state);
  });

  it('records a jump inside one long paragraph when the offset differs (Codex #42 P2)', () => {
    // A paragraph can run across two pages: the same block id is NOT the same spot when the
    // reader's place in it moved — that is exactly the case where the way back matters.
    const next = recordJump(emptyJumpBackState(), originAt(), {
      chapterId: 'ch01',
      anchor: { blockId: 'ch01_p0001', charOffset: 940 },
    });

    expect(next.origin).toEqual(originAt());
  });

  it('trusts the resolved anchor over a stale stored page number (Codex #42 P2)', () => {
    // A bookmark created on page 42 keeps `page: 42`; re-pagination moved that page, so a target
    // that still says 42 but anchors elsewhere is a real jump, not "the page I am already on".
    const next = recordJump(emptyJumpBackState(), originAt({ page: 42 }), {
      chapterId: 'ch01',
      page: 42,
      anchor: { blockId: 'ch01_p0100', charOffset: 0 },
    });

    expect(next.origin).toEqual(originAt({ page: 42 }));
  });

  it('records the spot the reader departs from on every chained jump', () => {
    const atB = jumpToChapterThree(emptyJumpBackState(), 1_000);
    const landedB = recordReadingProgress(atB, positionKey('ch03', 3), 1_500);
    const fromB = recordJump(
      landedB,
      originAt({ chapterId: 'ch03', page: 3, anchor: null, createdAt: 2_000 }),
      { chapterId: 'ch05', page: 9 },
    );

    // The origin stays A, but the departure moved to B: an A -> B -> A return is judged against B.
    expect(fromB.origin).toEqual(originAt({ createdAt: 1_000 }));
    expect(fromB.pendingDepartureKey).toBe(positionKey('ch03', 3));
    expect(fromB.lastPositionKey).toBeNull();
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

describe('returning to the origin by hand (Codex #42 P2)', () => {
  /** A -> B, landed on B, then the reader walks back to A themselves (the index or the scrubber). */
  function jumpedAwayAndBackByHand(target: { chapterId: string; page: number }): JumpBackState {
    const jumped = recordJump(emptyJumpBackState(), originAt({ createdAt: 1_000 }), {
      chapterId: 'ch02',
      page: 6,
    });
    const landed = recordReadingProgress(jumped, positionKey('ch02', 6), 1_500);
    return recordJump(
      landed,
      originAt({
        chapterId: 'ch02',
        page: 6,
        anchor: { blockId: 'ch02_p0001', charOffset: 0 },
        createdAt: 2_000,
      }),
      target,
    );
  }

  it('retires the pill when the reader returns to A from the index', () => {
    const returning = jumpedAwayAndBackByHand({ chapterId: 'ch01', page: 1 });

    // The pill is still there while the reader is on the way…
    expect(returning.origin).toEqual(originAt({ createdAt: 1_000 }));
    // …and the landing on A is a return home, not a stale report of the spot they just left.
    const home = recordReadingProgress(returning, positionKey('ch01', 1), 2_500);

    expect(home).toEqual(emptyJumpBackState());
  });

  it('retires the pill when the reader returns to A from the page scrubber', () => {
    const returning = jumpedAwayAndBackByHand({ chapterId: 'ch01', page: 1 });
    const home = recordReadingProgress(returning, positionKey('ch01', 1), 2_500, ANCHOR);

    expect(home).toEqual(emptyJumpBackState());
  });

  it('ignores a late report of B (the spot they departed) while the return to A is landing', () => {
    const returning = jumpedAwayAndBackByHand({ chapterId: 'ch01', page: 1 });
    const stale = recordReadingProgress(
      returning,
      positionKey('ch02', 6),
      2_400,
      { blockId: 'ch02_p0001', charOffset: 0 },
    );

    expect(stale).toBe(returning);
  });

  it('recognises A after a reflow moved its page number, via the text anchor', () => {
    const origin = originAt({
      anchor: { blockId: 'ch01_p0003', charOffset: 12 },
      page: 2,
      createdAt: 1_000,
    });
    const jumped = recordJump(emptyJumpBackState(), origin, { chapterId: 'ch02', page: 9 });
    const landed = recordReadingProgress(jumped, positionKey('ch02', 9), 1_500);
    const returning = recordJump(
      landed,
      originAt({
        chapterId: 'ch02',
        page: 9,
        anchor: { blockId: 'ch02_p0002', charOffset: 0 },
        createdAt: 2_000,
      }),
      // The index still says page 2, the page A had before the font change.
      { chapterId: 'ch01', page: 2 },
    );

    // A reflowed book reports page 3 now, with the same text block and a slightly drifted offset.
    const home = recordReadingProgress(returning, positionKey('ch01', 3), 2_500, {
      blockId: 'ch01_p0003',
      charOffset: 14,
    });

    expect(home).toEqual(emptyJumpBackState());
  });

  it('retires on a manual return even after the jump had already landed (anchor identity)', () => {
    const origin = originAt({
      anchor: { blockId: 'ch01_p0003', charOffset: 12 },
      page: 2,
      createdAt: 1_000,
    });
    const jumped = recordJump(emptyJumpBackState(), origin, { chapterId: 'ch02', page: 9 });
    const landed = recordReadingProgress(
      jumped,
      positionKey('ch02', 9),
      1_500,
      { blockId: 'ch02_p0002', charOffset: 0 },
    );

    const home = recordReadingProgress(landed, positionKey('ch01', 4), 2_500, {
      blockId: 'ch01_p0003',
      charOffset: 40,
    });

    expect(home).toEqual(emptyJumpBackState());
  });

  it('keeps the pill when the reader lands on another block of the same chapter', () => {
    const origin = originAt({
      anchor: { blockId: 'ch01_p0003', charOffset: 12 },
      page: 2,
      createdAt: 1_000,
    });
    const jumped = recordJump(emptyJumpBackState(), origin, { chapterId: 'ch02', page: 9 });
    const landed = recordReadingProgress(jumped, positionKey('ch02', 9), 1_500);

    const elsewhere = recordReadingProgress(landed, positionKey('ch01', 5), 2_500, {
      blockId: 'ch01_p0012',
      charOffset: 0,
    });

    expect(elsewhere.origin).not.toBeNull();
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
