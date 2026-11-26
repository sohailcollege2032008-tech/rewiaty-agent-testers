import type { Block, Book, Chapter } from '@rewiaty/book-format';

import type { BookReaderState, BookmarkItem, HighlightItem } from '@/types/reader';
import {
  WELCOME_BACK_THRESHOLD_MS,
  buildWelcomeBackRecap,
  extractRecapParagraphs,
  formatAwayArabic,
  pickLatestMark,
  stripHtml,
} from '@/utils/welcome-back';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** A fixed local noon so day maths never depends on the machine clock. */
const NOW = new Date(2026, 10, 27, 12, 0, 0).getTime();

function makeBlock(id: string, kind: Block['kind'], html: string): Block {
  return { id, kind, html };
}

function makeChapter(id: string, title: string, blocks: Block[]): Chapter {
  return { id, title, blocks, wordCount: 100, hash: `${id}-hash` };
}

function makeBook(chapters: Chapter[] = []): Book {
  return {
    id: 'book_1',
    meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
    chapters,
    footnotes: {},
    wordCount: 500,
  };
}

function makeState(overrides: Partial<BookReaderState> = {}): BookReaderState {
  return {
    anchor: { blockId: 'ch01_p0002', charOffset: 4 },
    progress: 0.42,
    chapterId: 'ch01',
    updatedAt: NOW - 4 * DAY_MS,
    ...overrides,
  };
}

const BOOK = makeBook([
  makeChapter('ch01', 'الفصل الأول', [
    makeBlock('ch01_p0001', 'p', 'كَانَ الْفَجْرُ يَتَسَلَّلُ بِهُدُوءٍ فَوْقَ أَرْصِفَةِ الْمِينَاءِ.'),
    makeBlock('ch01_break', 'break', ''),
    makeBlock('ch01_img', 'image', '<img src="assets/harbor.png" />'),
    makeBlock('ch01_p0002', 'p', 'وَعَادَ الصَّيَّادُونَ يَجُرُّونَ شِبَاكَهُمْ إِلَى الشَّاطِئِ.'),
    makeBlock('ch01_h2', 'h2', 'مَشْهَدٌ آخَر'),
  ]),
  makeChapter('ch02', 'الفصل الثاني', [
    makeBlock('ch02_p0001', 'p', 'ثُمَّ أَشْرَقَتِ الشَّمْسُ عَلَى الْمَدِينَةِ الْقَدِيمَةِ.'),
    makeBlock('ch02_p0002', 'p', 'وَبَدَأَ النَّاسُ يَتَحَاوَرُونَ فِي الشَّوَارِعِ الضَّيِّقَةِ.'),
  ]),
]);

function makeBookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: 'bm_1',
    anchor: { blockId: 'ch01_p0001', charOffset: 0 },
    chapterId: 'ch01',
    chapterTitle: 'الفصل الأول',
    quote: 'كَانَ الْفَجْرُ يَتَسَلَّلُ',
    contextBefore: '',
    contextAfter: 'بِهُدُوءٍ',
    page: 1,
    createdAt: 1_000,
    ...overrides,
  };
}

function makeHighlight(overrides: Partial<HighlightItem> = {}): HighlightItem {
  return {
    id: 'hl_1',
    anchor: { blockId: 'ch01_p0002', charOffset: 0 },
    length: 12,
    color: 'gold',
    quote: 'وَعَادَ الصَّيَّادُونَ',
    contextBefore: '',
    contextAfter: 'يَجُرُّونَ',
    chapterId: 'ch01',
    chapterTitle: 'الفصل الأول',
    createdAt: 2_000,
    updatedAt: 2_000,
    ...overrides,
  };
}

