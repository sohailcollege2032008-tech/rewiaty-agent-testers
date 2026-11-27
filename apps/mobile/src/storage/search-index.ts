import { hashString, type Block, type Book, type Chapter } from '@rewiaty/book-format';
import type * as SQLite from 'expo-sqlite';

import { readBookBundle } from './bundle';
import { getDatabase, listBooks, type DatabaseAdapter } from './database';
import {
  buildSearchSnippet,
  findMatchSpanInOriginal,
  normalizeArabicForSearch,
  stripHtmlToPlainText,
} from './search-normalize';

export type SearchHit = {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  blockId: string;
  charOffset: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
};

type FtsSearchRow = {
  book_id: string;
  book_title: string | null;
  chapter_id: string;
  chapter_title: string;
  block_id: string;
  raw_text: string;
};

const CREATE_FTS_TABLE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS book_search_fts USING fts5(
  book_id UNINDEXED,
  chapter_id UNINDEXED,
  chapter_title UNINDEXED,
  block_id UNINDEXED,
  raw_text UNINDEXED,
  norm_text,
  tokenize = 'unicode61'
);
`;

const INSERT_BATCH_SIZE = 100;

/** How many blocks are prepared between event-loop yields while building FTS5 rows. */
const INDEX_YIELD_EVERY_BLOCKS = 300;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let pendingEnsureIndexPromise: Promise<void> | null = null;

const SEARCH_INDEX_HASH_PREFIX = 'search_index_hash:';

/** `kv` key holding the content hash the FTS5 index for `bookId` was last built from. */
export function searchIndexHashKey(bookId: string): string {
  return `${SEARCH_INDEX_HASH_PREFIX}${bookId}`;
}

/**
 * Stable hash of everything FTS5 is built from: chapter identity plus each block's text. Two books
 * with the same hash have the same search hits, so it is the marker that says "the index matches
 * the book" without comparing every row.
 */
export function computeSearchContentHash(book: Book): string {
  const payload = book.chapters
    .map((chapter) => {
      const blocks = chapter.blocks
        .map((block) => `${block.id}\u0000${block.kind}\u0000${block.html}`)
        .join('\u0001');
      return `${chapter.id}\u0000${chapter.title}\u0000${blocks}`;
    })
    .join('\u0002');
  return hashString(payload);
}

/**
 * The hash of the book content the current FTS5 rows were built from, or `null` when there is no
 * trusted baseline (never indexed, index removed by a migration, or a book imported before F21).
 */
export async function readSearchIndexHash(
  bookId: string,
  db?: DatabaseAdapter,
): Promise<string | null> {
  const conn = db ?? (await getDatabase());
  const row = await conn.getFirstAsync<{ value: string }>(
    'SELECT value FROM kv WHERE key = ?',
    searchIndexHashKey(bookId),
  );
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Record the content hash an index was built from. Only ever called AFTER the FTS5 transaction
 * committed, so a failed insert can never leave a hash that claims the index is complete.
 *
 * Why (tech): the write goes straight to the `kv` table instead of `database.ts`'s `getKv`/`setKv`
 * because `database.ts` already imports this module for schema creation; a reverse import would
 * make the two modules circular.
 */
async function writeSearchIndexHash(
  bookId: string,
  contentHash: string,
  conn: DatabaseAdapter,
): Promise<void> {
  try {
    await conn.runAsync(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      searchIndexHashKey(bookId),
      JSON.stringify(contentHash),
    );
  } catch {
    // Indexing itself succeeded; a missing marker only costs one extra re-index on the next open.
  }
}

/**
 * Run `work` inside `BEGIN IMMEDIATE` / `COMMIT`, rolling back on any error. A partial FTS5 write
 * (half the chapters deleted and re-inserted) would silently lose search hits, so every multi-row
 * change is either fully applied or not applied at all.
 */
async function withImmediateTransaction<T>(
  conn: DatabaseAdapter,
  work: () => Promise<T>,
): Promise<T> {
  await conn.execAsync('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await conn.execAsync('COMMIT');
    return result;
  } catch (error) {
    try {
      await conn.execAsync('ROLLBACK');
    } catch {
      // The connection already unwound the transaction; the original error is what matters.
    }
    throw error;
  }
}

async function insertFtsRows(
  conn: DatabaseAdapter,
  rows: readonly FtsRow[],
  batchSize: number,
): Promise<void> {
  const size = Math.max(1, Math.floor(batchSize));
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params: SQLite.SQLiteBindValue[] = [];
    for (const row of chunk) {
      params.push(...row);
    }
    await conn.runAsync(
      `INSERT INTO book_search_fts (book_id, chapter_id, chapter_title, block_id, raw_text, norm_text) VALUES ${placeholders}`,
      ...params,
    );
  }
}

/**
 * Emit the `book_search_fts` rows of the given book, yielding periodically.
 * Why (tech): stripping + normalizing a 200k-word book is one long synchronous loop on the JS
 * thread; yielding every few hundred blocks keeps taps and the search box responsive while legacy
 * books are backfilled (Codex #18 P2). It runs BEFORE any transaction so a long parse never holds
 * a write lock.
 */
async function collectFtsRows(
  book: Book,
  chapterIds?: ReadonlySet<string>,
): Promise<FtsRow[]> {
  const rows: FtsRow[] = [];
  let blocksSinceYield = 0;
  for (const chapter of book.chapters) {
    if (chapterIds && !chapterIds.has(chapter.id)) continue;
    for (const block of chapter.blocks) {
      if (++blocksSinceYield >= INDEX_YIELD_EVERY_BLOCKS) {
        blocksSinceYield = 0;
        await yieldToEventLoop();
      }
      const row = chapterToFtsRow(chapter, block, book.id);
      if (row) rows.push(row);
    }
  }
  return rows;
}

/**
 * Create the FTS5 virtual table for full-text book search if it does not exist yet.
 */
export async function initSearchSchema(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(CREATE_FTS_TABLE_SQL);
}

/**
 * Replace all FTS5 index entries for a book with its current text blocks.
 *
 * All rows are prepared before the transaction and written inside it, then the indexed-content
 * hash is recorded only after the commit: an interrupted or failing insert leaves the previous
 * index exactly as it was, and `readBookBundle` will notice the stale hash and re-index.
 */
export async function indexBookForSearch(book: Book, db?: DatabaseAdapter): Promise<void> {
  const conn = db ?? (await getDatabase());
  const rows = await collectFtsRows(book);

  await withImmediateTransaction(conn, async () => {
    await conn.runAsync('DELETE FROM book_search_fts WHERE book_id = ?', book.id);
    await insertFtsRows(conn, rows, INSERT_BATCH_SIZE);
  });

  await writeSearchIndexHash(book.id, computeSearchContentHash(book), conn);
}

/**
 * Remove all indexed search rows belonging to a deleted book.
 */
export async function removeBookFromSearch(bookId: string, db?: DatabaseAdapter): Promise<void> {
  const conn = db ?? (await getDatabase());
  await conn.runAsync('DELETE FROM book_search_fts WHERE book_id = ?', bookId);
  try {
    await conn.runAsync('DELETE FROM kv WHERE key = ?', searchIndexHashKey(bookId));
  } catch {
    // A leftover marker is harmless: `readBookBundle` compares it against the content hash.
  }
}

type FtsRow = [string, string, string, string, string, string];

function chapterToFtsRow(chapter: Chapter, block: Block, bookId: string): FtsRow | null {
  if (block.kind === 'break' || block.kind === 'image') return null;
  const rawText = stripHtmlToPlainText(block.html);
  if (!rawText) return null;
  const normText = normalizeArabicForSearch(rawText);
  if (!normText) return null;
  return [bookId, chapter.id, chapter.title, block.id, rawText, normText];
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * F21 — re-index only the chapters a delta re-parse touched.
 *
 * Deletes the FTS5 rows of `chapterIdsToUpdate` (their content changed, so old rows are stale)
 * plus `removedChapterIds` (chapters that no longer exist), then inserts the current blocks of the
 * updated chapters only. Chapters that were not named are never read or written, so their index
 * rows — and any search hit pointing at them — stay exactly as they were.
 *
 * With both lists empty this performs ZERO SQL writes, which is what makes a no-op re-parse free.
 */
export async function indexBookChaptersDelta(
  book: Book,
  chapterIdsToUpdate: readonly string[],
  removedChapterIds: readonly string[] = [],
  db?: DatabaseAdapter,
  options: { insertBatchSize?: number } = {},
): Promise<{ deletedChapters: number; indexedBlocks: number }> {
  const updateIds = uniqueIds(chapterIdsToUpdate);
  const deleteIds = uniqueIds([...chapterIdsToUpdate, ...removedChapterIds]);
  if (updateIds.length === 0 && deleteIds.length === 0) {
    return { deletedChapters: 0, indexedBlocks: 0 };
  }

  const conn = db ?? (await getDatabase());

  // Prepare every row BEFORE the transaction: a long strip/normalize pass must not hold a write
  // lock, and a failure while preparing changes nothing.
  const rows = await collectFtsRows(book, new Set(updateIds));

  let deletedChapters = 0;
  await withImmediateTransaction(conn, async () => {
    for (const chapterId of deleteIds) {
      const result = await conn.runAsync(
        'DELETE FROM book_search_fts WHERE book_id = ? AND chapter_id = ?',
        book.id,
        chapterId,
      );
      if (result.changes > 0) deletedChapters += 1;
    }
    await insertFtsRows(conn, rows, options.insertBatchSize ?? INSERT_BATCH_SIZE);
  });

  // After the commit the whole book's index is complete again, so the marker moves with it.
  await writeSearchIndexHash(book.id, computeSearchContentHash(book), conn);

  return { deletedChapters, indexedBlocks: rows.length };
}

/**
 * Normalize a user query and escape all FTS5 operators/syntax characters safely,
 * adding prefix matching (`*`) on the final token for live search.
 */
export function buildFtsQuery(rawQuery: string): string {
  const normalized = normalizeArabicForSearch(rawQuery);
  if (!normalized) return '';

  // Keep only Unicode letters and digits so FTS5 special chars (", *, ^, (, ), :, -, +)
  // can never leak into the MATCH expression, and quote every token to neutralize AND/OR/NOT/NEAR.
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return '';

  return tokens
    .map((token, idx) => {
      const escaped = `"${token.replace(/"/g, '""')}"`;
      return idx === tokens.length - 1 ? `${escaped}*` : escaped;
    })
    .join(' ');
}

