import * as SQLite from 'expo-sqlite';

import {
  buildWiktionaryEntryUrl,
  DICTIONARY_ATTRIBUTION,
  lookupDictionaryWord,
  openBundledDictionaryDb,
  resetBundledDictionaryDbCache,
  type DictionaryDbAdapter,
} from '@/storage/dictionary';
import { generateStemCandidates, normalizeArabicWord } from '@/storage/arabic-stemmer';

type NodeSqliteRow = Record<string, unknown>;

type NodeSqliteStatement = {
  run: (...params: unknown[]) => { changes: number | bigint };
  get: (...params: unknown[]) => NodeSqliteRow | undefined;
  all: (...params: unknown[]) => NodeSqliteRow[];
};

type NodeSqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => NodeSqliteStatement;
  close: () => void;
};

type FixtureEntry = {
  word: string;
  norm: string;
  pos: string | null;
  root: string | null;
  defs: string;
};

/**
 * Real in-memory SQLite behind the `DictionaryDbAdapter` surface. The rows are
 * synthetic — no Wiktionary text and no book text is copied into the repo.
 */
function createDictionaryDb(entries: readonly FixtureEntry[]): {
  adapter: DictionaryDbAdapter;
  close: () => void;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => NodeSqliteDatabase;
  };
  const sqliteDb = new DatabaseSync(':memory:');
  sqliteDb.exec(`
    CREATE TABLE entries (
      id INTEGER PRIMARY KEY,
      word TEXT NOT NULL,
      norm TEXT NOT NULL,
      pos TEXT,
      root TEXT,
      defs TEXT NOT NULL
    );
    CREATE INDEX idx_entries_norm ON entries(norm);
  `);
  const insert = sqliteDb.prepare(
    'INSERT INTO entries (word, norm, pos, root, defs) VALUES (?, ?, ?, ?, ?)',
  );
  for (const entry of entries) {
    insert.run(entry.word, entry.norm, entry.pos, entry.root, entry.defs);
  }

  const adapter: DictionaryDbAdapter = {
    async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
      return sqliteDb.prepare(source).all(...params) as T[];
    },
  };

  return { adapter, close: () => sqliteDb.close() };
}

const FIXTURES: readonly FixtureEntry[] = [
  {
    word: 'كتاب',
    norm: 'كتاب',
    pos: 'اسم',
    root: 'ك ت ب',
    defs: 'صحائف مجموعة بين غلافين.\nمجموع ما يُكتب.',
  },
  {
    word: 'مكتبة',
    norm: 'مكتبه',
    pos: 'اسم',
    root: 'ك ت ب',
    defs: 'مكان تُحفظ فيه الكتب.',
  },
  {
    word: 'معلمة',
    norm: 'معلمه',
    pos: 'اسم',
    root: 'ع ل م',
    defs: 'من تتولى التعليم.',
  },
  {
    word: 'كتب',
    norm: 'كتب',
    pos: 'فعل',
    root: 'ك ت ب',
    defs: 'سجّل الحروف على الورق.\n',
  },
];

describe('normalizeArabicWord', () => {
  it('strips tashkeel, tatweel and punctuation', () => {
    expect(normalizeArabicWord('الْكِتَابُ')).toBe('الكتاب');
    expect(normalizeArabicWord(' كَـاتِب، ')).toBe('كاتب');
    expect(normalizeArabicWord('«مَدْرَسَةٌ»')).toBe('مدرسه');
  });

  it('folds alef, alef maksura, taa marbuta, waw and yaa hamza', () => {
    expect(normalizeArabicWord('أَحْمَد')).toBe('احمد');
    expect(normalizeArabicWord('إِبْرَاهِيمُ')).toBe('ابراهيم');
    expect(normalizeArabicWord('آدَم')).toBe('ادم');
    expect(normalizeArabicWord('ٱلْيَوْم')).toBe('اليوم');
    expect(normalizeArabicWord('مُوسَى')).toBe('موسي');
    expect(normalizeArabicWord('شَاطِئ')).toBe('شاطي');
    expect(normalizeArabicWord('مُؤْمِن')).toBe('مومن');
  });

  it('returns an empty string when there is no Arabic content', () => {
    expect(normalizeArabicWord('')).toBe('');
    expect(normalizeArabicWord('hello world')).toBe('');
    expect(normalizeArabicWord('12345')).toBe('');
  });
});

