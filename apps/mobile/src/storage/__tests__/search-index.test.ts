import { Directory, Paths } from 'expo-file-system';

import { deleteBookBundle, importBookContent } from '@/storage/bundle';
import { initDatabase, upsertBook, type DatabaseAdapter } from '@/storage/database';
import {
  buildFtsQuery,
  ensureLibrarySearchIndexed,
  indexBookForSearch,
  removeBookFromSearch,
  searchLibrary,
} from '@/storage/search-index';
import {
  buildSearchSnippet,
  findMatchOffsetInOriginal,
  normalizeArabicForSearch,
  stripHtmlToPlainText,
} from '@/storage/search-normalize';

function createRealSqliteMemoryAdapter(): { adapter: DatabaseAdapter; close: () => void } {
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

  const adapter: DatabaseAdapter = {
    async execAsync(source: string) {
      sqliteDb.exec(source);
    },
    async runAsync(source: string, ...params: unknown[]) {
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

  return { adapter, close: () => sqliteDb.close() };
}

function clearBooksDir() {
  const root = new Directory(Paths.document, 'books');
  if (root.exists) {
    root.delete();
  }
}

const NOVEL_ONE_MD = `---
title: "حَجَرُ الْمَاءِ"
author: "روايتي"
lang: ar
dir: rtl
---

# الْفَصْلُ الْأَوَّلُ: الْمِفْتَاحُ الصَّدِئُ

كَانَتْ نُورُ تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ، وَفِي قَرْيَةِ رَأْسِ الْمِلْحِ كَانَ حَجَرُ الْمَاءِ مَوْجُودًا مُنْذُ الْقِدَمِ.

أَخْبَرَهَا الْجَدُّ أَنَّ أَسْمَاءَ الْقَرْيَةِ مَحْفُورَةٌ عَلَى الطِّينِ مُنْذُ زَمَنٍ بَعِيدٍ.

# الْفَصْلُ الثَّانِي: عَوْدَةُ مُوسَى

ذَهَبَ مُوسَى إِلَى الْمِينَاءِ عِنْدَ الْفَجْرِ لِيَبْحَثَ عَنْ صَدِيقِهِ.
`;

const NOVEL_TWO_MD = `---
title: "أَيَّامُ الْإِسْكَنْدَرِيَّةِ"
author: "مؤلف ثان"
lang: ar
dir: rtl
---

# الْفَصْلُ الْأَوَّلُ

فِي مَدِينَةٍ بَعِيدَةٍ تَظْهَرُ مَكْتَبَةٌ قَدِيمَةٌ تُسَمَّى دَارَ السَّلَامِ.
`;

describe('search-normalize & real SQLite FTS5 search-index', () => {
  let db: DatabaseAdapter;
  let closeDb: () => void;

  beforeEach(async () => {
    clearBooksDir();
    const created = createRealSqliteMemoryAdapter();
    db = created.adapter;
    closeDb = created.close;
    await initDatabase(db);
  });

  afterEach(() => {
    closeDb();
  });

  it('strips HTML tags, footnote refs, and entities without breaking words', () => {
    const html =
      'كَانَ <em>الْحَجَرُ</em><sup class="fn-ref"><a href="#fn-1" data-fn="1">1</a></sup> وَ&quot;الْمَاءُ&quot; &amp; &lt;الْبَحْرُ&gt;&nbsp;فِي&#39;الْقَرْيَةِ<br>جَدِيدًا';
    expect(stripHtmlToPlainText(html)).toBe(
      'كَانَ الْحَجَرُ وَ"الْمَاءُ" & <الْبَحْرُ> فِي\'الْقَرْيَةِ جَدِيدًا',
    );
  });

  it('normalizes Arabic diacritics, tatweel, alef variants, taa marbuta, and alef maksura', () => {
    expect(normalizeArabicForSearch('حَجَـرُ الْمَـاءِ')).toBe('حجر الماء');
    expect(normalizeArabicForSearch('أَحْمَدُ إِبْرَاهِيمُ آدَمُ ٱلْيَوْمَ')).toBe(
      'احمد ابراهيم ادم اليوم',
    );
    expect(normalizeArabicForSearch('قَرْيَةٌ جَمِيلَةٌ عَلَى مُوسَى')).toBe(
      'قريه جميله علي موسي',
    );
    expect(normalizeArabicForSearch('  Hello   WORLD  ')).toBe('hello world');
  });

  it('computes accurate charOffset and snippet in vocalized original text', () => {
    const original = 'كَانَتْ نُورُ تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ.';
    const offset = findMatchOffsetInOriginal(original, 'البحر');
    expect(original.slice(offset)).toMatch(/^الْبَحْرَ/);

    const snippet = buildSearchSnippet(original, offset, 'الْبَحْرَ'.length, 14);
    expect(snippet.match).toBe('الْبَحْرَ');
    expect(snippet.before.startsWith('…')).toBe(true);
    expect(snippet.after.endsWith('…')).toBe(true);
  });

  it('indexes on import and finds vocalized Arabic via unvocalized, alef, taa marbuta, and alef maksura queries', async () => {
    const rec1 = await importBookContent(NOVEL_ONE_MD, 'novel1.md', db);

    const waterHits = await searchLibrary('حجر الماء', undefined, db);
    expect(waterHits.length).toBeGreaterThanOrEqual(1);
    expect(waterHits[0]?.bookId).toBe(rec1.id);
    expect(waterHits[0]?.bookTitle).toBe('حَجَرُ الْمَاءِ');
    expect(waterHits[0]?.chapterId).toBe('ch01');
    expect(waterHits[0]?.snippetMatch).toContain('حَجَرُ الْمَاءِ');

    // Exact charOffset points into vocalized text
    const expectedText =
      'كَانَتْ نُورُ تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ، وَفِي قَرْيَةِ رَأْسِ الْمِلْحِ كَانَ حَجَرُ الْمَاءِ مَوْجُودًا مُنْذُ الْقِدَمِ.';
    expect(expectedText.slice(waterHits[0]!.charOffset)).toMatch(/^حَجَرُ الْمَاءِ/);

    // Alef normalization: اسماء matches أَسْمَاءَ
    const alefHits = await searchLibrary('اسماء القريه', undefined, db);
    expect(alefHits).toHaveLength(1);

    // Taa marbuta: قريه matches قَرْيَةِ and قرية matches قَرْيَةِ
    const taaHits = await searchLibrary('قرية', undefined, db);
    expect(taaHits.length).toBeGreaterThanOrEqual(1);

    // Alef maksura: موسي and علي match مُوسَى and عَلَى
    const maksuraHits = await searchLibrary('موسي', undefined, db);
    expect(maksuraHits).toHaveLength(1);
    expect(maksuraHits[0]?.chapterId).toBe('ch02');
  });

  it('supports scoping by bookId vs searching the entire library and removes hits on book deletion', async () => {
    const rec1 = await importBookContent(NOVEL_ONE_MD, 'novel1.md', db);
    const rec2 = await importBookContent(NOVEL_TWO_MD, 'novel2.md', db);

    // Both books mention "بعيدة/بعيد"
    const allHits = await searchLibrary('بعيد', undefined, db);
    expect(allHits.map((h) => h.bookId).sort()).toEqual([rec1.id, rec2.id].sort());

    const scopedHits = await searchLibrary('بعيد', { bookId: rec2.id }, db);
    expect(scopedHits).toHaveLength(1);
    expect(scopedHits[0]?.bookId).toBe(rec2.id);
    expect(scopedHits[0]?.bookTitle).toBe('أَيَّامُ الْإِسْكَنْدَرِيَّةِ');

    await deleteBookBundle(rec1.id, db);
    expect(await searchLibrary('حجر الماء', undefined, db)).toEqual([]);
    expect(await searchLibrary('مكتبه', undefined, db)).toHaveLength(1);

    await removeBookFromSearch(rec2.id, db);
    expect(await searchLibrary('مكتبه', undefined, db)).toEqual([]);
  });

  it('safely escapes all FTS5 special characters and operators without throwing', async () => {
    await importBookContent(NOVEL_ONE_MD, 'novel1.md', db);

    const nastyQueries = [
      '"""',
      '* ^ ( ) : - +',
      'AND OR NOT NEAR',
      'norm_text:حجر OR "ماء"*',
      '(حجر + الماء)^2 -البحر',
      'نور*',
      '"""""',
      '؟!،؛/\\[]{}',
    ];

    for (const q of nastyQueries) {
      expect(() => buildFtsQuery(q)).not.toThrow();
      await expect(searchLibrary(q, undefined, db)).resolves.toEqual(expect.any(Array));
    }
  });

  it('backfills pre-existing books via ensureLibrarySearchIndexed', async () => {
    const legacyBookId = 'legacy_book_01';
    await upsertBook(
      {
        id: legacyBookId,
        title: 'كتاب قديم',
        author: null,
        dir: 'rtl',
        coverSeed: 'كتاب قديم',
        coverColor: null,
        progress: 0,
        lastOpenedAt: 1000,
        addedAt: 1000,
      },
      db,
    );

    expect(await searchLibrary('الصحراء', undefined, db)).toEqual([]);

    await ensureLibrarySearchIndexed(db, async (id) => {
      expect(id).toBe(legacyBookId);
      return {
        book: {
          id: legacyBookId,
          meta: { title: 'كتاب قديم', lang: 'ar', dir: 'rtl' },
          chapters: [
            {
              id: 'ch01',
              title: 'الفصل الأول',
              wordCount: 5,
              hash: 'h1',
              blocks: [{ id: 'ch01_p0001', kind: 'p', html: 'قَافِلَةُ الصَّحْرَاءِ الْكُبْرَى' }],
            },
          ],
          footnotes: {},
          wordCount: 5,
        },
      };
    });

    const hits = await searchLibrary('الصحراء', undefined, db);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.bookId).toBe(legacyBookId);
  });

  it('searches across a multi-book, multi-chapter library in under 15ms on average', async () => {
    const bookCount = 5;
    const chaptersPerBook = 10;
    const blocksPerChapter = 20;

    for (let b = 0; b < bookCount; b++) {
      const bookId = `perf_book_${b}`;
      await upsertBook(
        {
          id: bookId,
          title: `رواية رقم ${b}`,
          author: 'مؤلف',
          dir: 'rtl',
          coverSeed: `رواية رقم ${b}`,
          coverColor: null,
          progress: 0,
          lastOpenedAt: 1000 + b,
          addedAt: 1000 + b,
        },
        db,
      );

      const chapters = [];
      const motifs = [
        'الْمِينَاءُ الْقَدِيمُ يَحْتَفِظُ بِأَسْرَارِ الْبَحْرِ.',
        'الْقَافِلَةُ تَعْبُرُ الصَّحْرَاءَ قَبْلَ طُلُوعِ الْفَجْرِ.',
        'الْمَكْتَبَةُ تَضُمُّ مَخْطُوطَاتٍ نَادِرَةً مِنْ كُلِّ مَدِينَةٍ.',
        'السَّمَاءُ الصَّافِيَةُ تَعْكِسُ أَضْوَاءَ الْقَرْيَةِ الْبَعِيدَةِ.',
        'النَّهْرُ يَجْرِي بِهُدُوءٍ بَيْنَ الْجِبَالِ وَالْأَشْجَارِ.',
      ];
      for (let c = 0; c < chaptersPerBook; c++) {
        const blocks = [];
        for (let p = 0; p < blocksPerChapter; p++) {
          const special =
            b === 3 && c === 7 && p === 12
              ? ' وَهُنَا ظَهَرَ اللُّؤْلُؤُ الْمَخْبُوءُ فِي الْبِئْرِ.'
              : '';
          blocks.push({
            id: `ch${c + 1}_p${p + 1}`,
            kind: 'p' as const,
            html: `${motifs[(b + c + p) % motifs.length]!} حِكَايَةُ رَقْمِ ${b}_${c}_${p}.${special}`,
          });
        }
        chapters.push({
          id: `ch${c + 1}`,
          title: `الفصل ${c + 1}`,
          blocks,
          wordCount: 200,
          hash: `h_${b}_${c}`,
        });
      }

      await indexBookForSearch(
        {
          id: bookId,
          meta: { title: `رواية رقم ${b}`, author: 'مؤلف', lang: 'ar', dir: 'rtl' },
          chapters,
          footnotes: {},
          wordCount: 2000,
        },
        db,
      );
    }

    // Warm-up queries
    await searchLibrary('البحر', undefined, db);
    await searchLibrary('اللؤلؤ', undefined, db);

    const queries = ['اللؤلؤ', 'الميناء القديم', 'الصحراء', 'مخطوطات نادره', 'الجبال'];
    const iterations = 10;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const hits = await searchLibrary(queries[i % queries.length]!, undefined, db);
      expect(hits.length).toBeGreaterThan(0);
    }
    const elapsedMs = performance.now() - start;
    const avgMs = elapsedMs / iterations;

    expect(avgMs).toBeLessThan(15);
  });
});
