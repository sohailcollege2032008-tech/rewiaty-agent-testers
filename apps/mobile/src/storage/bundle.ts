import {
  deltaReparseBook,
  deltaReparseTxt,
  parseBook,
  parseTxt,
  type Book,
  type DeltaReparseResult,
} from '@rewiaty/book-format';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

import { computeBookId } from './book-id';
import {
  deleteBookRecord,
  getKv,
  listBooks,
  setKv,
  updateBookProgress,
  upsertBook,
  type DatabaseAdapter,
} from './database';
import {
  BOOK_FILE,
  MANIFEST_FILE,
  READER_STATE_FILE,
  buildStoredManifest,
  rawTextHash,
  readParsedCache,
  reanchorReaderItems,
  writeParsedCache,
  type ParsedBookCache,
} from './delta-reparse';
import {
  indexBookChaptersDelta,
  indexBookForSearch,
  computeSearchContentHash,
  readSearchIndexHash,
  removeBookFromSearch,
} from './search-index';
import type { BookLibraryRecord, BookManifest, BookReaderState } from '@/types/reader';

/**
 * Read a file's text while keeping the native handle alive.
 * Why (tech): Hermes may collect a `File` that is not referenced after `await file.text()`,
 * and expo-file-system then rejects with "Cannot use shared object that was already released"
 * (seen on the open-with flow, CI run 45597933250). A module-level set holds a strong reference
 * until the read settles, so the object cannot be collected mid-call.
 */
const filesInFlight = new Set<File>();
export async function readFileText(file: File): Promise<string> {
  filesInFlight.add(file);
  try {
    return await file.text();
  } finally {
    filesInFlight.delete(file);
  }
}


/**
 * Why (versioning, Codex P2): `2` means the bundle's `manifest.json` carries an explicit
 * `cleanArabic` flag (F19) and per-chapter `rawHash` (F21). Books imported before cleaning existed
 * are still `1` with no flag, and they keep being read *without* cleaning so their FTS5 rows,
 * anchors, bookmarks and highlights (all saved against the old parse) stay valid.
 */
export const PARSER_VERSION = 2;

/**
 * Why (F19): Arabic cleaning is applied to the parsed `Book` only — the bundle's `book.md` always
 * keeps the author's original bytes. Write and read must agree per book: a freshly imported book is
 * cleaned, a pre-existing one keeps whatever its `manifest.json` recorded, so ids and offsets never
 * drift underneath saved state.
 */
function parseOptionsFor(cleanArabic: boolean): { cleanArabic: boolean } {
  return { cleanArabic };
}

const SAMPLE_SEEDED_KV_KEY = 'sample_seeded_v1';

export type StoredManifest = BookManifest & {
  sourceFormat?: 'md' | 'txt';
  /** `true` when the stored book was parsed with the Arabic cleaner (parserVersion >= 2). */
  cleanArabic?: boolean;
};

export function getBooksRootDir(): Directory {
  return new Directory(Paths.document, 'books');
}

export function getBookDir(bookId: string): Directory {
  return new Directory(getBooksRootDir(), bookId);
}

function isTxtFile(fileName: string): boolean {
  return /\.txt$/i.test(fileName.trim());
}

export type ImportBookContentOptions = {
  /** Force the bundle id (archive imports fold image bytes into their identity). */
  bookId?: string;
  /** Write into this directory instead of the library's `books/<id>` (staging before commit). */
  bookDir?: Directory;
  /**
   * True only for the novel shipped inside the app. Bundled books are protected: the library
   * hides their delete affordance and never badges them as «جديدة».
   */
  isBundled?: boolean;
};

export async function readStoredManifest(bookDir: Directory): Promise<StoredManifest | null> {
  const manifestFile = new File(bookDir, MANIFEST_FILE);
  if (!manifestFile.exists) return null;
  try {
    return JSON.parse(await readFileText(manifestFile)) as StoredManifest;
  } catch {
    return null;
  }
}

