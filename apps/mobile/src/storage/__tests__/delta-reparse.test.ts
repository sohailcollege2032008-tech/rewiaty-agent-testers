import { Directory, File, Paths } from 'expo-file-system';
import { parseBook, type Book } from '@rewiaty/book-format';

import {
  getBookDir,
  importBookContent,
  PARSER_VERSION,
  readBookBundle,
  saveBookReaderState,
} from '@/storage/bundle';
import { initDatabase, type DatabaseAdapter } from '@/storage/database';
import {
  PARSED_CACHE_FILE,
  rawTextHash,
  reanchorReaderItems,
  updateBookContentDelta,
} from '@/storage/delta-reparse';
import {
  computeSearchContentHash,
  indexBookChaptersDelta,
  readSearchIndexHash,
  searchLibrary,
} from '@/storage/search-index';
import type { BookReaderState } from '@/types/reader';

const BOOK_TITLE = 'نُورُ الْبَحْرِ';
const BOOK_FILE_NAME = `${BOOK_TITLE}.md`;

function createCountingSqliteAdapter(): {
  adapter: DatabaseAdapter;
  close: () => void;
  reset: () => void;
  ftsStatements: () => string[];
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => {
        run: (...params: unknown[]) => { changes: number | bigint };
        get: (...params: unknown[]) => unknown;
        all: (...params: unknown[]) => unknown[];
      };
      close: () => void;
    };
  };

  const sqliteDb = new DatabaseSync(':memory:');
  let ftsLog: string[] = [];

  const adapter: DatabaseAdapter = {
    async execAsync(source: string) {
      sqliteDb.exec(source);
    },
    async runAsync(source: string, ...params: unknown[]) {
      if (source.includes('book_search_fts')) {
        ftsLog.push(source.replace(/\s+/g, ' ').trim());
      }
      const res = sqliteDb.prepare(source).run(...params);
      return { changes: Number(res.changes ?? 0) };
    },
    async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
      const row = sqliteDb.prepare(source).get(...params);
      return (row as T | undefined) ?? null;
    },
    async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
      return sqliteDb.prepare(source).all(...params) as T[];
    },
  };

  return {
    adapter,
    close: () => sqliteDb.close(),
    reset: () => {
      ftsLog = [];
    },
    ftsStatements: () => [...ftsLog],
  };
}

function clearBooksDir() {
  const root = new Directory(Paths.document, 'books');
  if (root.exists) {
    root.delete();
  }
}

const FRONTMATTER = `---
title: "${BOOK_TITLE}"
author: "روايتي"
lang: ar
dir: rtl
---
`;

const CHAPTER_BODIES: string[] = [
  [
    'كَانَتْ نُورُ تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ.',
    'وَفِي قَرْيَةِ رَأْسِ الْمِلْحِ كَانَ حَجَرُ الْمَاءِ مَوْجُودًا مُنْذُ الْقِدَمِ.',
  ].join('\n\n'),
  'ذَهَبَ مُوسَى إِلَى الْمِينَاءِ عِنْدَ الْفَجْرِ لِيَبْحَثَ عَنْ صَدِيقِهِ.',
  [
    'أَخْبَرَهَا الْجَدُّ أَنَّ أَسْمَاءَ الْقَرْيَةِ مَحْفُورَةٌ عَلَى الطِّينِ.',
    'وَكَانَتِ الْمَكْتَبَةُ الْقَدِيمَةُ فِي وَسَطِ الْمَدِينَةِ تَحْتَوِي عَلَى مَخْطُوطَاتٍ نَادِرَةٍ.',
  ].join('\n\n'),
  'ثُمَّ عَادَتِ الرِّيحُ إِلَى الشَّاطِئِ فِي الْمَسَاءِ.',
];

const ORDINALS = ['الْأَوَّلُ', 'الثَّانِي', 'الثَّالِثُ', 'الرَّابِعُ'];

function renderBook(bodies: string[]): string {
  const parts: string[] = [FRONTMATTER];
  for (let i = 0; i < bodies.length; i += 1) {
    parts.push(`\n# الْفَصْلُ ${ORDINALS[i] ?? i + 1}\n\n${bodies[i] ?? ''}\n`);
  }
  return parts.join('');
}

const BASE_TEXT = renderBook(CHAPTER_BODIES);