describe('generateStemCandidates', () => {
  it('starts with the exact normalized word and never repeats a candidate', () => {
    const candidates = generateStemCandidates('الْكِتَابُ');
    expect(candidates[0]).toBe('الكتاب');
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates.every((candidate) => candidate.length >= 2)).toBe(true);
  });

  it('strips definite-article and conjunction prefixes', () => {
    expect(generateStemCandidates('وَالْكِتَاب')).toContain('كتاب');
    expect(generateStemCandidates('بِالْمَكْتَبَة')).toContain('مكتبه');
    expect(generateStemCandidates('لِلْقِرَاءَة')).toContain('قراءه');
  });

  it('strips pronoun and plural suffixes', () => {
    expect(generateStemCandidates('كِتَابُهُمْ')).toContain('كتاب');
    expect(generateStemCandidates('مَكْتَبَات')).toContain('مكتب');
    expect(generateStemCandidates('مُعَلِّمُونَ')).toContain('معلم');
  });

  it('restores the feminine taa when a suffix is removed', () => {
    expect(generateStemCandidates('مُعَلِّمَتُهُ')).toContain('معلمه');
  });

  it('strips verb prefixes', () => {
    const candidates = generateStemCandidates('يَكْتُبُونَ');
    expect(candidates).toContain('كتب');
    expect(generateStemCandidates('سَيَكْتُب')).toContain('كتب');
    expect(generateStemCandidates('لِيَكْتُب')).toContain('كتب');
  });

  it('returns an empty array for non-Arabic or too-short input', () => {
    expect(generateStemCandidates('')).toEqual([]);
    expect(generateStemCandidates('book')).toEqual([]);
    expect(generateStemCandidates('!!')).toEqual([]);
    expect(generateStemCandidates('ب')).toEqual([]);
  });
});

/**
 * The Python builder and this TypeScript stemmer must agree character for
 * character, or the app looks up a key the database never stored.
 */
describe('builder/stemmer normalization parity', () => {
  it('strips hyphens and punctuation exactly like scripts/build-dictionary.py', () => {
    expect(normalizeArabicWord('أ-ب')).toBe('اب');
    expect(normalizeArabicWord('كِتَابٌ،؟!.')).toBe('كتاب');
    expect(normalizeArabicWord('«مَدْرَسَةٌ»')).toBe('مدرسه');
    // `normalize_ar` (Python) of the same inputs yields these same strings; see
    // scripts/test_build_dictionary.py::test_normalize_ar_strips_punctuation_like_the_ts_stemmer
  });

  it('rejects a one-letter word consistently with the builder', () => {
    expect(normalizeArabicWord('ب')).toBe('ب');
    expect(generateStemCandidates('ب')).toEqual([]);
    // The builder rejects it too (`normalize_entry_word` returns None), so a
    // one-letter row can never exist for the app to miss.
  });
});

describe('buildWiktionaryEntryUrl', () => {
  it('points at the Arabic Wiktionary page and its contributors history', () => {
    expect(buildWiktionaryEntryUrl('كتاب')).toEqual({
      pageUrl: 'https://ar.wiktionary.org/wiki/%D9%83%D8%AA%D8%A7%D8%A8',
      historyUrl:
        'https://ar.wiktionary.org/w/index.php?title=%D9%83%D8%AA%D8%A7%D8%A8&action=history',
    });
  });

  it('omits the action=history query string from the page URL', () => {
    const { pageUrl, historyUrl } = buildWiktionaryEntryUrl('بحر');
    expect(pageUrl).toBe('https://ar.wiktionary.org/wiki/%D8%A8%D8%AD%D8%B1');
    expect(pageUrl).not.toContain('action=history');
    expect(historyUrl).toContain('action=history');
    expect(decodeURIComponent(historyUrl)).toContain('title=بحر');
  });

  it('percent-encodes characters that would break a URL', () => {
    const { pageUrl, historyUrl } = buildWiktionaryEntryUrl('أ-ب');
    expect(pageUrl).toBe('https://ar.wiktionary.org/wiki/%D8%A3-%D8%A8');
    expect(pageUrl).not.toMatch(/[^\x20-\x7E]/);
    expect(historyUrl).not.toMatch(/[^\x20-\x7E]/);
  });

  it('never throws for hostile input', () => {
    for (const word of ['', ' ', '&?=#', 'كتاب/../x', undefined as unknown as string]) {
      expect(() => buildWiktionaryEntryUrl(word)).not.toThrow();
    }
  });
});