/**
 * Read `<bookDir>/.reader-state.json`, normalizing every field and never throwing: a corrupt or
 * missing state file degrades to the default state instead of failing the open.
 */
export async function readReaderState(bookId: string): Promise<BookReaderState> {
  const stateFile = new File(getBookDir(bookId), READER_STATE_FILE);
  let state: BookReaderState = {
    anchor: null,
    progress: 0,
    updatedAt: Date.now(),
  };

  if (!stateFile.exists) return state;

  try {
    const parsedState = JSON.parse(await readFileText(stateFile)) as Partial<BookReaderState>;
    state = {
      anchor: parsedState.anchor ?? null,
      progress:
        typeof parsedState.progress === 'number' && Number.isFinite(parsedState.progress)
          ? Math.max(0, Math.min(1, parsedState.progress))
          : 0,
      chapterId: parsedState.chapterId,
      page: parsedState.page,
      pageCount: parsedState.pageCount,
      bookmarks: Array.isArray(parsedState.bookmarks)
        ? parsedState.bookmarks.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        : undefined,
      // Text-anchored bookmarks (F16); normalized later where the parsed book is available.
      bookmarkItems: Array.isArray(parsedState.bookmarkItems)
        ? (parsedState.bookmarkItems as BookReaderState['bookmarkItems'])
        : undefined,
      highlights: Array.isArray(parsedState.highlights)
        ? (parsedState.highlights as BookReaderState['highlights'])
        : undefined,
      // F46: scene placeholders are part of the saved state. Dropping them here made every
      // reopen start from a scene-less state, so the reader's edited prompts/status vanished.
      // Optional and `undefined` for `.reader-state.json` files written before F46.
      scenes: Array.isArray(parsedState.scenes)
        ? (parsedState.scenes as BookReaderState['scenes'])
        : undefined,
      settings: parsedState.settings,
      updatedAt: typeof parsedState.updatedAt === 'number' ? parsedState.updatedAt : Date.now(),
    };
  } catch {
    // Fallback to default state if corrupted
  }

  return state;
}

export async function importBookContent(
  rawText: string,
  fileName: string,
  db?: DatabaseAdapter,
  options: ImportBookContentOptions = {},
): Promise<BookLibraryRecord> {
  if (!rawText || !rawText.trim()) {
    throw new Error('الملف فارغ ولا يحتوي على نص.');
  }

  const sourceFormat: 'md' | 'txt' = isTxtFile(fileName) ? 'txt' : 'md';
  const id = options.bookId ?? computeBookId(rawText);

  const bookDir = options.bookDir ?? getBookDir(id);
  bookDir.create({ intermediates: true, idempotent: true });

  // Why (compat, Codex P2): a book that is already on disk with an old manifest and saved reader
  // state was parsed without cleaning, and its FTS5 rows, anchors, bookmarks and highlights all use
  // that parse. Re-importing the same bytes must keep reading it the same way, otherwise every saved
  // position and the whole search index would silently shift (`"مرحبا"` → `«مرحبا»`). Only a genuinely
  // new book (no manifest, or no saved state) gets the cleaner.
  const existingManifest = await readStoredManifest(bookDir);
  const hasSavedState = new File(bookDir, '.reader-state.json').exists;
  const cleanArabic =
    existingManifest !== null && existingManifest.cleanArabic !== true && hasSavedState
      ? false
      : true;

  // Why (F19): the cleaner runs only in the parsed book. `rawText` is what lands in `book.md`,
  // so the source file on disk stays byte-identical and nothing is lost on re-read.
  const parsed: Book =
    sourceFormat === 'txt'
      ? parseTxt(rawText, fileName, parseOptionsFor(cleanArabic))
      : parseBook(rawText, fileName, parseOptionsFor(cleanArabic));

  const book: Book = { ...parsed, id };

  const assetsDir = new Directory(bookDir, 'assets');
  assetsDir.create({ intermediates: true, idempotent: true });

  const bookFile = new File(bookDir, BOOK_FILE);
  await bookFile.write(rawText);

  const manifest: StoredManifest = buildStoredManifest(book, sourceFormat, cleanArabic);
  const manifestFile = new File(bookDir, MANIFEST_FILE);
  await manifestFile.write(JSON.stringify(manifest, null, 2));

  // Seed the parsed cache so the very first content update can already be a delta re-parse.
  await persistParsedCache(bookDir, {
    parserVersion: PARSER_VERSION,
    sourceFormat,
    cleanArabic,
    rawTextHash: rawTextHash(rawText),
    book,
  });

  const now = Date.now();
  const stateFile = new File(bookDir, READER_STATE_FILE);
  let initialProgress = 0;
  if (stateFile.exists) {
    try {
      const existingState = JSON.parse(await readFileText(stateFile)) as Partial<BookReaderState>;
      if (typeof existingState.progress === 'number' && Number.isFinite(existingState.progress)) {
        initialProgress = Math.max(0, Math.min(1, existingState.progress));
      }
    } catch {
      // Preserve corrupted fallback cleanly by resetting below
    }
  } else {
    const initialState: BookReaderState = {
      anchor: null,
      progress: 0,
      updatedAt: now,
    };
    await stateFile.write(JSON.stringify(initialState, null, 2));
  }

  const record: BookLibraryRecord = {
    id,
    title: book.meta.title,
    author: book.meta.author ?? null,
    dir: book.meta.dir,
    coverSeed: book.meta.title,
    coverColor: book.meta.coverColor ?? null,
    progress: initialProgress,
    lastOpenedAt: now,
    addedAt: now,
    isBundled: options.isBundled ?? false,
  };

  const savedRecord = await upsertBook(record, db);
  await indexBookForSearch(book, db);
  return savedRecord;
}

