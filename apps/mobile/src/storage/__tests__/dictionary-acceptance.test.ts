/**
 * Blind acceptance tests — L3 Wave 2.
 *
 * Deliverables:
 *   - F49 Offline Arabic stemmer (`@/storage/arabic-stemmer`)
 *   - Offline dictionary lookup (`@/storage/dictionary`)
 *
 * Written ONLY from the agreed contract:
 *
 *   normalizeArabicWord(input: string): string
 *   generateStemCandidates(rawWord: string): string[]
 *   lookupDictionaryWord(rawWord: string, db?: DictionaryDbAdapter | null)
 *   DICTIONARY_ATTRIBUTION
 *
 * The database is a fixture adapter — the tests never depend on the real SQLite driver
 * or on the exact SQL the implementation emits, only on the documented row shape.
 */
import { generateStemCandidates, normalizeArabicWord } from '@/storage/arabic-stemmer';
import { DICTIONARY_ATTRIBUTION, lookupDictionaryWord } from '@/storage/dictionary';
import type { DictionaryDbAdapter } from '@/storage/dictionary';

type DictionaryRow = {
  word: string;
  norm: string;
  pos: string | null;
  root: string | null;
  defs: string;
};


/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to exist but it was missing`);
  }
  return value;
}

function statusOf(result: unknown): string {
  return String((result as { status?: unknown }).status ?? '');
}

/** Flattens every string reachable in a result so assertions never depend on the exact DTO shape. */
function collectStrings(value: unknown, depth = 0, acc: string[] = []): string[] {
  if (value === null || value === undefined || depth > 5) {
    return acc;
  }
  if (typeof value === 'string') {
    acc.push(value);
    return acc;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    acc.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, depth + 1, acc);
    }
    return acc;
  }
  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectStrings(nested, depth + 1, acc);
    }
  }
  return acc;
}

function haystack(value: unknown): string {
  return collectStrings(value).join('\n');
}

function mentionsLicense(value: unknown): boolean {
  return /cc\s*by[-\s]*sa\s*4\.0/i.test(haystack(value));
}

/**
 * Fixture adapter: answers from an in-memory list, matching exact `norm`/`word` equality —
 * exactly what an indexed SQLite lookup returns. Records every query so a test can prove
 * the implementation actually consulted the database.
 */
function createDictionaryDb(rows: DictionaryRow[]): {
  adapter: DictionaryDbAdapter;
  queries: Array<{ sql: string; params: unknown[] }>;
} {
  const queries: Array<{ sql: string; params: unknown[] }> = [];

  const adapter: DictionaryDbAdapter = {
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      queries.push({ sql, params });
      const needles = params
        .filter((param): param is string => typeof param === 'string')
        .map((param) => param.replace(/%/g, '').trim())
        .filter((param) => param.length > 0);

      const matches = rows.filter((row) =>
        needles.some((needle) => row.norm === needle || row.word === needle),
      );
      return matches as unknown as T[];
    },
  };

  return { adapter, queries };
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const bookRow: DictionaryRow = {
  word: 'كتاب',
  norm: 'كتاب',
  pos: 'noun',
  root: 'كتب',
  defs: 'FIXTURE_DEF_BOOK',
};

const libraryRow: DictionaryRow = {
  word: 'مكتبة',
  norm: 'مكتبه',
  pos: 'noun',
  root: 'كتب',
  defs: 'FIXTURE_DEF_LIBRARY',
};

const writeRow: DictionaryRow = {
  word: 'كتب',
  norm: 'كتب',
  pos: 'verb',
  root: 'كتب',
  defs: 'FIXTURE_DEF_WRITE',
};

const travelerRow: DictionaryRow = {
  word: 'مسافر',
  norm: 'مسافر',
  pos: 'noun',
  root: 'سفر',
  defs: 'FIXTURE_DEF_TRAVELER',
};

const rayRow: DictionaryRow = {
  word: 'شعاع',
  norm: 'شعاع',
  pos: 'noun',
  root: 'شعع',
  defs: 'FIXTURE_DEF_RAY',
};

/* ------------------------------------------------------------------ */
/* 1. normalization                                                    */
/* ------------------------------------------------------------------ */

describe('@/storage/arabic-stemmer — normalizeArabicWord', () => {
  it('strips tashkeel/tatweel/punctuation and normalizes hamza, alef maqsura, ta marbuta, waw and ya hamza', () => {
    const cases: Array<[string, string]> = [
      ['شُعَاعُهُ', 'شعاعه'],
      ['الـكِتَابُ', 'الكتاب'],
      ['أَحْمَد', 'احمد'],
      ['إِسْلَام', 'اسلام'],
      ['آمَنَ', 'امن'],
      ['ٱلْحَمْدُ', 'الحمد'],
      ['مُوسَى', 'موسي'],
      ['مَدْرَسَةٌ', 'مدرسه'],
      ['مُؤْمِن', 'مومن'],
      ['رَئِيس', 'رييس'],
      ['كِتَابٌ،؟!.', 'كتاب'],
      ['الْفَصْلُ.', 'الفصل'],
    ];

    for (const [input, expected] of cases) {
      expect(normalizeArabicWord(input)).toBe(expected);
    }

    // Idempotent: feeding a normalized word back changes nothing.
    for (const [input] of cases) {
      const once = normalizeArabicWord(input);
      expect(normalizeArabicWord(once)).toBe(once);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. stem candidates                                                  */
/* ------------------------------------------------------------------ */

describe('@/storage/arabic-stemmer — generateStemCandidates', () => {
  it('returns the exact normalized word first, then deduplicated prefix/suffix stems', () => {
    const cases: Array<{ raw: string; exact: string; expected: string[] }> = [
      { raw: 'وبالكتاب', exact: 'وبالكتاب', expected: ['كتاب'] },
      { raw: 'المكتبة', exact: 'المكتبه', expected: ['مكتبه'] },
      { raw: 'يكتبونها', exact: 'يكتبونها', expected: ['كتب'] },
      { raw: 'المسافرون', exact: 'المسافرون', expected: ['مسافر'] },
      { raw: 'شُعَاعُهُ', exact: 'شعاعه', expected: ['شعاع'] },
    ];

    for (const { raw, exact, expected } of cases) {
      const candidates = generateStemCandidates(raw);

      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);
      // Exact normalized form always comes first.
      expect(must(candidates[0], `candidates[0] for ${raw}`)).toBe(exact);

      // Deduplicated, and every candidate is already normalized.
      expect(new Set(candidates).size).toBe(candidates.length);
      for (const candidate of candidates) {
        expect(normalizeArabicWord(candidate)).toBe(candidate);
      }

      for (const wanted of expected) {
        expect(candidates).toContain(wanted);
      }
    }
  });

  it('is deterministic and does not mutate the input word', () => {
    const raw = 'وبالكتاب';
    const first = generateStemCandidates(raw);
    const second = generateStemCandidates(raw);

    expect(second).toEqual(first);
    expect(raw).toBe('وبالكتاب');
  });
});

/* ------------------------------------------------------------------ */
/* 3. exact match precedence                                           */
/* ------------------------------------------------------------------ */

describe('@/storage/dictionary — exact match precedence', () => {
  it('prefers the exact dictionary entry over a stemmed match even when the stem row comes first', async () => {
    const exactRow: DictionaryRow = {
      word: 'الكتاب',
      norm: 'الكتاب',
      pos: 'noun',
      root: 'كتب',
      defs: 'EXACT_ENTRY_DEF',
    };
    // The base/stem row is listed FIRST on purpose: precedence must not depend on DB order.
    const { adapter } = createDictionaryDb([bookRow, exactRow]);

    const result = await lookupDictionaryWord('الكتاب', adapter);

    expect(statusOf(result)).toBe('found');
    const text = haystack(result);
    expect(text).toContain('EXACT_ENTRY_DEF');
    expect(text).not.toContain('FIXTURE_DEF_BOOK');
  });
});

/* ------------------------------------------------------------------ */
/* 4. real inflected forms                                             */
/* ------------------------------------------------------------------ */

describe('@/storage/dictionary — inflected Arabic forms', () => {
  it('resolves و/ب/ل+ال, ta-marbuta, verb+suffix pronouns, plural waw and pronoun-suffixed words to their base entries', async () => {
    const { adapter, queries } = createDictionaryDb([
      bookRow,
      libraryRow,
      writeRow,
      travelerRow,
      rayRow,
    ]);

    const cases: Array<{ raw: string; defs: string; base: string }> = [
      { raw: 'وبالكتاب', defs: 'FIXTURE_DEF_BOOK', base: 'كتاب' },
      { raw: 'المكتبة', defs: 'FIXTURE_DEF_LIBRARY', base: 'مكتبه' },
      { raw: 'يكتبونها', defs: 'FIXTURE_DEF_WRITE', base: 'كتب' },
      { raw: 'المسافرون', defs: 'FIXTURE_DEF_TRAVELER', base: 'مسافر' },
      { raw: 'شُعَاعُهُ', defs: 'FIXTURE_DEF_RAY', base: 'شعاع' },
    ];

    for (const { raw, defs, base } of cases) {
      const result = await lookupDictionaryWord(raw, adapter);

      expect(statusOf(result)).toBe('found');
      const text = haystack(result);
      expect(text).toContain(defs);
      // The matched entry itself must be the base form, not a random near-miss.
      expect(text).toContain(base);
    }

    // The lookup really went through the DB adapter (no hard-coded shortcut table).
    expect(queries.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 5. unavailable DB                                                   */
/* ------------------------------------------------------------------ */

describe('@/storage/dictionary — unavailable database', () => {
  it('returns { status: "unavailable" } for a missing, null or throwing adapter and never throws', async () => {
    const withoutAdapter = lookupDictionaryWord('كتاب');
    await expect(withoutAdapter).resolves.toBeDefined();
    expect(statusOf(await withoutAdapter)).toBe('unavailable');

    const withNull = await lookupDictionaryWord('كتاب', null);
    expect(statusOf(withNull)).toBe('unavailable');

    const throwingAdapter: DictionaryDbAdapter = {
      async getAllAsync<T>(): Promise<T[]> {
        throw new Error('no such table: dictionary_entries');
      },
    };
    const withThrowingDb = await lookupDictionaryWord('المكتبة', throwingAdapter);
    expect(statusOf(withThrowingDb)).toBe('unavailable');

    const rejectingAdapter: DictionaryDbAdapter = {
      async getAllAsync<T>(): Promise<T[]> {
        return Promise.reject(new Error('database is locked'));
      },
    };
    await expect(lookupDictionaryWord('يكتبونها', rejectingAdapter)).resolves.toBeDefined();
    expect(statusOf(await lookupDictionaryWord('يكتبونها', rejectingAdapter))).toBe('unavailable');
  });
});

/* ------------------------------------------------------------------ */
/* 6. not_found inputs                                                 */
/* ------------------------------------------------------------------ */

describe('@/storage/dictionary — not_found inputs', () => {
  it('answers not_found calmly for empty, whitespace, punctuation-only, Latin-only and unknown Arabic words', async () => {
    const { adapter, queries } = createDictionaryDb([bookRow, libraryRow]);

    const inputs = ['', '   ', '\t\n ', '!!!', '...؟', 'hello', 'offline dictionary', 'زئبق'];
    for (const input of inputs) {
      const result = await lookupDictionaryWord(input, adapter);
      expect(statusOf(result)).toBe('not_found');
    }

    // An unknown Arabic word must still have been looked up in the DB.
    expect(queries.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 7. attribution on every result path                                 */
/* ------------------------------------------------------------------ */

describe('@/storage/dictionary — attribution', () => {
  it('exports CC BY-SA 4.0 + Wiktionary attribution and repeats it on found, not_found and unavailable results', async () => {
    expect(mentionsLicense(DICTIONARY_ATTRIBUTION)).toBe(true);
    expect(haystack(DICTIONARY_ATTRIBUTION).toLowerCase()).toContain('wiktionary');

    const { adapter } = createDictionaryDb([bookRow]);
    const found = await lookupDictionaryWord('الكتاب', adapter);
    const missing = await lookupDictionaryWord('زئبق', adapter);
    const unavailable = await lookupDictionaryWord('كتاب', null);

    for (const result of [found, missing, unavailable]) {
      expect(mentionsLicense(result)).toBe(true);
      expect(haystack(result).toLowerCase()).toContain('wiktionary');
    }

    // Every lookup path resolves (never throws) with one of the three documented statuses.
    const samples: Array<Promise<unknown>> = [
      Promise.resolve(lookupDictionaryWord('كتاب', adapter)),
      Promise.resolve(lookupDictionaryWord('لا_يوجد', adapter)),
      Promise.resolve(lookupDictionaryWord('كتاب', null)),
      Promise.resolve(lookupDictionaryWord('', adapter)),
    ];
    for (const sample of samples) {
      const result = await sample;
      expect(['found', 'not_found', 'unavailable']).toContain(statusOf(result));
    }
  });

  it('discloses that entries are extracted, cleaned and indexed while the content stays CC BY-SA 4.0', () => {
    // The dictionary is not a verbatim copy of the dump: the disclosure must say
    // what was done to the text, and must not claim an unmodified redistribution.
    const disclosure = haystack(DICTIONARY_ATTRIBUTION);
    expect(mentionsLicense(DICTIONARY_ATTRIBUTION)).toBe(true);
    expect(disclosure).toMatch(/مُستخلصة|مستخلصة/);
    expect(disclosure).toMatch(/مُنظّفة|منظفة/);
    expect(disclosure).toMatch(/مُفهرسة|مفهرسة/);
    expect(disclosure).not.toMatch(/دون أي تعديل/);
    expect(disclosure).not.toMatch(/دون تعديل/);
  });
});
