import type { Book } from '@rewiaty/book-format';
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

let pendingEnsureIndexPromise: Promise<void> | null = null;

/**
 * Create the FTS5 virtual table for full-text book search if it does not exist yet.
 */
export async function initSearchSchema(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(CREATE_FTS_TABLE_SQL);
}

/**
 * Replace all FTS5 index entries for a book with its current text blocks.
 */
const INDEX_YIELD_EVERY_BLOCKS = 300;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function indexBookForSearch(book: Book, db?: DatabaseAdapter): Promise<void> {
  const conn = db ?? (await getDatabase());
  await conn.runAsync('DELETE FROM book_search_fts WHERE book_id = ?', book.id);

  const rows: Array<[string, string, string, string, string, string]> = [];
  let blocksSinceYield = 0;
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      // Why: stripping + normalizing a 200k-word book is one long synchronous loop on the JS
      // thread; yielding every few hundred blocks keeps taps and the search box responsive
      // while legacy books are backfilled (Codex #18 P2).
      if (++blocksSinceYield >= INDEX_YIELD_EVERY_BLOCKS) {
        blocksSinceYield = 0;
        await yieldToEventLoop();
      }
      if (block.kind === 'break' || block.kind === 'image') continue;
      const rawText = stripHtmlToPlainText(block.html);
      if (!rawText) continue;
      const normText = normalizeArabicForSearch(rawText);
      if (!normText) continue;
      rows.push([book.id, chapter.id, chapter.title, block.id, rawText, normText]);
    }
  }

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
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
 * Remove all indexed search rows belonging to a deleted book.
 */
export async function removeBookFromSearch(bookId: string, db?: DatabaseAdapter): Promise<void> {
  const conn = db ?? (await getDatabase());
  await conn.runAsync('DELETE FROM book_search_fts WHERE book_id = ?', bookId);
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
