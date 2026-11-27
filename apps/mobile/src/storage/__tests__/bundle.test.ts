import fs from 'node:fs';
import path from 'node:path';
import * as DocumentPicker from 'expo-document-picker';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { parseBook } from '@rewiaty/book-format';

import {
  deleteBookBundle,
  ensureSampleBookSeeded,
  getBookDir,
  importBookContent,
  readBookBundle,
  saveBookReaderState,
} from '@/storage/bundle';
import { computeBookId } from '@/storage/book-id';
import {
  getBookRecord,
  getKv,
  initDatabase,
  listBooks,
  setKv,
  type DatabaseAdapter,
} from '@/storage/database';
import { pickAndImportBook } from '@/storage/importer';
import { indexBookForSearch, searchLibrary } from '@/storage/search-index';
import type { BookLibraryRecord } from '@/types/reader';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(),
  },
}));

function createInMemoryDb(): DatabaseAdapter {
  const books = new Map<string, BookLibraryRecord>();
  const kv = new Map<string, string>();

  return {
    async execAsync() {
      // Schema creation/migrations handled declaratively in memory
    },
    async runAsync(source: string, ...params: unknown[]) {
      const sql = source.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('INSERT INTO books')) {
        const [id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt] =
          params as [
            string,
            string,
            string | null,
            'rtl' | 'ltr',
            string,
            string | null,
            number,
            number,
            number,
          ];
        books.set(id, {
          id,
          title,
          author,
          dir,
          coverSeed,
          coverColor,
          progress,
          lastOpenedAt,
          addedAt,
        });
        return { changes: 1 };
      }
      if (sql.startsWith('UPDATE books SET title =')) {
        const [title, author, dir, coverSeed, coverColor, lastOpenedAt, id] = params as [
          string,
          string | null,
          'rtl' | 'ltr',
          string,
          string | null,
          number,
          string,
        ];
        const existing = books.get(id);
        if (!existing) return { changes: 0 };
        books.set(id, { ...existing, title, author, dir, coverSeed, coverColor, lastOpenedAt });
        return { changes: 1 };
      }
      if (sql.startsWith('UPDATE books SET progress =')) {
        const [progress, lastOpenedAt, id] = params as [number, number, string];
        const existing = books.get(id);
        if (!existing) return { changes: 0 };
        books.set(id, { ...existing, progress, lastOpenedAt });
        return { changes: 1 };
      }
      if (sql.startsWith('UPDATE books SET lastOpenedAt =')) {
        const [lastOpenedAt, id] = params as [number, string];
        const existing = books.get(id);
        if (!existing) return { changes: 0 };
        books.set(id, { ...existing, lastOpenedAt });
        return { changes: 1 };
      }
      if (sql.startsWith('DELETE FROM books')) {
        const [id] = params as [string];
        return { changes: books.delete(id) ? 1 : 0 };
      }
      if (sql.startsWith('INSERT INTO kv')) {
        const [key, value] = params as [string, string];
        kv.set(key, value);
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
      const sql = source.replace(/\s+/g, ' ').trim();
      if (sql.includes('FROM books WHERE id =')) {
        const [id] = params as [string];
        return (books.get(id) as T | undefined) ?? null;
      }
      if (sql.includes('FROM kv WHERE key =')) {
        const [key] = params as [string];
        const value = kv.get(key);
        return value !== undefined ? ({ value } as T) : null;
      }
      return null;
    },
    async getAllAsync<T>(source: string): Promise<T[]> {
      const sql = source.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('PRAGMA table_info(books)')) {
        return [{ name: 'coverColor' }] as T[];
      }
      if (sql.includes('FROM books')) {
        const rows = Array.from(books.values()).sort(
          (a, b) => b.lastOpenedAt - a.lastOpenedAt || b.addedAt - a.addedAt,
        );
        return rows as T[];
      }
      return [];
    },
  };
}

/**
 * Why (tech): the FTS5 assertion has to run against a real SQLite engine, not the declarative
 * in-memory stub above — `CREATE VIRTUAL TABLE ... USING fts5` and `MATCH` do not exist in a map.
 */
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

const SAMPLE_MD = `---
title: "أَوْرَاقُ الْبَحْرِ"
author: "كاتب تجريبي"
lang: ar
dir: rtl
coverColor: "#4E342E"
---

# الفصل الأول

كَانَ الْفَجْرُ يَتَسَلَّلُ بِهُدُوءٍ فَوْقَ أَرْصِفَةِ الْمِينَاءِ.
`;