describe('welcome-back eligibility', () => {
  it('uses a three-day threshold in milliseconds', () => {
    expect(WELCOME_BACK_THRESHOLD_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('does not show a recap after 2 days and 23 hours', () => {
    const state = makeState({ updatedAt: NOW - (2 * DAY_MS + 23 * 60 * MINUTE_MS) });
    expect(buildWelcomeBackRecap({ book: BOOK, state, now: NOW })).toBeNull();
  });

  it('does not show a recap at exactly three days (strictly more is required)', () => {
    const state = makeState({ updatedAt: NOW - 3 * DAY_MS });
    expect(buildWelcomeBackRecap({ book: BOOK, state, now: NOW })).toBeNull();
  });

  it('shows a recap after three days and one minute', () => {
    const state = makeState({ updatedAt: NOW - (3 * DAY_MS + MINUTE_MS) });
    const recap = buildWelcomeBackRecap({ book: BOOK, state, now: NOW });
    expect(recap).not.toBeNull();
    expect(recap?.awayMs).toBe(3 * DAY_MS + MINUTE_MS);
    expect(recap?.awayLabel).toBe('غبت ٣ أيام');
  });

  it('never shows a recap for a book that was never started', () => {
    const state = makeState({
      anchor: null,
      progress: 0,
      updatedAt: NOW - 30 * DAY_MS,
    });
    expect(buildWelcomeBackRecap({ book: BOOK, state, now: NOW })).toBeNull();
  });

  it('treats a missing updatedAt as invalid', () => {
    const state = makeState({ updatedAt: Number.NaN });
    expect(buildWelcomeBackRecap({ book: BOOK, state, now: NOW })).toBeNull();
  });

  it('never shows a recap when the last read timestamp is in the future', () => {
    const state = makeState({ updatedAt: NOW + DAY_MS });
    const recap = buildWelcomeBackRecap({
      book: BOOK,
      state,
      now: NOW,
      lastOpenedAt: NOW - 10 * DAY_MS,
    });
    expect(recap).toBeNull();
  });

  it('falls back to the library lastOpenedAt when the saved state has no usable timestamp', () => {
    const state = makeState({ updatedAt: Number.NaN });
    const recap = buildWelcomeBackRecap({
      book: BOOK,
      state,
      now: NOW,
      lastOpenedAt: NOW - 5 * DAY_MS,
    });
    expect(recap).not.toBeNull();
    expect(recap?.awayMs).toBe(5 * DAY_MS);
  });
});

describe('welcome-back recap paragraphs', () => {
  it('extracts the last two prose paragraphs up to the anchor and skips break/image/h2 blocks', () => {
    const paragraphs = extractRecapParagraphs(BOOK, { blockId: 'ch01_p0002', charOffset: 0 });
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('الْفَجْرُ');
    expect(paragraphs[1]).toContain('الصَّيَّادُونَ');
    expect(paragraphs.join(' ')).not.toContain('<');
  });

  it('counts quotes as prose and keeps reading order', () => {
    const book = makeBook([
      makeChapter('ch01', 'الفصل الأول', [
        makeBlock('ch01_p0001', 'p', 'فقرة أولى.'),
        makeBlock('ch01_q0002', 'quote', 'اقتباس ثانٍ.'),
      ]),
    ]);
    expect(extractRecapParagraphs(book, { blockId: 'ch01_q0002', charOffset: 0 })).toEqual([
      'فقرة أولى.',
      'اقتباس ثانٍ.',
    ]);
  });

  it('looks back into the previous chapter when the anchor is at the start of chapter two', () => {
    const paragraphs = extractRecapParagraphs(BOOK, { blockId: 'ch02_p0001', charOffset: 0 });
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('الصَّيَّادُونَ');
    expect(paragraphs[1]).toContain('أَشْرَقَتِ');
  });

  it('shows only one paragraph at the very start of the book', () => {
    const paragraphs = extractRecapParagraphs(BOOK, { blockId: 'ch01_p0001', charOffset: 0 });
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain('الْفَجْرُ');
  });

  it('includes the current chapter title and away label in the built recap', () => {
    const state = makeState({ updatedAt: NOW - 14 * DAY_MS });
    const recap = buildWelcomeBackRecap({ book: BOOK, state, now: NOW });
    expect(recap?.chapterTitle).toBe('الفصل الأول');
    expect(recap?.awayLabel).toBe('غبت أسبوعين');
    expect(recap?.paragraphs).toHaveLength(2);
  });
});

describe('welcome-back plain text', () => {
  it('strips tags, decodes entities and preserves Arabic tashkeel', () => {
    expect(
      stripHtml('<p>كَانَ &amp; <em>الْفَجْرُ</em><br/>يَتَسَلَّلُ</p>'),
    ).toBe('كَانَ & الْفَجْرُ يَتَسَلَّلُ');
  });

  it('never leaves raw tags behind', () => {
    const text = stripHtml('<p>سطر <span class="x">داخلي</span></p>');
    expect(text).not.toMatch(/</);
    expect(text).toContain('داخلي');
  });
});

describe('welcome-back latest mark', () => {
  it('picks the highlight when it was created after the bookmark', () => {
    const mark = pickLatestMark(
      makeState({
        bookmarkItems: [makeBookmark({ createdAt: 1_000 })],
        highlights: [makeHighlight({ createdAt: 5_000 })],
      }),
    );
    expect(mark).toEqual(
      expect.objectContaining({ kind: 'highlight', label: 'آخر اقتباس', quote: 'وَعَادَ الصَّيَّادُونَ' }),
    );
  });

  it('picks the bookmark when it was created after the highlight', () => {
    const mark = pickLatestMark(
      makeState({
        bookmarkItems: [makeBookmark({ createdAt: 9_000 })],
        highlights: [makeHighlight({ createdAt: 5_000 })],
      }),
    );
    expect(mark).toEqual(expect.objectContaining({ kind: 'bookmark', label: 'آخر علامة' }));
  });

  it('labels a highlight with a note as آخر ملاحظة and carries the note text', () => {
    const mark = pickLatestMark(
      makeState({
        highlights: [makeHighlight({ createdAt: 5_000, note: 'جملة تستاهل الوقفة' })],
      }),
    );
    expect(mark).toEqual(
      expect.objectContaining({
        kind: 'note',
        label: 'آخر ملاحظة',
        note: 'جملة تستاهل الوقفة',
      }),
    );
  });

  it('returns null when there is no bookmark or highlight', () => {
    expect(pickLatestMark(makeState())).toBeNull();
  });
});

describe('welcome-back away label', () => {
  it('formats a few days in Arabic digits', () => {
    expect(formatAwayArabic(4 * DAY_MS)).toBe('غبت ٤ أيام');
  });

  it('formats two weeks as أسبوعين', () => {
    expect(formatAwayArabic(14 * DAY_MS)).toBe('غبت أسبوعين');
  });

  it('falls back to a human phrase for a very long absence', () => {
    expect(formatAwayArabic(400 * DAY_MS)).toBe('غبت منذ فترة');
  });
});
