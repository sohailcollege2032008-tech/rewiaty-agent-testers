import {
  getBookRecord,
  initDatabase,
  listBooks,
  upsertBook,
  type DatabaseAdapter,
} from '@/storage/database';
import type { BookLibraryRecord } from '@/types/reader';

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

const BUNDLED_TITLE = 'حَجَرُ الْمَاءِ';
const BUNDLED_AUTHOR = 'روايتي';

function record(overrides: Partial<BookLibraryRecord> = {}): BookLibraryRecord {
  return {
    id: 'book_a',
    title: 'رواية',
    author: 'كاتب',
    dir: 'rtl',
    coverSeed: 'رواية',
    coverColor: null,
    progress: 0,
    lastOpenedAt: 1000,
    addedAt: 1000,
    ...overrides,
  };
}

describe('books.isBundled column (P2 #1)', () => {
  let db: DatabaseAdapter;
  let closeDb: () => void;

  beforeEach(() => {
    const created = createRealSqliteMemoryAdapter();
    db = created.adapter;
    closeDb = created.close;
  });

  afterEach(() => closeDb());

  it('migrates a legacy books table, backfills the bundled sample, and maps the flag to boolean', async () => {
    // A pre-#67 database: no isBundled column at all.
    await db.execAsync(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        dir TEXT NOT NULL,
        coverSeed TEXT NOT NULL,
        coverColor TEXT,
        progress REAL NOT NULL DEFAULT 0,
        lastOpenedAt INTEGER NOT NULL,
        addedAt INTEGER NOT NULL
      );
      INSERT INTO books (id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt)
      VALUES ('book_sample', '${BUNDLED_TITLE}', '${BUNDLED_AUTHOR}', 'rtl', '${BUNDLED_TITLE}', NULL, 0, 1000, 1000);
      INSERT INTO books (id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt)
      VALUES ('book_user', 'رواية المستخدم', 'كاتب', 'rtl', 'رواية المستخدم', NULL, 0, 2000, 2000);
    `);

    await initDatabase(db);

    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(books)');
    expect(columns.map((col) => col.name)).toContain('isBundled');

    const rows = await listBooks(db);
    const sample = rows.find((row) => row.id === 'book_sample');
    const userBook = rows.find((row) => row.id === 'book_user');
    expect(sample?.isBundled).toBe(true);
    expect(typeof sample?.isBundled).toBe('boolean');
    expect(userBook?.isBundled).toBe(false);
    expect(typeof userBook?.isBundled).toBe('boolean');

    expect((await getBookRecord('book_sample', db))?.isBundled).toBe(true);
  });

  it('is idempotent: a second init does not duplicate the column or re-run the backfill', async () => {
    await db.execAsync(`
      CREATE TABLE books (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        dir TEXT NOT NULL,
        coverSeed TEXT NOT NULL,
        coverColor TEXT,
        progress REAL NOT NULL DEFAULT 0,
        lastOpenedAt INTEGER NOT NULL,
        addedAt INTEGER NOT NULL
      );
    `);
    await initDatabase(db);
    await initDatabase(db);

    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(books)');
    expect(columns.filter((col) => col.name === 'isBundled')).toHaveLength(1);

    // A user book that happens to be added after the migration keeps isBundled = 0.
    await upsertBook(record({ id: 'book_late', title: BUNDLED_TITLE, author: 'كاتب آخر' }), db);
    expect((await getBookRecord('book_late', db))?.isBundled).toBe(false);
  });

  it('round-trips the flag through upsertBook for both values and preserves it on update', async () => {
    await initDatabase(db);

    const created = await upsertBook(record({ id: 'book_bundled', isBundled: true }), db);
    expect(created.isBundled).toBe(true);
    expect((await getBookRecord('book_bundled', db))?.isBundled).toBe(true);

    const plain = await upsertBook(record({ id: 'book_plain' }), db);
    expect(plain.isBundled).toBe(false);
    expect((await getBookRecord('book_plain', db))?.isBundled).toBe(false);

    // Re-upserting an existing bundled book without the flag must not silently un-protect it.
    await upsertBook(record({ id: 'book_bundled', title: 'عنوان محدّث' }), db);
    const after = await getBookRecord('book_bundled', db);
    expect(after?.title).toBe('عنوان محدّث');
    expect(after?.isBundled).toBe(true);
  });
});