/**
 * Load a book bundle, using the parsed-chapter cache (F21) instead of re-parsing every open.
 *
 * - Cache hit (same parser version, same format, same `book.md` hash): the cached `Book` is
 *   returned immediately, but the FTS5 index is reconciled first — a cache hit says nothing about
 *   whether indexing succeeded last time.
 * - `book.md` changed on disk: only the chapters whose raw hash moved are re-parsed, then the
 *   manifest and cache are refreshed, FTS5 is updated for those chapters, and highlights/bookmarks
 *   are re-anchored against the new structure.
 * - No usable cache: a full parse seeds the cache for the next open and rebuilds the whole index.
 */
export async function readBookBundle(
  bookId: string,
  db?: DatabaseAdapter,
): Promise<{
  book: Book;
  manifest: StoredManifest;
  state: BookReaderState;
}> {
  const bookDir = getBookDir(bookId);
  const bookFile = new File(bookDir, BOOK_FILE);
  if (!bookFile.exists) {
    throw new Error('تعذّر العثور على ملف الكتاب.');
  }

  const rawText = await readFileText(bookFile);
  const storedManifest = await readStoredManifest(bookDir);
  const sourceFormat = storedManifest?.sourceFormat ?? 'md';
  const fileName = `${storedManifest?.meta?.title ?? bookId}.${sourceFormat}`;
  // Why (compat, Codex P2): read a book exactly the way it was stored. Legacy books (parserVersion
  // 1, no `cleanArabic`) were parsed without cleaning, so their block ids, FTS5 rows, anchors,
  // bookmarks and highlights all line up with the raw text. Cleaning them here on the fly would move
  // every offset (`"مرحبا"` → `«مرحبا»`) and break all of them.
  const cleanArabic = storedManifest?.cleanArabic === true;
  const textHash = rawTextHash(rawText);

  const cache = await readParsedCache(bookDir);
  const cacheMatchesFormat =
    cache !== null &&
    cache.parserVersion === PARSER_VERSION &&
    cache.sourceFormat === sourceFormat &&
    (cache.cleanArabic === true) === cleanArabic;

  if (cacheMatchesFormat && cache && cache.rawTextHash === textHash) {
    const cachedBook: Book = { ...cache.book, id: bookId };
    // Why (tech): a cache hit only proves the parse is current, not that FTS5 was ever written
    // for this content (a failed index, a rebuilt cache, an older app version). Reconcile so a
    // search can never miss a book that opens fine.
    await reconcileSearchIndex(cachedBook, db);
    return {
      book: cachedBook,
      manifest: storedManifest ?? buildStoredManifest(cachedBook, sourceFormat, cleanArabic),
      state: await readReaderState(bookId),
    };
  }

  // A cache from the same parser + format + cleanArabic flag is the delta baseline even when `book.md` moved.
  const previousBook: Book | null = cacheMatchesFormat && cache ? { ...cache.book, id: bookId } : null;

  let book: Book;
  let delta: DeltaReparseResult | null = null;
  if (previousBook) {
    delta = sourceFormat === 'txt'
      ? deltaReparseTxt(rawText, fileName, previousBook, parseOptionsFor(cleanArabic))
      : deltaReparseBook(rawText, fileName, previousBook, parseOptionsFor(cleanArabic));
    book = { ...delta.book, id: bookId };
  } else {
    const parsed =
      sourceFormat === 'txt'
        ? parseTxt(rawText, fileName, parseOptionsFor(cleanArabic))
        : parseBook(rawText, fileName, parseOptionsFor(cleanArabic));
    book = { ...parsed, id: bookId };
  }

  // Why (compat, F19): a legacy (parserVersion < 2) bundle opened without a content delta keeps
  // its original manifest intact (`parserVersion: 1`, `cleanArabic: undefined`) while seeding the
  // parsed cache; only a delta update or a v2+ bundle rewrites `manifest.json`.
  const preserveLegacyManifest =
    !delta && storedManifest !== null && storedManifest.parserVersion < PARSER_VERSION;
  const manifest: StoredManifest = preserveLegacyManifest
    ? storedManifest
    : buildStoredManifest(book, sourceFormat, cleanArabic);
  if (!preserveLegacyManifest) {
    await new File(bookDir, MANIFEST_FILE).write(JSON.stringify(manifest, null, 2));
  }
  await persistParsedCache(bookDir, {
    parserVersion: PARSER_VERSION,
    sourceFormat,
    cleanArabic,
    rawTextHash: textHash,
    book,
  });

  if (!delta) {
    // First sight of this bundle (or the cache was unusable): the parse is fresh, so the whole
    // index is rewritten. A stale index left by the previous content would otherwise keep serving
    // search hits for text that is no longer in the book (Codex P2).
    await indexAfterFullParse(book, db);
    return { book, manifest, state: await readReaderState(bookId) };
  }

  await indexAfterDeltaParse(book, delta, previousBook, db);

  let state = await readReaderState(bookId);
  const reanchored = reanchorReaderItems(book, state, {
    reusedChapterIdMap: delta.reusedChapterIdMap,
    removedChapterIds: delta.removedChapterIds,
  });
  if (reanchored.reanchoredHighlights > 0 || reanchored.reanchoredBookmarks > 0) {
    state = { ...reanchored.state, updatedAt: Date.now() };
    try {
      await saveBookReaderState(bookId, state, db);
    } catch {
      // Why: the state file is written before the library progress update, so a DB hiccup leaves
      // the re-anchored state on disk and must not fail the open.
    }
  }

  return { book, manifest, state };
}

