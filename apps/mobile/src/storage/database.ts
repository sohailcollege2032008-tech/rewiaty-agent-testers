import * as SQLite from 'expo-sqlite';
import type { BookLibraryRecord } from '@/types/reader';

export type DatabaseAdapter = {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: SQLite.SQLiteBindValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(source: string, ...params: SQLite.SQLiteBindValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: SQLite.SQLiteBindValue[]): Promise<T[]>;
};

const DB_NAME = 'rewiaty.db';

let defaultDbPromise: Promise<DatabaseAdapter> | null = null;

export async function initDatabase(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS books (
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
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(books)');
  if (!columns.some((col) => col.name === 'coverColor')) {
    await db.execAsync('ALTER TABLE books ADD COLUMN coverColor TEXT');
  }
}

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (!defaultDbPromise) {
    defaultDbPromise = (async () => {
      const raw = await SQLite.openDatabaseAsync(DB_NAME);
      const adapter: DatabaseAdapter = {
        execAsync: (source) => raw.execAsync(source),
        runAsync: (source, ...params) => raw.runAsync(source, ...params),
        getFirstAsync: (source, ...params) => raw.getFirstAsync(source, ...params),
        getAllAsync: (source, ...params) => raw.getAllAsync(source, ...params),
      };
      await initDatabase(adapter);
      return adapter;
    })().catch((err) => {
      defaultDbPromise = null;
      throw err;
    });
  }
  return defaultDbPromise;
}

export async function upsertBook(
  record: BookLibraryRecord,
  db?: DatabaseAdapter,
): Promise<BookLibraryRecord> {
  const conn = db ?? (await getDatabase());
  const existing = await conn.getFirstAsync<BookLibraryRecord>(
    'SELECT id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt FROM books WHERE id = ?',
    record.id,
  );

  if (existing) {
    const merged: BookLibraryRecord = {
      ...existing,
      title: record.title,
      author: record.author,
      dir: record.dir,
      coverSeed: record.coverSeed,
      coverColor: record.coverColor,
      lastOpenedAt: Math.max(existing.lastOpenedAt, record.lastOpenedAt),
    };
    await conn.runAsync(
      `UPDATE books
       SET title = ?, author = ?, dir = ?, coverSeed = ?, coverColor = ?, lastOpenedAt = ?
       WHERE id = ?`,
      merged.title,
      merged.author,
      merged.dir,
      merged.coverSeed,
      merged.coverColor,
      merged.lastOpenedAt,
      merged.id,
    );
    return merged;
  }

  await conn.runAsync(
    `INSERT INTO books (id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.id,
    record.title,
    record.author,
    record.dir,
    record.coverSeed,
    record.coverColor,
    record.progress,
    record.lastOpenedAt,
    record.addedAt,
  );
  return record;
}

export async function listBooks(db?: DatabaseAdapter): Promise<BookLibraryRecord[]> {
  const conn = db ?? (await getDatabase());
  return conn.getAllAsync<BookLibraryRecord>(
    `SELECT id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt
     FROM books
     ORDER BY lastOpenedAt DESC, addedAt DESC`,
  );
}

export async function getBookRecord(
  id: string,
  db?: DatabaseAdapter,
): Promise<BookLibraryRecord | null> {
  const conn = db ?? (await getDatabase());
  return conn.getFirstAsync<BookLibraryRecord>(
    `SELECT id, title, author, dir, coverSeed, coverColor, progress, lastOpenedAt, addedAt
     FROM books
     WHERE id = ?`,
    id,
  );
}

export async function updateBookProgress(
  id: string,
  progress: number,
  lastOpenedAt: number,
  db?: DatabaseAdapter,
): Promise<void> {
  const conn = db ?? (await getDatabase());
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  await conn.runAsync(
    'UPDATE books SET progress = ?, lastOpenedAt = ? WHERE id = ?',
    clamped,
    lastOpenedAt,
    id,
  );
}

export async function touchBookOpened(
  id: string,
  lastOpenedAt: number,
  db?: DatabaseAdapter,
): Promise<void> {
  const conn = db ?? (await getDatabase());
  await conn.runAsync('UPDATE books SET lastOpenedAt = ? WHERE id = ?', lastOpenedAt, id);
}

export async function deleteBookRecord(id: string, db?: DatabaseAdapter): Promise<void> {
  const conn = db ?? (await getDatabase());
  await conn.runAsync('DELETE FROM books WHERE id = ?', id);
}

export async function getKv<T>(key: string, defaultValue: T, db?: DatabaseAdapter): Promise<T> {
  const conn = db ?? (await getDatabase());
  const row = await conn.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export async function setKv<T>(key: string, value: T, db?: DatabaseAdapter): Promise<void> {
  const conn = db ?? (await getDatabase());
  await conn.runAsync(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    JSON.stringify(value),
  );
}