/** Dirty Arabic source: space before the comma, straight quotes, a hand-wrapped line. */
const DIRTY_MD = `---
title: "كتاب التنظيف"
author: "مؤلف تجريبي"
lang: ar
dir: rtl
---

# الْفَصْلُ الْأَوَّلُ

قبل الفاصلة ، وقال "مرحبا" للجميع
وهذا سطر مكسور يدويا في نفس الفقرة.
`;

const DIRTY_TXT = [
  'الفصل الأول',
  '',
  'قبل الفاصلة ، وقال "مرحبا" هنا',
  'والسطر الثاني مكسور يدويا.',
].join('\n');

const CLEANED_PARAGRAPH =
  'قبل الفاصلة، وقال «مرحبا» للجميع وهذا سطر مكسور يدويا في نفس الفقرة.';

function clearBooksDir() {
  const root = new Directory(Paths.document, 'books');
  if (root.exists) {
    root.delete();
  }
}

describe('bundle storage & importer', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    clearBooksDir();
    db = createInMemoryDb();
    await initDatabase(db);
    jest.clearAllMocks();
  });

  it('creates canonical bundle on disk and parses metadata via @rewiaty/book-format', async () => {
    const record = await importBookContent(SAMPLE_MD, 'sea-notes.md', db);

    expect(record.id).toBe(computeBookId(SAMPLE_MD));
    expect(record.title).toBe('أَوْرَاقُ الْبَحْرِ');
    expect(record.author).toBe('كاتب تجريبي');
    expect(record.dir).toBe('rtl');
    expect(record.coverColor).toBe('#4E342E');
    expect(record.progress).toBe(0);

    const bookDir = getBookDir(record.id);
    expect(bookDir.exists).toBe(true);
    expect(new File(bookDir, 'book.md').exists).toBe(true);
    expect(new File(bookDir, 'manifest.json').exists).toBe(true);
    expect(new File(bookDir, '.reader-state.json').exists).toBe(true);
    expect(new Directory(bookDir, 'assets').exists).toBe(true);

    const loaded = await readBookBundle(record.id);
    expect(loaded.book.id).toBe(record.id);
    expect(loaded.book.chapters).toHaveLength(1);
    expect(loaded.book.chapters[0]?.title).toBe('الفصل الأول');
  });

  it('deduplicates repeated imports of identical content and preserves saved state', async () => {
    const first = await importBookContent(SAMPLE_MD, 'copy1.md', db);

    await saveBookReaderState(
      first.id,
      {
        anchor: { blockId: 'ch01_p0001', charOffset: 5 },
        progress: 0.42,
        chapterId: 'ch01',
        page: 3,
        pageCount: 7,
        updatedAt: Date.now() + 100,
      },
      db,
    );

    const crlfCopy = SAMPLE_MD.replace(/\n/g, '\r\n');
    const second = await importBookContent(crlfCopy, 'copy2.md', db);

    expect(second.id).toBe(first.id);
    expect(second.progress).toBeCloseTo(0.42);
    const all = await listBooks(db);
    expect(all).toHaveLength(1);

    const loaded = await readBookBundle(first.id);
    expect(loaded.state.anchor).toEqual({ blockId: 'ch01_p0001', charOffset: 5 });
  });

  it('lands overlapping reader-state writes in call order (Codex #26)', async () => {
    const record = await importBookContent(SAMPLE_MD, 'race.md', db);
    const originalWrite = File.prototype.write;
    let call = 0;
    const writeSpy = jest
      .spyOn(File.prototype, 'write')
      .mockImplementation(async function (this: File, ...args: Parameters<File['write']>) {
        call += 1;
        // The first (older) write is slower; without chaining it would land last.
        if (call === 1) await new Promise((resolve) => setTimeout(resolve, 50));
        return originalWrite.apply(this, args);
      });
    const base = { anchor: null, chapterId: 'ch01', page: 1, pageCount: 7, updatedAt: 1 };
    const older = saveBookReaderState(record.id, { ...base, progress: 0.1 }, db);
    const newer = saveBookReaderState(record.id, { ...base, progress: 0.9 }, db);
    await Promise.all([older, newer]);
    writeSpy.mockRestore();

    const loaded = await readBookBundle(record.id);
    expect(loaded.state.progress).toBeCloseTo(0.9);
  });

  it('supports .txt imports and orders library by lastOpenedAt DESC', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1000);
    const bookA = await importBookContent(SAMPLE_MD, 'a.md', db);

    nowSpy.mockReturnValue(2000);
    const bookB = await importBookContent('سطر أول\n\nسطر ثاني', 'notes.txt', db);

    let books = await listBooks(db);
    expect(books.map((b) => b.id)).toEqual([bookB.id, bookA.id]);

    // Re-opening bookA bumps it to the top
    await saveBookReaderState(
      bookA.id,
      { anchor: { blockId: 'ch01_p0001', charOffset: 0 }, progress: 0.25, updatedAt: 3000 },
      db,
    );
    books = await listBooks(db);
    expect(books.map((b) => b.id)).toEqual([bookA.id, bookB.id]);
    expect(books[0]?.progress).toBeCloseTo(0.25);

    nowSpy.mockRestore();
  });

  it('deletes bundle directory and SQLite record together', async () => {
    const record = await importBookContent(SAMPLE_MD, 'to-delete.md', db);
    expect(getBookDir(record.id).exists).toBe(true);

    await deleteBookBundle(record.id, db);
    expect(getBookDir(record.id).exists).toBe(false);
    expect(await getBookRecord(record.id, db)).toBeNull();
    expect(await listBooks(db)).toEqual([]);
  });

  it('persists settings/flags in kv and seeds sample book only once', async () => {
    const samplePath = path.resolve(__dirname, '../../../assets/sample-ar.md');
    const sampleDiskContent = fs.readFileSync(samplePath, 'utf8');
    const sampleCacheFile = new File(Paths.cache, 'bundled-sample-ar.md');
    await sampleCacheFile.write(sampleDiskContent);

    (Asset.fromModule as jest.Mock).mockReturnValue({
      localUri: sampleCacheFile.uri,
      uri: sampleCacheFile.uri,
      downloadAsync: jest.fn().mockResolvedValue(undefined),
    });

    const firstSeed = await ensureSampleBookSeeded(db);
    expect(firstSeed).toBe(true);
    expect(await getKv<boolean>('sample_seeded_v1', false, db)).toBe(true);

    const seededBooks = await listBooks(db);
    expect(seededBooks).toHaveLength(1);

    // Delete the sample book and verify second run does not re-seed
    await deleteBookBundle(seededBooks[0]!.id, db);
    const secondSeed = await ensureSampleBookSeeded(db);
    expect(secondSeed).toBe(false);
    expect(await listBooks(db)).toHaveLength(0);

    await setKv('sample_custom', { ok: true }, db);
    expect(await getKv('sample_custom', null, db)).toEqual({ ok: true });
  });

  it('imports via document picker and rejects unsupported formats', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: true,
      assets: null,
    });
    expect(await pickAndImportBook(db)).toBeNull();

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ name: 'novel.pdf', uri: 'file:///mock/cache/novel.pdf', lastModified: 1 }],
    });
    await expect(pickAndImportBook(db)).rejects.toThrow('صيغة الملف غير مدعومة');

    const pickedFile = new File(Paths.cache, 'picked-novel.md');
    await pickedFile.write(SAMPLE_MD);

    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ name: 'picked-novel.md', uri: pickedFile.uri, lastModified: 1 }],
    });

    const imported = await pickAndImportBook(db);
    expect(imported?.title).toBe('أَوْرَاقُ الْبَحْرِ');
    expect(await listBooks(db)).toHaveLength(1);
  });

  it('cleans Arabic in the parsed markdown book while keeping book.md byte-identical (F19)', async () => {
    const { adapter: realDb, close } = createRealSqliteMemoryAdapter();
    try {
      await initDatabase(realDb);

      const record = await importBookContent(DIRTY_MD, 'dirty.md', realDb);

      // Identity is derived from the raw source, never from the cleaned text.
      expect(record.id).toBe(computeBookId(DIRTY_MD));

      const bookFile = new File(getBookDir(record.id), 'book.md');
      const stored = await bookFile.text();
      expect(stored).toBe(DIRTY_MD);
      expect(stored).toContain('قبل الفاصلة ،');
      expect(stored).toContain('"مرحبا"');
      expect(stored).toContain('للجميع\nوهذا');

      const loaded = await readBookBundle(record.id);
      expect(loaded.book.chapters).toHaveLength(1);
      expect(loaded.book.chapters[0]?.title).toBe('الْفَصْلُ الْأَوَّلُ');
      const paragraphs = loaded.book.chapters[0]!.blocks.filter((b) => b.kind === 'p');
      expect(paragraphs.map((b) => b.html)).toEqual([CLEANED_PARAGRAPH]);

      const hits = await searchLibrary('مرحبا', { bookId: record.id }, realDb);
      expect(hits).toHaveLength(1);
      const hit = hits[0]!;
      // The index holds the cleaned prose, so the snippet shows the converted guillemets.
      expect(`${hit.snippetBefore}${hit.snippetMatch}${hit.snippetAfter}`).toContain('«مرحبا»');
      // The hand-wrapped second line is indexed as part of the same joined paragraph.
      expect(await searchLibrary('يدويا', { bookId: record.id }, realDb)).toHaveLength(1);
      expect(await searchLibrary('الفاصلة', { bookId: record.id }, realDb)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('keeps a legacy (parserVersion 1) book on its old parse so FTS, anchors, bookmarks and highlights never break (Codex P2)', async () => {
    const { adapter: realDb, close } = createRealSqliteMemoryAdapter();
    try {
      await initDatabase(realDb);

      // A book imported before cleaning existed: `manifest.json` says parserVersion 1 and has no
      // `cleanArabic` flag, while FTS5 rows, the anchor, the bookmark and the highlight were all
      // saved against the raw (uncleaned) parse.
      const LEGACY_MD = [
        '# الفصل الأول',
        '',
        'قال "مرحبا" للجميع ، وذهب',
        '',
        'وهذا سطر مكسور يدويا.',
      ].join('\n');
      const legacyId = computeBookId(LEGACY_MD);
      const legacyBook = parseBook(LEGACY_MD, 'legacy.md');
      const legacyIds = legacyBook.chapters[0]!.blocks.map((b) => b.id);
      const legacyHtml = legacyBook.chapters[0]!.blocks.map((b) => b.html);
      expect(legacyIds).toEqual(['ch01_p0001', 'ch01_p0002']);
      expect(legacyHtml[0]).toBe('قال &quot;مرحبا&quot; للجميع ، وذهب');

      const bookDir = getBookDir(legacyId);
      bookDir.create({ intermediates: true, idempotent: true });
      await new File(bookDir, 'book.md').write(LEGACY_MD);
      await new File(bookDir, 'manifest.json').write(
        JSON.stringify(
          {
            id: legacyId,
            meta: legacyBook.meta,
            chapters: legacyBook.chapters.map((ch) => ({
              id: ch.id,
              title: ch.title,
              wordCount: ch.wordCount,
              hash: ch.hash,
            })),
            wordCount: legacyBook.wordCount,
            parserVersion: 1,
            sourceFormat: 'md',
          },
          null,
          2,
        ),
      );
      await new File(bookDir, '.reader-state.json').write(
        JSON.stringify(
          {
            anchor: { blockId: 'ch01_p0002', charOffset: 5 },
            progress: 0.42,
            chapterId: 'ch01',
            bookmarkItems: [
              {
                id: 'bm-1',
                anchor: { blockId: 'ch01_p0001', charOffset: 5 },
                chapterId: 'ch01',
                chapterTitle: 'الفصل الأول',
                quote: 'مرحبا',
                contextBefore: 'قال "',
                contextAfter: '" للجميع',
                createdAt: 1,
              },
            ],
            highlights: [
              {
                id: 'hl-1',
                anchor: { blockId: 'ch01_p0002', charOffset: 5 },
                length: 4,
                color: 'gold',
                quote: 'سطر',
                contextBefore: 'وهذا ',
                contextAfter: ' مكسور',
                chapterId: 'ch01',
                chapterTitle: 'الفصل الأول',
                createdAt: 1,
                updatedAt: 1,
              },
            ],
            updatedAt: 1,
          },
          null,
          2,
        ),
      );
      // The search index was built from the same uncleaned parse, under the bundle's own id.
      await indexBookForSearch({ ...legacyBook, id: legacyId }, realDb);

      const loaded = await readBookBundle(legacyId);
      // Same block ids, same html, same offsets: nothing about the legacy book moved.
      expect(loaded.book.chapters[0]!.blocks.map((b) => b.id)).toEqual(legacyIds);
      expect(loaded.book.chapters[0]!.blocks.map((b) => b.html)).toEqual(legacyHtml);
      expect(loaded.book.chapters[0]!.blocks[0]!.html).toContain('&quot;مرحبا&quot;');
      expect(loaded.manifest.parserVersion).toBe(1);
      expect(loaded.manifest.cleanArabic).toBeUndefined();
      expect(loaded.state.anchor).toEqual({ blockId: 'ch01_p0002', charOffset: 5 });
      expect(loaded.state.bookmarkItems?.[0]?.anchor).toEqual({
        blockId: 'ch01_p0001',
        charOffset: 5,
      });
      expect(loaded.state.highlights?.[0]?.anchor).toEqual({
        blockId: 'ch01_p0002',
        charOffset: 5,
      });

      // The stored FTS5 rows still match the raw text at the raw offsets.
      const hits = await searchLibrary('مرحبا', { bookId: legacyId }, realDb);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.blockId).toBe('ch01_p0001');
      expect(hits[0]!.charOffset).toBe(5);

      // Re-importing the very same bytes must not silently upgrade the book's parse and break the
      // saved state; it keeps the legacy (uncleaned) reading.
      await importBookContent(LEGACY_MD, 'legacy.md', realDb);
      const manifestFile = new File(getBookDir(legacyId), 'manifest.json');
      const reimportedManifest = JSON.parse(await manifestFile.text()) as {
        cleanArabic?: boolean;
      };
      expect(reimportedManifest.cleanArabic).toBe(false);
      const reimported = await readBookBundle(legacyId);
      expect(reimported.book.chapters[0]!.blocks.map((b) => b.id)).toEqual(legacyIds);
      expect(reimported.book.chapters[0]!.blocks[0]!.html).toContain('&quot;مرحبا&quot;');
      expect(reimported.state.anchor).toEqual({ blockId: 'ch01_p0002', charOffset: 5 });
      expect(reimported.state.bookmarkItems?.[0]?.anchor).toEqual({
        blockId: 'ch01_p0001',
        charOffset: 5,
      });
      expect(reimported.state.highlights?.[0]?.anchor).toEqual({
        blockId: 'ch01_p0002',
        charOffset: 5,
      });

      // The re-index used the same uncleaned parse, so old hits still point at the same spot.
      const reimportedHits = await searchLibrary('مرحبا', { bookId: legacyId }, realDb);
      expect(reimportedHits).toHaveLength(1);
      expect(reimportedHits[0]!.blockId).toBe('ch01_p0001');
      expect(reimportedHits[0]!.charOffset).toBe(5);

      // A brand-new book is recorded as cleaned (parserVersion 2 + cleanArabic: true).
      const fresh = await importBookContent(DIRTY_MD, 'fresh.md', realDb);
      const freshManifest = JSON.parse(
        await new File(getBookDir(fresh.id), 'manifest.json').text(),
      ) as { parserVersion: number; cleanArabic?: boolean };
      expect(freshManifest.parserVersion).toBe(2);
      expect(freshManifest.cleanArabic).toBe(true);

      const freshBook = await readBookBundle(fresh.id);
      const freshParagraphs = freshBook.book.chapters[0]!.blocks.filter((b) => b.kind === 'p');
      expect(freshParagraphs.map((b) => b.html)).toEqual([CLEANED_PARAGRAPH]);
      expect(await searchLibrary('مرحبا', { bookId: fresh.id }, realDb)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('cleans Arabic in the parsed .txt book while keeping book.md byte-identical (F19)', async () => {
    const { adapter: realDb, close } = createRealSqliteMemoryAdapter();
    try {
      await initDatabase(realDb);

      const record = await importBookContent(DIRTY_TXT, 'dirty.txt', realDb);
      expect(record.id).toBe(computeBookId(DIRTY_TXT));

      const bookFile = new File(getBookDir(record.id), 'book.md');
      const stored = await bookFile.text();
      expect(stored).toBe(DIRTY_TXT);
      expect(stored).toContain('قبل الفاصلة ،');
      expect(stored).toContain('"مرحبا"');
      expect(stored).toContain('هنا\nوالسطر');

      const loaded = await readBookBundle(record.id);
      expect(loaded.book.chapters).toHaveLength(1);
      expect(loaded.book.chapters[0]?.title).toBe('الفصل الأول');
      expect(loaded.book.chapters[0]!.blocks.map((b) => b.html)).toEqual([
        'قبل الفاصلة، وقال «مرحبا» هنا والسطر الثاني مكسور يدويا.',
      ]);

      expect(await searchLibrary('مرحبا', { bookId: record.id }, realDb)).toHaveLength(1);
      expect(await searchLibrary('يدويا', { bookId: record.id }, realDb)).toHaveLength(1);
    } finally {
      close();
    }
  });
});