/**
 * Search indexed books using SQLite FTS5 BM25 ranking and return snippet-formatted hits.
 */
export async function searchLibrary(
  query: string,
  options?: { bookId?: string; limit?: number },
  db?: DatabaseAdapter,
): Promise<SearchHit[]> {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  const conn = db ?? (await getDatabase());
  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 50)));
  const bookId = options?.bookId?.trim();

  const whereClause = bookId
    ? 'WHERE book_search_fts MATCH ? AND book_id = ?'
    : 'WHERE book_search_fts MATCH ?';
  const queryParams: SQLite.SQLiteBindValue[] = bookId
    ? [ftsQuery, bookId, limit]
    : [ftsQuery, limit];

  const rows = await conn.getAllAsync<FtsSearchRow>(
    `SELECT
       h.book_id,
       COALESCE(b.title, '') AS book_title,
       h.chapter_id,
       h.chapter_title,
       h.block_id,
       h.raw_text
     FROM (
       SELECT
         book_id,
         chapter_id,
         chapter_title,
         block_id,
         raw_text,
         bm25(book_search_fts) AS score
       FROM book_search_fts
       ${whereClause}
       ORDER BY bm25(book_search_fts) ASC
       LIMIT ?
     ) h
     LEFT JOIN books b ON b.id = h.book_id
     ORDER BY h.score ASC`,
    ...queryParams,
  );

  const normQuery = normalizeArabicForSearch(query);
  return rows.map((row) => {
    const span = findMatchSpanInOriginal(row.raw_text, normQuery, true);
    const snippet = buildSearchSnippet(row.raw_text, span.offset, span.length);
    return {
      bookId: row.book_id,
      bookTitle: row.book_title ?? '',
      chapterId: row.chapter_id,
      chapterTitle: row.chapter_title,
      blockId: row.block_id,
      charOffset: span.offset,
      snippetBefore: snippet.before,
      snippetMatch: snippet.match,
      snippetAfter: snippet.after,
    };
  });
}