/**
 * Persist the parsed cache without ever failing the open: it is a speed-up, and a full parse can
 * rebuild it on the next call.
 */
async function persistParsedCache(bookDir: Directory, cache: ParsedBookCache): Promise<void> {
  try {
    await writeParsedCache(bookDir, cache);
  } catch {
    // A read-only or full filesystem must not stop the reader from opening a valid book.
  }
}

/** Index a book whose whole structure was just parsed, then verify/mark the index. */
async function indexAfterFullParse(book: Book, db?: DatabaseAdapter): Promise<void> {
  try {
    await indexBookForSearch(book, db);
  } catch {
    // The search index is a cache; `ensureLibrarySearchIndexed` backfills anything missed.
  }
}

/**
 * Update FTS5 after a delta re-parse. A delta only rewrites the chapters it names, which is
 * correct only when the untouched chapters are already indexed: when the stored index hash does
 * not match the previous book, the baseline is not trustworthy and the whole book is re-indexed.
 */
async function indexAfterDeltaParse(
  book: Book,
  delta: DeltaReparseResult,
  previousBook: Book | null,
  db?: DatabaseAdapter,
): Promise<void> {
  try {
    const previousHash = previousBook ? computeSearchContentHash(previousBook) : null;
    const indexedHash = previousHash ? await readSearchIndexHash(book.id, db) : null;
    if (previousHash === null || indexedHash !== previousHash) {
      await indexBookForSearch(book, db);
      return;
    }
    await indexBookChaptersDelta(book, delta.changedChapterIds, delta.removedChapterIds, db);
  } catch {
    // The search index is a cache; `ensureLibrarySearchIndexed` backfills anything missed.
  }
}

