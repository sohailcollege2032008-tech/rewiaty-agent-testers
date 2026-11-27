import { parseBook, parseTxt, type Book } from '@rewiaty/book-format';
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
import { indexBookForSearch, removeBookFromSearch } from './search-index';
import type { BookLibraryRecord, BookManifest, BookReaderState } from '@/types/reader';

/**
 * Read a file's text while keeping the native handle alive.
 * Why (tech): Hermes may collect a `File` that is not referenced after `await file.text()`,
 * and expo-file-system then rejects with "Cannot use shared object that was already released"
 * (seen on the open-with flow, CI run 45597933250). A module-level set holds a strong reference
 * until the read settles, so the object cannot be collected mid-call.
 */
const filesInFlight = new Set<File>();
async function readFileText(file: File): Promise<string> {
  filesInFlight.add(file);
  try {
    return await file.text();
  } finally {
    filesInFlight.delete(file);
  }
}


export const PARSER_VERSION = 1;
const SAMPLE_SEEDED_KV_KEY = 'sample_seeded_v1';

export type StoredManifest = BookManifest & {
  sourceFormat?: 'md' | 'txt';
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
};

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
  const parsed: Book =
    sourceFormat === 'txt' ? parseTxt(rawText, fileName) : parseBook(rawText, fileName);

  const id = options.bookId ?? computeBookId(rawText);
  const book: Book = { ...parsed, id };

  const bookDir = options.bookDir ?? getBookDir(id);
  bookDir.create({ intermediates: true, idempotent: true });

  const assetsDir = new Directory(bookDir, 'assets');
  assetsDir.create({ intermediates: true, idempotent: true });

  const bookFile = new File(bookDir, 'book.md');
  await bookFile.write(rawText);

  const manifest: StoredManifest = {
    id,
    meta: book.meta,
    chapters: book.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      wordCount: ch.wordCount,
      hash: ch.hash,
    })),
    wordCount: book.wordCount,
    parserVersion: PARSER_VERSION,
    sourceFormat,
  };
  const manifestFile = new File(bookDir, 'manifest.json');
  await manifestFile.write(JSON.stringify(manifest, null, 2));

  const now = Date.now();
  const stateFile = new File(bookDir, '.reader-state.json');
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
  };

  const savedRecord = await upsertBook(record, db);
  await indexBookForSearch(book, db);
  return savedRecord;
}

export async function readBookBundle(bookId: string): Promise<{
  book: Book;
  manifest: StoredManifest;
  state: BookReaderState;
}> {
  const bookDir = getBookDir(bookId);
  const bookFile = new File(bookDir, 'book.md');
  if (!bookFile.exists) {
    throw new Error('تعذّر العثور على ملف الكتاب.');
  }

  const rawText = await readFileText(bookFile);
  const manifestFile = new File(bookDir, 'manifest.json');
  let manifest: StoredManifest | null = null;
  if (manifestFile.exists) {
    try {
      manifest = JSON.parse(await readFileText(manifestFile)) as StoredManifest;
    } catch {
      manifest = null;
    }
  }

  const sourceFormat = manifest?.sourceFormat ?? 'md';
  const fileName = `${manifest?.meta?.title ?? bookId}.${sourceFormat}`;
  const parsed = sourceFormat === 'txt' ? parseTxt(rawText, fileName) : parseBook(rawText, fileName);
  const book: Book = { ...parsed, id: bookId };

  const fallbackManifest: StoredManifest = manifest ?? {
    id: bookId,
    meta: book.meta,
    chapters: book.chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      wordCount: ch.wordCount,
      hash: ch.hash,
    })),
    wordCount: book.wordCount,
    parserVersion: PARSER_VERSION,
    sourceFormat,
  };

  const stateFile = new File(bookDir, '.reader-state.json');
  let state: BookReaderState = {
    anchor: null,
    progress: 0,
    updatedAt: Date.now(),
  };

  if (stateFile.exists) {
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
  }

  return { book, manifest: fallbackManifest, state };
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
  const stateFile = new File(bookDir, '.reader-state.json');
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
    await importBookContent(sampleText, 'sample-ar.md', db);
  }

  await setKv(SAMPLE_SEEDED_KV_KEY, true, db);
  return true;
}
