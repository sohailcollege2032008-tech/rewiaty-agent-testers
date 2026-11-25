import type { Book } from '@rewiaty/book-format';

import {
  blockToPlainText,
  extractBookmarkContext,
  isPositionBookmarked,
  normalizeBookmarkItems,
  removeBookmarkById,
  resolveBookmarkAnchor,
  sortBookmarksNewestFirst,
  toggleBookmarkAtPosition,
} from '@/storage/bookmarks';
import type { BookmarkItem } from '@/types/reader';

function makeBook(): Book {
  return {
    id: 'book_1',
    meta: { title: 'كتاب تجريبي', lang: 'ar', dir: 'rtl' },
    chapters: [
      {
        id: 'ch01',
        title: 'الفصل الأول',
        wordCount: 40,
        hash: 'h1',
        blocks: [
          {
            id: 'ch01_p0001',
            kind: 'p',
            html: 'كَانَ الْفَجْرُ يَتَسَلَّلُ بِهُدُوءٍ فَوْقَ أَرْصِفَةِ الْمِينَاءِ.',
          },
          {
            id: 'ch01_p0002',
            kind: 'p',
            html: 'ثُمَّ <em>أَشْرَقَتِ</em> الشَّمْسُ عَلَى الْمَدِينَةِ الْقَدِيمَةِ وَعَادَتِ الْحَيَاةُ إِلَى الشَّوَارِعِ الضَّيِّقَةِ مِنْ جَدِيدٍ.',
          },
        ],
      },
      {
        id: 'ch02',
        title: 'الفصل الثاني',
        wordCount: 30,
        hash: 'h2',
        blocks: [
          {
            id: 'ch02_p0001',
            kind: 'p',
            html: 'وَعَادَ الْبَحْرُ يَهْمِسُ لِلصُّيَّادِينَ كُلَّ مَسَاءٍ.',
          },
        ],
      },
    ],
    footnotes: {},
    wordCount: 70,
  };
}

function makeItem(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: 'bm_1',
    anchor: { blockId: 'ch01_p0002', charOffset: 6 },
    chapterId: 'ch01',
    chapterTitle: 'الفصل الأول',
    quote: 'أَشْرَقَتِ الشَّمْسُ',
    contextBefore: 'ثُمَّ',
    contextAfter: 'عَلَى الْمَدِينَةِ',
    page: 2,
    createdAt: 1000,
    ...overrides,
  };
}

describe('bookmarks: text extraction', () => {
  it('strips tags and keeps Arabic Tashkeel character-for-character', () => {
    const book = makeBook();
    const context = extractBookmarkContext(book, { blockId: 'ch01_p0002', charOffset: 5 });

    expect(context.chapterId).toBe('ch01');
    expect(context.chapterTitle).toBe('الفصل الأول');
    expect(context.quote.startsWith('أَشْرَقَتِ')).toBe(true);
    expect(context.quote).toContain('َ'); // fatha survives
    expect(context.quote).not.toContain('<');
    expect(context.contextBefore).toBe('ثُمَّ');
    expect(context.contextAfter.length).toBeGreaterThan(0);
    expect(context.contextAfter).not.toContain('<');
  });

  it('caps the quote at ~80 characters and the context at ~25', () => {
    const book = makeBook();
    const longBlock = 'ا'.repeat(200);
    const withLong: Book = {
      ...book,
      chapters: [{ ...book.chapters[0]!, blocks: [{ id: 'ch01_p0009', kind: 'p', html: longBlock }] }],
    };
    const context = extractBookmarkContext(withLong, { blockId: 'ch01_p0009', charOffset: 10 });
    expect(context.quote.length).toBeLessThanOrEqual(80);
    expect(context.contextBefore.length).toBeLessThanOrEqual(25);
    expect(context.contextAfter.length).toBeLessThanOrEqual(25);
  });

  it('degrades safely for an unknown block instead of crashing', () => {
    const context = extractBookmarkContext(makeBook(), { blockId: 'ch99_p0001', charOffset: 3 });
    expect(context.quote).toBe('');
    expect(context.chapterId).toBe('ch99');
  });

  it('blockToPlainText decodes entities exactly like the DOM textContent', () => {
    expect(blockToPlainText('نص &amp; نص')).toBe('نص & نص');
    expect(blockToPlainText('a<br/>b')).toBe('ab');
  });
});

describe('bookmarks: re-anchoring', () => {
  it('returns the stored anchor when the text did not move', () => {
    const book = makeBook();
    const item = makeItem();
    expect(resolveBookmarkAnchor(book, item)).toEqual({ blockId: 'ch01_p0002', charOffset: 6 });
  });

  it('finds the new offset when the paragraph shifted inside the same block', () => {
    const book = makeBook();
    const item = makeItem({ anchor: { blockId: 'ch01_p0002', charOffset: 0 } });
    expect(resolveBookmarkAnchor(book, item)).toEqual({ blockId: 'ch01_p0002', charOffset: 6 });
  });

  it('re-anchors by quote when the block moved to another chapter and lost its Tashkeel', () => {
    const moved: Book = {
      id: 'book_2',
      meta: { title: 'نسخة معدلة', lang: 'ar', dir: 'rtl' },
      chapters: [
        {
          id: 'ch09',
          title: 'فصل جديد',
          wordCount: 20,
          hash: 'h9',
          blocks: [
            {
              id: 'ch09_p0001',
              kind: 'p',
              html: 'مقدمة قصيرة. ثم أشرقت الشمس على المدينة القديمة.',
            },
          ],
        },
      ],
      footnotes: {},
      wordCount: 20,
    };

    const resolved = resolveBookmarkAnchor(moved, makeItem());
    const plain = 'مقدمة قصيرة. ثم أشرقت الشمس على المدينة القديمة.';
    expect(resolved.blockId).toBe('ch09_p0001');
    expect(resolved.charOffset).toBe(plain.indexOf('أشرقت'));
  });

  it('falls back to the stored anchor when the quote is nowhere in the book', () => {
    const item = makeItem({ quote: 'جملة غير موجودة إطلاقاً', anchor: { blockId: 'gone', charOffset: 7 } });
    expect(resolveBookmarkAnchor(makeBook(), item)).toEqual({ blockId: 'gone', charOffset: 7 });
  });
});