/** Make sure FTS5 holds exactly this book's content, whatever state the marker is in. */
async function reconcileSearchIndex(book: Book, db?: DatabaseAdapter): Promise<void> {
  try {
    const contentHash = computeSearchContentHash(book);
    const indexedHash = await readSearchIndexHash(book.id, db);
    if (indexedHash === contentHash) return;
    await indexBookForSearch(book, db);
  } catch {
    // Same reasoning as above — search must never block reading.
  }
}

// Why: page saves, bookmarks and highlights all write the same `.reader-state.json`. Two
// overlapping writes can finish out of order and leave the older state on disk (Codex #26), so
// writes for one book are chained and always land in call order.
const stateWriteChains = new Map<string, Promise<void>>();

export function saveBookReaderState(
  bookId: string,
  state: BookReaderState,
  db?: DatabaseAdapter,
): Promise<void> {
  const previous = stateWriteChains.get(bookId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writeBookReaderState(bookId, state, db));
  stateWriteChains.set(bookId, next);
  void next.finally(() => {
    if (stateWriteChains.get(bookId) === next) stateWriteChains.delete(bookId);
  });
  return next;
}

async function writeBookReaderState(
  bookId: string,
  state: BookReaderState,
  db?: DatabaseAdapter,
): Promise<void> {
  const bookDir = getBookDir(bookId);
  if (!bookDir.exists) {
    bookDir.create({ intermediates: true, idempotent: true });
  }
  const stateFile = new File(bookDir, READER_STATE_FILE);
  await stateFile.write(JSON.stringify(state, null, 2));
  await updateBookProgress(bookId, state.progress, state.updatedAt, db);
}

export async function deleteBookBundle(bookId: string, db?: DatabaseAdapter): Promise<void> {
  const bookDir = getBookDir(bookId);
  if (bookDir.exists) {
    bookDir.delete();
  }
  await removeBookFromSearch(bookId, db);
  await deleteBookRecord(bookId, db);
}

export async function readAssetText(assetModule: number): Promise<string> {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) {
    throw new Error('تعذّر تحميل الملف المدمج.');
  }
  return readFileText(new File(uri));
}

export async function ensureSampleBookSeeded(db?: DatabaseAdapter): Promise<boolean> {
  const alreadySeeded = await getKv<boolean>(SAMPLE_SEEDED_KV_KEY, false, db);
  if (alreadySeeded) {
    return false;
  }

  const existingBooks = await listBooks(db);
  if (existingBooks.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sampleAsset = require('@/assets/sample-ar.md') as number;
    const sampleText = await readAssetText(sampleAsset);
    await importBookContent(sampleText, 'sample-ar.md', db, { isBundled: true });
  }

  await setKv(SAMPLE_SEEDED_KV_KEY, true, db);
  return true;
}