describe('lookupDictionaryWord', () => {
  let adapter: DictionaryDbAdapter;
  let close: () => void;

  beforeEach(() => {
    const created = createDictionaryDb(FIXTURES);
    adapter = created.adapter;
    close = created.close;
  });

  afterEach(() => {
    close();
  });

  it('finds an exact match and splits definitions into a list', async () => {
    const result = await lookupDictionaryWord('كِتَاب', adapter);

    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('expected found');
    expect(result.matchType).toBe('exact');
    expect(result.matchedNorm).toBe('كتاب');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      word: 'كتاب',
      norm: 'كتاب',
      pos: 'اسم',
      root: 'ك ت ب',
      definitions: ['صحائف مجموعة بين غلافين.', 'مجموع ما يُكتب.'],
    });
    expect(result.attribution).toBe(DICTIONARY_ATTRIBUTION);
  });

  it('falls back to a stemmed match and reports the matched form', async () => {
    const result = await lookupDictionaryWord('وَالْكِتَاب', adapter);

    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('expected found');
    expect(result.matchType).toBe('stemmed');
    expect(result.matchedNorm).toBe('كتاب');
  });

  it('matches feminine variants through the taa restoration', async () => {
    const result = await lookupDictionaryWord('مُعَلِّمَتُهُ', adapter);

    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('expected found');
    expect(result.matchedNorm).toBe('معلمه');
  });

  it('matches plural verb forms through the light stemmer', async () => {
    const result = await lookupDictionaryWord('يَكْتُبُونَ', adapter);

    expect(result.status).toBe('found');
    if (result.status !== 'found') throw new Error('expected found');
    expect(result.matchedNorm).toBe('كتب');
    expect(result.matchType).toBe('stemmed');
  });

  it('prefers the exact word over any stemmed candidate', async () => {
    const withBoth = createDictionaryDb([
      ...FIXTURES,
      { word: 'الكتاب', norm: 'الكتاب', pos: 'اسم', root: null, defs: 'مدخل مركب تجريبي.' },
    ]);
    try {
      const result = await lookupDictionaryWord('الكتاب', withBoth.adapter);
      expect(result.status).toBe('found');
      if (result.status !== 'found') throw new Error('expected found');
      expect(result.matchType).toBe('exact');
      expect(result.matchedNorm).toBe('الكتاب');
    } finally {
      withBoth.close();
    }
  });

  it('returns not_found for unknown Arabic words', async () => {
    const result = await lookupDictionaryWord('زَقْزَقَة', adapter);

    expect(result).toEqual({
      status: 'not_found',
      query: 'زَقْزَقَة',
      normalized: 'زقزقه',
      attribution: DICTIONARY_ATTRIBUTION,
    });
  });

  it('returns not_found without touching the database for non-Arabic input', async () => {
    const getAllAsync = jest.fn();
    const spyAdapter: DictionaryDbAdapter = { getAllAsync };

    const result = await lookupDictionaryWord('hello', spyAdapter);

    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('expected not_found');
    expect(result.normalized).toBe('');
    expect(getAllAsync).not.toHaveBeenCalled();
  });

  it('returns unavailable when no database is provided', async () => {
    const result = await lookupDictionaryWord('كتاب', null);

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') throw new Error('expected unavailable');
    expect(result.reasonAr).toBe('القاموس غير متاح حالياً على الجهاز.');
    expect(result.attribution.license).toBe('CC BY-SA 4.0');
  });

  it('returns unavailable instead of throwing when the database fails', async () => {
    const failingAdapter: DictionaryDbAdapter = {
      async getAllAsync() {
        throw new Error('no such table: entries');
      },
    };

    const result = await lookupDictionaryWord('كتاب', failingAdapter);

    expect(result.status).toBe('unavailable');
    expect(result.attribution).toBe(DICTIONARY_ATTRIBUTION);
  });

  it('never throws for hostile input', async () => {
    const hostile = ['', '!!!', '\u0000', '،؛؟', 'a1b2', 'ﷺ'];

    for (const word of hostile) {
      await expect(lookupDictionaryWord(word, adapter)).resolves.toMatchObject({
        attribution: DICTIONARY_ATTRIBUTION,
      });
    }
    await expect(
      lookupDictionaryWord(undefined as unknown as string, adapter),
    ).resolves.toMatchObject({ status: 'not_found' });
  });

  it('chunks very large candidate lists into safe IN (...) queries', async () => {
    const calls: string[] = [];
    const rows = [
      { word: 'كتاب', norm: 'كتاب', pos: 'اسم', root: null, defs: 'تعريف.' },
    ];
    const chunkedAdapter: DictionaryDbAdapter = {
      async getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]> {
        calls.push(source);
        expect(source).toMatch(/WHERE norm IN \((?:\?, )+\?\)/);
        expect(params.length).toBeLessThan(999);
        return (params.includes('كتاب') ? rows : []) as T[];
      },
    };

    const result = await lookupDictionaryWord('كتاب', chunkedAdapter);
    expect(result.status).toBe('found');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('dictionary key parity with the Python builder', () => {
  it('finds a hyphenated headword stored under its stripped normalized key', async () => {
    // `scripts/build-dictionary.py` stores this row as norm "اب" because its
    // `normalize_ar` strips the hyphen just like `normalizeArabicWord` does.
    const { adapter, close } = createDictionaryDb([
      { word: 'أ-ب', norm: 'اب', pos: 'اسم', root: null, defs: 'تعريف مركّب بشرطة.' },
    ]);
    try {
      const result = await lookupDictionaryWord('أ-ب', adapter);

      expect(result.status).toBe('found');
      if (result.status !== 'found') throw new Error('expected found');
      expect(result.matchedNorm).toBe('اب');
      expect(result.matchType).toBe('exact');
      expect(result.entries[0]?.definitions).toEqual(['تعريف مركّب بشرطة.']);
    } finally {
      close();
    }
  });

  it('never queries the database for a one-letter word the builder refuses to store', async () => {
    const getAllAsync = jest.fn();
    const spyAdapter: DictionaryDbAdapter = { getAllAsync };

    const result = await lookupDictionaryWord('ب', spyAdapter);

    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('expected not_found');
    expect(result.normalized).toBe('ب');
    expect(getAllAsync).not.toHaveBeenCalled();
  });
});

describe('openBundledDictionaryDb', () => {
  type FakeDb = {
    getFirstAsync: jest.Mock;
    getAllAsync: jest.Mock;
    closeAsync: jest.Mock;
  };

  const openDatabaseAsync = SQLite.openDatabaseAsync as unknown as jest.Mock;

  function makeFakeDb(options: {
    hasEntriesTable: boolean;
    rows?: FixtureEntry[];
  }): FakeDb {
    return {
      getFirstAsync: jest.fn(async () =>
        options.hasEntriesTable ? { name: 'entries' } : undefined,
      ),
      getAllAsync: jest.fn(async () => options.rows ?? []),
      closeAsync: jest.fn(async () => undefined),
    };
  }

  beforeEach(() => {
    resetBundledDictionaryDbCache();
    openDatabaseAsync.mockReset();
  });

  it('does not cache null when the entries table is missing yet', async () => {
    const unready = makeFakeDb({ hasEntriesTable: false });
    const ready = makeFakeDb({
      hasEntriesTable: true,
      rows: [
        { word: 'كتاب', norm: 'كتاب', pos: 'اسم', root: null, defs: 'تعريف كتاب تجريبي.' },
      ],
    });
    openDatabaseAsync.mockResolvedValueOnce(unready).mockResolvedValueOnce(ready);

    // First call: the database exists but the table is not there yet.
    await expect(openBundledDictionaryDb()).resolves.toBeNull();
    expect(unready.closeAsync).toHaveBeenCalledTimes(1);
    const firstLookup = await lookupDictionaryWord('كتاب', null);
    expect(firstLookup.status).toBe('unavailable');

    // Second call in the SAME session must retry, not replay the cached null.
    const handle = await openBundledDictionaryDb();
    expect(handle).not.toBeNull();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);

    const found = await lookupDictionaryWord('كتاب', handle);
    expect(found.status).toBe('found');
    if (found.status !== 'found') throw new Error('expected found');
    expect(found.entries[0]?.definitions).toEqual(['تعريف كتاب تجريبي.']);
  });

  it('caches only a verified handle', async () => {
    const ready = makeFakeDb({ hasEntriesTable: true });
    openDatabaseAsync.mockResolvedValue(ready);

    const first = await openBundledDictionaryDb();
    const second = await openBundledDictionaryDb();

    expect(first).toBe(second);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(ready.closeAsync).not.toHaveBeenCalled();
  });

  it('closes the handle and retries after a failed open', async () => {
    const ready = makeFakeDb({ hasEntriesTable: true });
    openDatabaseAsync
      .mockRejectedValueOnce(new Error('unable to open database file'))
      .mockResolvedValueOnce(ready);

    await expect(openBundledDictionaryDb()).resolves.toBeNull();
    await expect(openBundledDictionaryDb()).resolves.not.toBeNull();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it('closes the handle when the schema probe throws', async () => {
    const broken = makeFakeDb({ hasEntriesTable: true });
    broken.getFirstAsync.mockRejectedValueOnce(new Error('no such table: sqlite_master'));
    openDatabaseAsync.mockResolvedValueOnce(broken).mockResolvedValueOnce(null);

    await expect(openBundledDictionaryDb()).resolves.toBeNull();
    expect(broken.closeAsync).toHaveBeenCalledTimes(1);
    // The cache was cleared, so the next call opens again (and fails calmly).
    await expect(openBundledDictionaryDb()).resolves.toBeNull();
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
  });
});