/** Render the chapters in an arbitrary original order, keeping each one's own heading. */
function renderBookInOrder(order: readonly number[]): string {
  const parts: string[] = [FRONTMATTER];
  for (const originalIndex of order) {
    parts.push(
      `\n# الْفَصْلُ ${ORDINALS[originalIndex] ?? originalIndex + 1}\n\n${CHAPTER_BODIES[originalIndex] ?? ''}\n`,
    );
  }
  return parts.join('');
}

function expectSameParsedBook(actual: Book, expected: Book) {
  expect(actual.meta).toEqual(expected.meta);
  expect(actual.chapters).toEqual(expected.chapters);
  expect(actual.footnotes).toEqual(expected.footnotes);
  expect(actual.wordCount).toBe(expected.wordCount);
}

async function readCacheFile(bookId: string) {
  const file = new File(getBookDir(bookId), PARSED_CACHE_FILE);
  return JSON.parse(await file.text()) as {
    parserVersion: number;
    sourceFormat: 'md' | 'txt';
    rawTextHash: string;
    book: Book;
  };
}

describe('delta re-parse storage (F21)', () => {
  let db: DatabaseAdapter;
  let closeDb: () => void;
  let resetFtsLog: () => void;
  let ftsStatements: () => string[];

  beforeEach(async () => {
    clearBooksDir();
    const created = createCountingSqliteAdapter();
    db = created.adapter;
    closeDb = created.close;
    resetFtsLog = created.reset;
    ftsStatements = created.ftsStatements;
    await initDatabase(db);
  });

  afterEach(() => {
    closeDb();
  });

  it('seeds the parsed cache and stores each chapter rawHash in the manifest on import', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);
    const bookDir = getBookDir(record.id);

    expect(new File(bookDir, PARSED_CACHE_FILE).exists).toBe(true);

    const cache = await readCacheFile(record.id);
    expect(cache.parserVersion).toBe(PARSER_VERSION);
    expect(cache.sourceFormat).toBe('md');
    expect(cache.rawTextHash).toBe(rawTextHash(BASE_TEXT));
    expect(cache.book.chapters).toHaveLength(4);
    expect(cache.book.chapters.every((chapter) => typeof chapter.rawHash === 'string')).toBe(true);

    const manifestFile = new File(bookDir, 'manifest.json');
    const manifest = JSON.parse(await manifestFile.text()) as {
      chapters: Array<{ id: string; rawHash?: string }>;
    };
    expect(manifest.chapters.map((chapter) => chapter.id)).toEqual([
      'ch01',
      'ch02',
      'ch03',
      'ch04',
    ]);
    expect(manifest.chapters.map((chapter) => chapter.rawHash)).toEqual(
      cache.book.chapters.map((chapter) => chapter.rawHash),
    );
  });

  it('re-parses exactly the edited chapter and persists the delta result', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);

    const editedBodies = [...CHAPTER_BODIES];
    editedBodies[2] =
      'جُمْلَةٌ مُسْتَبْدَلَةٌ تَمَامًا فِي الْفَصْلِ الثَّالِثِ بَعْدَ التَّعْدِيلِ.\n\nوَكَانَتِ الْمَكْتَبَةُ الْقَدِيمَةُ فِي وَسَطِ الْمَدِينَةِ تَحْتَوِي عَلَى مَخْطُوطَاتٍ نَادِرَةٍ.';
    const editedText = renderBook(editedBodies);

    const { book, delta } = await updateBookContentDelta(record.id, editedText, db);

    expect(delta.reparsedCount).toBe(1);
    expect(delta.changedChapterIds).toEqual(['ch03']);
    expect(delta.unchangedChapterIds).toEqual(['ch01', 'ch02', 'ch04']);
    expect(delta.removedChapterIds).toEqual([]);
    expect(book.id).toBe(record.id);

    const fullParse = parseBook(editedText, BOOK_FILE_NAME, { cleanArabic: true });
    // Same full-parse id, and byte-identical content to a from-scratch parse.
    expect(delta.book.id).toBe(fullParse.id);
    expectSameParsedBook(book, fullParse);
    expect(book.chapters[2]?.blocks[0]?.html).toContain('مُسْتَبْدَلَةٌ');

    // Bundle on disk is updated: cache hash, cache book, and manifest rawHash for ch03.
    const cache = await readCacheFile(record.id);
    expect(cache.rawTextHash).toBe(rawTextHash(editedText));
    expect(cache.book.chapters[2]?.rawHash).toBe(fullParse.chapters[2]?.rawHash);
    expect(cache.book.chapters[0]?.rawHash).toBe(fullParse.chapters[0]?.rawHash);

    // And a reopened bundle returns the cached delta book without parsing again.
    const opened = await readBookBundle(record.id, db);
    expect(opened.book.chapters[2]?.blocks[0]?.html).toContain('مُسْتَبْدَلَةٌ');
  });

  it('writes zero search-index statements when the content did not change', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);
    resetFtsLog();

    const { delta } = await updateBookContentDelta(record.id, BASE_TEXT, db);

    expect(delta.reparsedCount).toBe(0);
    expect(delta.changedChapterIds).toEqual([]);
    expect(delta.removedChapterIds).toEqual([]);
    expect(ftsStatements()).toEqual([]);

    // Reading the untouched bundle is a pure cache hit as well.
    resetFtsLog();
    await readBookBundle(record.id, db);
    expect(ftsStatements()).toEqual([]);
  });

  it('deletes and re-inserts only the named chapters, leaving other rows intact', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);
    const { book } = await readBookBundle(record.id, db);

    const rowsFor = async (chapterId: string) =>
      db.getAllAsync<{ block_id: string; raw_text: string }>(
        'SELECT block_id, raw_text FROM book_search_fts WHERE book_id = ? AND chapter_id = ? ORDER BY block_id',
        record.id,
        chapterId,
      );

    const chapterOneBefore = await rowsFor('ch01');
    const chapterTwoBefore = await rowsFor('ch02');
    expect(chapterOneBefore.length).toBeGreaterThan(0);
    expect(chapterTwoBefore).toHaveLength(1);

    resetFtsLog();
    const result = await indexBookChaptersDelta(book, ['ch02'], [], db);

    expect(result.indexedBlocks).toBe(1);
    const statements = ftsStatements();
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('DELETE FROM book_search_fts');
    expect(statements[0]).toContain('chapter_id = ?');
    expect(statements[1]).toContain('INSERT INTO book_search_fts');

    // ch01's rows are untouched; ch02 was rebuilt from the same source.
    expect(await rowsFor('ch01')).toEqual(chapterOneBefore);
    expect(await rowsFor('ch02')).toEqual(chapterTwoBefore);

    // Zero ids on both sides means zero SQL — not even a delete-all.
    resetFtsLog();
    const noop = await indexBookChaptersDelta(book, [], [], db);
    expect(noop).toEqual({ deletedChapters: 0, indexedBlocks: 0 });
    expect(ftsStatements()).toEqual([]);
  });

  it('removes search rows of chapters that disappeared', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);
    const shortened = renderBook(CHAPTER_BODIES.slice(0, 3));

    const { delta } = await updateBookContentDelta(record.id, shortened, db);

    expect(delta.reparsedCount).toBe(0);
    expect(delta.removedChapterIds).toEqual(['ch04']);

    const remaining = await searchLibrary('الرِّيح', undefined, db);
    expect(remaining).toEqual([]);
    const stillThere = await searchLibrary('حجر الماء', undefined, db);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]?.chapterId).toBe('ch01');
  });

  it('re-anchors highlights and bookmarks to the exact quoted text after a paragraph is inserted above them', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);
    const { book: before } = await readBookBundle(record.id, db);

    const quote = 'وَكَانَتِ الْمَكْتَبَةُ الْقَدِيمَةُ';
    const anchorBlock = before.chapters[2]?.blocks[1];
    expect(anchorBlock?.id).toBe('ch03_p0002');
    expect(anchorBlock?.html.startsWith(quote)).toBe(true);

    const state: BookReaderState = {
      anchor: null,
      progress: 0.4,
      highlights: [
        {
          id: 'hl-1',
          anchor: { blockId: 'ch03_p0002', charOffset: 0 },
          length: quote.length,
          color: 'gold',
          quote,
          contextBefore: '',
          contextAfter: ' فِي وَسَطِ الْمَدِينَةِ',
          chapterId: 'ch03',
          chapterTitle: before.chapters[2]?.title ?? '',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      bookmarkItems: [
        {
          id: 'bm-1',
          anchor: { blockId: 'ch03_p0002', charOffset: 0 },
          chapterId: 'ch03',
          chapterTitle: before.chapters[2]?.title ?? '',
          quote,
          contextBefore: '',
          contextAfter: ' فِي وَسَطِ الْمَدِينَةِ',
          createdAt: 1,
        },
      ],
      updatedAt: 1,
    };
    await saveBookReaderState(record.id, state, db);

    // A brand-new paragraph above the anchored one bumps its block id from p0002 to p0003.
    const shiftedBodies = [...CHAPTER_BODIES];
    shiftedBodies[2] = [
      'فَقْرَةٌ مُسْتَجِدَّةٌ أُضِيفَتْ فَوْقَ الْفَقْرَةِ الْمَرْجُوعِ إِلَيْهَا فِي التَّحْدِيثِ.',
      ...CHAPTER_BODIES[2]!.split('\n\n'),
    ].join('\n\n');

    const { delta, book: after, state: savedState } = await updateBookContentDelta(
      record.id,
      renderBook(shiftedBodies),
      db,
    );

    expect(delta.reparsedCount).toBe(1);
    expect(delta.changedChapterIds).toEqual(['ch03']);
    expect(after.chapters[2]?.blocks[2]?.id).toBe('ch03_p0003');

    const highlight = savedState.highlights?.[0];
    expect(highlight?.anchor.blockId).toBe('ch03_p0003');
    const highlightText = after.chapters[2]?.blocks[2]?.html ?? '';
    expect(highlightText.slice(highlight?.anchor.charOffset ?? -1)).toMatch(/^وَكَانَتِ/);
    expect(highlightText.startsWith(quote, highlight?.anchor.charOffset)).toBe(true);

    const bookmark = savedState.bookmarkItems?.[0];
    expect(bookmark?.anchor.blockId).toBe('ch03_p0003');
    expect(bookmark && highlightText.startsWith(quote, bookmark.anchor.charOffset)).toBe(true);

    // The re-anchored state is on disk, not only in the return value.
    const reopened = await readBookBundle(record.id, db);
    expect(reopened.state.highlights?.[0]?.anchor.blockId).toBe('ch03_p0003');
    expect(reopened.state.bookmarkItems?.[0]?.anchor.blockId).toBe('ch03_p0003');
  });

  it('recomputes anchors against a freshly parsed book without losing user fields', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);
    const { book } = await readBookBundle(record.id, db);
    const quote = 'وَكَانَتِ الْمَكْتَبَةُ الْقَدِيمَةُ';

    const result = reanchorReaderItems(book, {
      anchor: null,
      progress: 0,
      highlights: [
        {
          id: 'hl-2',
          anchor: { blockId: 'ch03_p0001', charOffset: 0 },
          length: quote.length,
          color: 'sage',
          quote,
          contextBefore: '',
          contextAfter: ' فِي وَسَطِ الْمَدِينَةِ',
          chapterId: 'ch03',
          chapterTitle: 'قَدِيم',
          note: 'مُلَاحَظَةٌ',
          createdAt: 5,
          updatedAt: 7,
        },
      ],
      updatedAt: 1,
    });

    expect(result.reanchoredHighlights).toBe(1);
    const item = result.state.highlights?.[0];
    expect(item?.anchor.blockId).toBe('ch03_p0002');
    expect(item?.chapterTitle).toBe(book.chapters[2]?.title);
    expect(item?.quote).toBe(quote);
    expect(item?.note).toBe('مُلَاحَظَةٌ');
    expect(item?.createdAt).toBe(5);
    expect(item?.updatedAt).toBe(7);
  });

  it('runs a delta re-parse when book.md changed on disk outside the app', async () => {
    const record = await importBookContent(BASE_TEXT, 'nour.md', db);

    // Leave a marker in the cached chapter 4 that a from-scratch parse could never produce.
    const cacheFile = new File(getBookDir(record.id), PARSED_CACHE_FILE);
    const cache = await readCacheFile(record.id);
    const sentinel = 'عُنْوَانٌ مِنَ الذَّاكِرَةِ';
    cache.book.chapters[3] = { ...cache.book.chapters[3]!, title: sentinel };
    await cacheFile.write(JSON.stringify(cache));

    const editedBodies = [...CHAPTER_BODIES];
    editedBodies[0] =
      'صَارَتْ نُورُ تَعْرِفُ الْبَحْرَ جَيِّدًا بَعْدَ سَنَوَاتٍ مِنَ الْغِيَابِ عَنْ قَرْيَتِهَا.';
    await new File(getBookDir(record.id), 'book.md').write(renderBook(editedBodies));

    const opened = await readBookBundle(record.id, db);

    // ch01 shows the new text, while the untouched ch04 came straight from the cached object.
    expect(opened.book.chapters[0]?.blocks[0]?.html).toContain('بَعْدَ سَنَوَاتٍ');
    expect(opened.book.chapters[3]?.title).toBe(sentinel);
    expect(opened.manifest.chapters[3]?.title).toBe(sentinel);
    expect(opened.manifest.chapters[0]?.rawHash).toBe(
      parseBook(renderBook(editedBodies), BOOK_FILE_NAME, { cleanArabic: true }).chapters[0]?.rawHash,
    );

    // FTS5 follows the delta: the new sentence is searchable and the removed one is gone.
    const newHits = await searchLibrary('سنوات الغياب', undefined, db);
    expect(newHits).toHaveLength(1);
    expect(newHits[0]?.chapterId).toBe('ch01');
    const oldHits = await searchLibrary('قبل أن تعرف اسمه', undefined, db);
    expect(oldHits).toEqual([]);

    // The refreshed cache now matches the new file, so the next open is a pure hit.
    const refreshed = await readCacheFile(record.id);
    expect(refreshed.rawTextHash).toBe(rawTextHash(renderBook(editedBodies)));
    resetFtsLog();
    await readBookBundle(record.id, db);
    expect(ftsStatements()).toEqual([]);
  });

  it('re-anchors inside the edited chapter when another chapter repeats the same quote', async () => {
    const quote = 'حِكَايَةٌ مُتَكَرِّرَةٌ فِي فَصْلَيْنِ.';
    const twinBodies = [
      'فَرِيدَةٌ فِي الْفَصْلِ الْأَوَّلِ.',
      [quote, 'ذَيْلُ الْفَصْلِ الثَّانِي.'].join('\n\n'),
      [quote, 'ذَيْلُ الْفَصْلِ الثَّالِثِ.'].join('\n\n'),
      'فَرِيدَةٌ فِي الْفَصْلِ الرَّابِعِ.',
    ];
    const record = await importBookContent(renderBook(twinBodies), 'twin.md', db);
    const { book: before } = await readBookBundle(record.id, db);

    expect(before.chapters[1]?.blocks[0]?.html).toBe(quote);
    expect(before.chapters[2]?.blocks[0]?.html).toBe(quote);

    await saveBookReaderState(
      record.id,
      {
        anchor: null,
        progress: 0.5,
        highlights: [
          {
            id: 'hl-twin',
            anchor: { blockId: 'ch03_p0001', charOffset: 0 },
            length: quote.length,
            color: 'gold',
            quote,
            contextBefore: '',
            contextAfter: '',
            chapterId: 'ch03',
            chapterTitle: before.chapters[2]?.title ?? '',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        updatedAt: 1,
      },
      db,
    );

    // A paragraph is inserted above the quote in ch03, while ch02 still holds the identical text.
    const shifted = [...twinBodies];
    shifted[2] = [
      'فَقْرَةٌ جَدِيدَةٌ أُضِيفَتْ فَوْقَ الِاقْتِبَاسِ.',
      ...twinBodies[2]!.split('\n\n'),
    ].join('\n\n');

    const { delta, state } = await updateBookContentDelta(record.id, renderBook(shifted), db);

    expect(delta.changedChapterIds).toEqual(['ch03']);
    const highlight = state.highlights?.[0];
    // The fuzzy search would have hit ch02's earlier copy; the chapter-scoped one must not.
    expect(highlight?.chapterId).toBe('ch03');
    expect(highlight?.anchor.blockId).toBe('ch03_p0002');
    expect(highlight?.anchor.charOffset).toBe(0);
    expect(highlight?.length).toBe(quote.length);
    expect(highlight?.anchor.blockId.startsWith('ch02')).toBe(false);
  });

  it('follows a reused chapter by id when chapters are reordered, preserving offset and length', async () => {
    const record = await importBookContent(BASE_TEXT, 'reorder.md', db);
    const { book: before } = await readBookBundle(record.id, db);
    const offset = 4;
    const length = 9;

    await saveBookReaderState(
      record.id,
      {
        anchor: null,
        progress: 0.2,
        highlights: [
          {
            id: 'hl-reorder',
            anchor: { blockId: 'ch01_p0001', charOffset: offset },
            length,
            color: 'sage',
            quote: 'نُورُ تَعْرِف',
            contextBefore: '',
            contextAfter: '',
            chapterId: 'ch01',
            chapterTitle: before.chapters[0]?.title ?? '',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        updatedAt: 1,
      },
      db,
    );

    const reordered = renderBookInOrder([1, 0, 2, 3]);
    const { delta, state } = await updateBookContentDelta(record.id, reordered, db);

    expect(delta.reusedChapterIdMap['ch01']).toBe('ch02');
    const highlight = state.highlights?.[0];
    expect(highlight?.chapterId).toBe('ch02');
    expect(highlight?.anchor.blockId).toBe('ch02_p0001');
    // Reused chapters keep the exact place in the text: no fuzzy search, no drift.
    expect(highlight?.anchor.charOffset).toBe(offset);
    expect(highlight?.length).toBe(length);
    expect(highlight?.chapterTitle).toBe(before.chapters[0]?.title);
  });

  it('leaves an anchor unmatched when its chapter was deleted, even if the same text moved elsewhere', async () => {
    const record = await importBookContent(BASE_TEXT, 'gone.md', db);
    const quote = 'ثُمَّ عَادَتِ الرِّيحُ';
    const length = quote.length;

    await saveBookReaderState(
      record.id,
      {
        anchor: null,
        progress: 0.9,
        highlights: [
          {
            id: 'hl-gone',
            anchor: { blockId: 'ch04_p0001', charOffset: 0 },
            length,
            color: 'gold',
            quote,
            contextBefore: '',
            contextAfter: '',
            chapterId: 'ch04',
            chapterTitle: 'الْفَصْلُ الرَّابِعُ',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        updatedAt: 1,
      },
      db,
    );

    // ch04 disappears as a chapter, but its exact sentence is appended to ch03.
    const merged = [
      CHAPTER_BODIES[0]!,
      CHAPTER_BODIES[1]!,
      `${CHAPTER_BODIES[2]!}\n\n${CHAPTER_BODIES[3]!}`,
    ];
    const { delta, state } = await updateBookContentDelta(record.id, renderBook(merged), db);

    expect(delta.removedChapterIds).toEqual(['ch04']);
    const highlight = state.highlights?.[0];
    // Untouched: not snapped into ch03 just because the sentence now lives there.
    expect(highlight?.chapterId).toBe('ch04');
    expect(highlight?.anchor.blockId).toBe('ch04_p0001');
    expect(highlight?.anchor.charOffset).toBe(0);
  });

  it('re-indexes FTS after a full parse when the parsed cache is missing', async () => {
    const record = await importBookContent(BASE_TEXT, 'nocache.md', db);
    const editedBodies = [...CHAPTER_BODIES];
    editedBodies[0] = 'بَدَايَةٌ جَدِيدَةٌ تَمَامًا لِلْفَصْلِ الْأَوَّلِ.';
    const editedText = renderBook(editedBodies);
    await new File(getBookDir(record.id), 'book.md').write(editedText);
    new File(getBookDir(record.id), PARSED_CACHE_FILE).delete();

    // The old index is still serving the deleted sentence right before the open.
    expect(await searchLibrary('قبل أن تعرف اسمه', undefined, db)).toHaveLength(1);
    expect(await searchLibrary('بدايه جديده تماما', undefined, db)).toEqual([]);

    const { book } = await readBookBundle(record.id, db);

    expect(book.chapters[0]?.blocks[0]?.html).toContain('بَدَايَةٌ جَدِيدَةٌ');
    expect(await searchLibrary('بدايه جديده تماما', undefined, db)).toHaveLength(1);
    expect(await searchLibrary('قبل أن تعرف اسمه', undefined, db)).toEqual([]);
    expect(await readSearchIndexHash(record.id, db)).toBe(computeSearchContentHash(book));
    const cache = await readCacheFile(record.id);
    expect(cache.rawTextHash).toBe(rawTextHash(editedText));
  });

  it('re-indexes FTS after a full parse when the parsed cache is structurally invalid', async () => {
    const record = await importBookContent(BASE_TEXT, 'badcache.md', db);
    const editedBodies = [...CHAPTER_BODIES];
    editedBodies[1] = 'نَصٌّ مُخْتَلِفٌ تَمَامًا فِي الْفَصْلِ الثَّانِي.';
    const editedText = renderBook(editedBodies);
    await new File(getBookDir(record.id), 'book.md').write(editedText);

    const cacheFile = new File(getBookDir(record.id), PARSED_CACHE_FILE);
    const cache = await readCacheFile(record.id);
    cache.book.chapters[0] = {
      ...cache.book.chapters[0]!,
      blocks: [{ id: 'ch01_p0001', kind: 'not-a-kind', html: '' } as never],
    };
    await cacheFile.write(JSON.stringify(cache));

    const { book } = await readBookBundle(record.id, db);

    // The malformed cache was ignored and the file re-parsed from `book.md`.
    expect(book.chapters[1]?.blocks[0]?.html).toContain('نَصٌّ مُخْتَلِفٌ');
    expect(await searchLibrary('نص مختلف', undefined, db)).toHaveLength(1);
    expect(await searchLibrary('ذهب موسي', undefined, db)).toEqual([]);
    expect(await readSearchIndexHash(record.id, db)).toBe(computeSearchContentHash(book));
  });

  it('rebuilds the whole index when the delta baseline marker is missing', async () => {
    const record = await importBookContent(BASE_TEXT, 'baseline.md', db);
    await readBookBundle(record.id, db);

    // Simulate an index left by an older app version: rows exist, but no marker was written.
    await db.runAsync('DELETE FROM kv WHERE key = ?', `search_index_hash:${record.id}`);
    // And ch02's row is missing for an unrelated reason; only a whole-book rebuild restores it.
    await db.runAsync(
      'DELETE FROM book_search_fts WHERE book_id = ? AND chapter_id = ?',
      record.id,
      'ch02',
    );

    const editedBodies = [...CHAPTER_BODIES];
    editedBodies[0] = 'نَصٌّ جَدِيدٌ فِي الْفَصْلِ الْأَوَّلِ.';
    const { book } = await updateBookContentDelta(record.id, renderBook(editedBodies), db);

    expect(await searchLibrary('نص جديد في الفصل الاول', undefined, db)).toHaveLength(1);
    expect(await searchLibrary('ذهب موسي', undefined, db)).toHaveLength(1);
    expect(await readSearchIndexHash(record.id, db)).toBe(computeSearchContentHash(book));
  });

  it('keeps the content update when the parsed cache cannot be written', async () => {
    const record = await importBookContent(BASE_TEXT, 'readonly.md', db);
    const editedBodies = [...CHAPTER_BODIES];
    editedBodies[1] = 'نَصٌّ جَدِيدٌ فِي الْفَصْلِ الثَّانِي.';
    const editedText = renderBook(editedBodies);

    const originalWrite = File.prototype.write;
    const writeSpy = jest
      .spyOn(File.prototype, 'write')
      .mockImplementation(async function (this: File, ...args: Parameters<File['write']>) {
        if (this.uri.includes(PARSED_CACHE_FILE)) {
          throw new Error('injected ENOSPC');
        }
        return originalWrite.apply(this, args);
      });

    let updatedBook: Book;
    try {
      ({ book: updatedBook } = await updateBookContentDelta(record.id, editedText, db));
    } finally {
      writeSpy.mockRestore();
    }

    // A failed cache write never fails the update: book.md, the manifest and search all moved.
    expect(updatedBook.chapters[1]?.blocks[0]?.html).toContain('نَصٌّ جَدِيدٌ');
    expect(await new File(getBookDir(record.id), 'book.md').text()).toContain('نَصٌّ جَدِيدٌ');
    expect(await searchLibrary('نص جديد', undefined, db)).toHaveLength(1);
    expect(await searchLibrary('ذهب موسي', undefined, db)).toEqual([]);
  });
});