async function runEnsureLibrarySearchIndexed(
  conn: DatabaseAdapter,
  loadBundle: (bookId: string) => Promise<{ book: Book }>,
): Promise<void> {
  const [books, indexedRows] = await Promise.all([
    listBooks(conn),
    conn.getAllAsync<{ book_id: string }>('SELECT DISTINCT book_id FROM book_search_fts'),
  ]);
  const indexedIds = new Set(indexedRows.map((row) => row.book_id));

  for (const record of books) {
    if (indexedIds.has(record.id)) continue;
    try {
      const { book } = await loadBundle(record.id);
      await indexBookForSearch(book, conn);
    } catch {
      // Skip unreadable or missing bundles so indexing remaining books continues cleanly.
    }
  }
}

/**
 * Index any pre-existing books in the library that do not yet have FTS5 entries.
 */
export async function ensureLibrarySearchIndexed(
  db?: DatabaseAdapter,
  loadBundle: (bookId: string) => Promise<{ book: Book }> = readBookBundle,
): Promise<void> {
  if (db) {
    await runEnsureLibrarySearchIndexed(db, loadBundle);
    return;
  }

  if (!pendingEnsureIndexPromise) {
    pendingEnsureIndexPromise = (async () => {
      const conn = await getDatabase();
      await runEnsureLibrarySearchIndexed(conn, loadBundle);
    })().finally(() => {
      pendingEnsureIndexPromise = null;
    });
  }
  await pendingEnsureIndexPromise;
}