describe('bookmarks: normalization and toggling', () => {
  it('keeps legacy numeric page bookmarks without dropping them', () => {
    const items = normalizeBookmarkItems(null, [3, 7, 'x', NaN]);
    expect(items.map((item) => item.page)).toEqual([3, 7]);
    expect(items.map((item) => item.id)).toEqual(['legacy-page-3', 'legacy-page-7']);
    expect(items.every((item) => item.anchor.blockId === '')).toBe(true);
  });

  it('drops malformed rows and keeps valid ones, de-duplicating by id', () => {
    const valid = makeItem();
    const items = normalizeBookmarkItems(
      [valid, { ...valid }, { id: 'bad', anchor: { blockId: '', charOffset: 0 } }, { id: 'bad2', anchor: null }, 'nope'],
      undefined,
      makeBook(),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('bm_1');
  });

  it('fills a missing quote/chapter from the book when restoring', () => {
    const items = normalizeBookmarkItems(
      [{ id: 'bm_x', anchor: { blockId: 'ch02_p0001', charOffset: 0 } }],
      undefined,
      makeBook(),
    );
    expect(items[0]?.quote.startsWith('وَعَادَ')).toBe(true);
    expect(items[0]?.chapterTitle).toBe('الفصل الثاني');
  });

  it('adds a bookmark then removes it when toggled at the same position', () => {
    const position = {
      anchor: { blockId: 'ch01_p0001', charOffset: 0 },
      page: 1,
      chapterId: 'ch01',
      chapterTitle: 'الفصل الأول',
      quote: 'كَانَ الْفَجْرُ',
      contextBefore: '',
      contextAfter: 'يَتَسَلَّلُ',
      now: 1000,
    };

    const added = toggleBookmarkAtPosition([], position);
    expect(added.added).toBe(true);
    expect(added.items).toHaveLength(1);
    expect(added.items[0]?.id).toBe('bookmark-1000-ch01_p0001-0');
    expect(added.items[0]?.quote).toBe('كَانَ الْفَجْرُ');

    const removed = toggleBookmarkAtPosition(added.items, { ...position, now: 2000 });
    expect(removed.added).toBe(false);
    expect(removed.removedId).toBe('bookmark-1000-ch01_p0001-0');
    expect(removed.items).toEqual([]);
  });

  it('matches by page when the anchor moved inside the same page', () => {
    const items = normalizeBookmarkItems([], [4]);
    expect(isPositionBookmarked(items, { blockId: 'ch02_p0001', charOffset: 9 }, 4)).toBe(true);
    expect(isPositionBookmarked(items, { blockId: 'ch02_p0001', charOffset: 9 }, 5)).toBe(false);

    const toggled = toggleBookmarkAtPosition(items, {
      anchor: { blockId: 'ch02_p0001', charOffset: 9 },
      page: 4,
      chapterId: 'ch02',
      chapterTitle: 'الفصل الثاني',
      now: 3000,
    });
    expect(toggled.added).toBe(false);
    expect(toggled.removedId).toBe('legacy-page-4');
  });

  it('removes by id and sorts newest first', () => {
    const first = makeItem({ id: 'a', createdAt: 10 });
    const second = makeItem({ id: 'b', createdAt: 30 });
    expect(removeBookmarkById([first, second], 'a')).toEqual([second]);
    expect(sortBookmarksNewestFirst([first, second]).map((item) => item.id)).toEqual(['b', 'a']);
  });
});

describe('legacy migration and page drift (Codex #19)', () => {
  it('a deleted legacy bookmark does not come back on reload once legacy pages are retired', () => {
    const loaded = normalizeBookmarkItems(undefined, [3, 7]);
    const afterDelete = removeBookmarkById(loaded, 'legacy-page-3');
    // persisted as { bookmarkItems: afterDelete, bookmarks: [] }
    const reloaded = normalizeBookmarkItems(JSON.parse(JSON.stringify(afterDelete)), []);
    expect(reloaded.map((item) => item.id)).toEqual(['legacy-page-7']);
    expect(isPositionBookmarked(reloaded, null, 3)).toBe(false);
    expect(isPositionBookmarked(reloaded, null, 7)).toBe(true);
  });

  it('an anchored bookmark never matches by its stale page number after reflow', () => {
    const anchored = makeItem({ id: 'a', page: 5 });
    expect(isPositionBookmarked([anchored], { blockId: 'other', charOffset: 0 }, 5)).toBe(false);
    const toggled = toggleBookmarkAtPosition([anchored], {
      anchor: { blockId: 'other', charOffset: 0 },
      page: 5,
      chapterId: 'ch01',
      chapterTitle: 'x',
      now: 1,
    });
    expect(toggled.added).toBe(true);
    expect(toggled.items.map((item) => item.id)).toContain('a');
  });
});
