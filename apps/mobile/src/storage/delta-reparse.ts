import {
  deltaReparseBook,
  deltaReparseTxt,
  hashString,
  parseBook,
  parseTxt,
  type Book,
  type Chapter,
  type DeltaReparseResult,
} from '@rewiaty/book-format';
import { Directory, File } from 'expo-file-system';

import { resolveBookmarkAnchor } from './bookmarks';
import {
  getBookDir,
  PARSER_VERSION,
  readFileText,
  readReaderState,
  readStoredManifest,
  saveBookReaderState,
  type StoredManifest,
} from './bundle';
import { getBookRecord, upsertBook, type DatabaseAdapter } from './database';
import { resolveHighlightRange } from './highlights';
import {
  computeSearchContentHash,
  indexBookChaptersDelta,
  indexBookForSearch,
  readSearchIndexHash,
} from './search-index';
import type { BookmarkItem, BookReaderState, HighlightItem } from '@/types/reader';

/**
 * F21 — delta re-parse + parsed-chapter cache.
 *
 * A book bundle keeps the parsed `Book` on disk (`parsed-cache.json`) next to `book.md`, so the
 * next open can return immediately and a content change only re-parses the chapters whose raw
 * source hash moved. Highlights and bookmarks are text-anchored, so they survive either way —
 * this module re-resolves them against the new chapter structure and saves the result.
 */

export const PARSED_CACHE_FILE = 'parsed-cache.json';
export const MANIFEST_FILE = 'manifest.json';
export const BOOK_FILE = 'book.md';
export const READER_STATE_FILE = '.reader-state.json';

export type ParsedBookCache = {
  parserVersion: number;
  sourceFormat: 'md' | 'txt';
  /** Whether the cached `Book` was parsed with F19 Arabic cleaning enabled. */
  cleanArabic?: boolean;
  /** Hash of the exact `book.md` text this cache was produced from. */
  rawTextHash: string;
  book: Book;
};

export function rawTextHash(rawText: string): string {
  return hashString(rawText);
}

const VALID_BLOCK_KINDS = new Set(['p', 'h2', 'quote', 'image', 'break']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidBlock(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value['id'] !== 'string' || !value['id']) return false;
  if (typeof value['kind'] !== 'string' || !VALID_BLOCK_KINDS.has(value['kind'])) return false;
  if (typeof value['html'] !== 'string') return false;
  if (value['noIndent'] !== undefined && typeof value['noIndent'] !== 'boolean') return false;
  return true;
}

function isValidBlockList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isValidBlock);
}

function isValidChapter(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value['id'] !== 'string' || !value['id']) return false;
  if (typeof value['title'] !== 'string') return false;
  if (typeof value['wordCount'] !== 'number' || !Number.isFinite(value['wordCount'])) return false;
  if (typeof value['hash'] !== 'string') return false;
  if (value['rawHash'] !== undefined && typeof value['rawHash'] !== 'string') return false;
  return isValidBlockList(value['blocks']);
}

function isValidBookMeta(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value['title'] !== 'string' || !value['title'].trim()) return false;
  if (typeof value['lang'] !== 'string') return false;
  if (value['dir'] !== 'rtl' && value['dir'] !== 'ltr') return false;
  if (value['author'] !== undefined && typeof value['author'] !== 'string') return false;
  if (value['coverColor'] !== undefined && typeof value['coverColor'] !== 'string') return false;
  return true;
}

function isValidFootnotes(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(isValidBlockList);
}

/**
 * Full structural check of a cached `Book`. JSON that parses but does not match this shape (a
 * half-written file, an older format, a hand-edited cache) must never reach `readBookBundle`:
 * malformed `chapters`/`blocks` would surface as an empty or broken reader instead of a re-parse.
 */
function isStructurallyValidBook(value: unknown): value is Book {
  if (!isPlainObject(value)) return false;
  if (!isValidBookMeta(value['meta'])) return false;
  if (!isValidFootnotes(value['footnotes'])) return false;
  if (typeof value['wordCount'] !== 'number' || !Number.isFinite(value['wordCount'])) return false;
  if (typeof value['id'] !== 'string') return false;
  const chapters = value['chapters'];
  if (!Array.isArray(chapters)) return false;
  return chapters.every(isValidChapter);
}

export async function readParsedCache(bookDir: Directory): Promise<ParsedBookCache | null> {
  const file = new File(bookDir, PARSED_CACHE_FILE);
  if (!file.exists) return null;
  try {
    const parsed = JSON.parse(await readFileText(file)) as Partial<ParsedBookCache> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.sourceFormat !== 'md' && parsed.sourceFormat !== 'txt') return null;
    if (typeof parsed.parserVersion !== 'number') return null;
    if (typeof parsed.rawTextHash !== 'string') return null;
    const book = parsed.book;
    if (!isStructurallyValidBook(book)) return null;
    return {
      parserVersion: parsed.parserVersion,
      sourceFormat: parsed.sourceFormat,
      ...(typeof parsed.cleanArabic === 'boolean' ? { cleanArabic: parsed.cleanArabic } : {}),
      rawTextHash: parsed.rawTextHash,
      book,
    };
  } catch {
    // A corrupt cache is never fatal: the caller falls back to parsing `book.md`.
    return null;
  }
}

const PARSED_CACHE_TEMP_FILE = `${PARSED_CACHE_FILE}.tmp`;

function tryDeleteFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Best effort: a leftover temp file is harmless, a thrown delete is not.
  }
}

/**
 * Persist the cache through a temp file + move so an interrupted write can never leave a
 * half-serialized `parsed-cache.json` behind (a torn cache would look like a corrupt one and
 * force a full re-parse). Errors are the caller's to swallow: the cache is an optimization.
 */
export async function writeParsedCache(
  bookDir: Directory,
  cache: ParsedBookCache,
): Promise<void> {
  const payload = JSON.stringify(cache);
  const tempFile = new File(bookDir, PARSED_CACHE_TEMP_FILE);
  const targetFile = new File(bookDir, PARSED_CACHE_FILE);
  try {
    await tempFile.write(payload);
    await tempFile.move(targetFile, { overwrite: true });
  } catch (error) {
    // Fall back to an in-place write before giving up, and never leave a stray temp file behind.
    try {
      await targetFile.write(payload);
    } catch {
      tryDeleteFile(tempFile);
      throw error;
    }
    tryDeleteFile(tempFile);
  }
}

export function buildStoredManifest(
  book: Book,
  sourceFormat: 'md' | 'txt',
  cleanArabic?: boolean,
): StoredManifest {
  return {
    id: book.id,
    meta: book.meta,
    chapters: book.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      wordCount: chapter.wordCount,
      hash: chapter.hash,
      ...(chapter.rawHash ? { rawHash: chapter.rawHash } : {}),
    })),
    wordCount: book.wordCount,
    parserVersion: PARSER_VERSION,
    sourceFormat,
    ...(typeof cleanArabic === 'boolean' ? { cleanArabic } : {}),
  };
}

function findChapterForBlock(book: Book, blockId: string): { id: string; title: string } | null {
  if (!blockId) return null;
  for (const chapter of book.chapters) {
    if (chapter.blocks.some((block) => block.id === blockId)) {
      return { id: chapter.id, title: chapter.title };
    }
  }
  return null;
}

export type ReanchorOptions = {
  /** `oldChapterId -> newChapterId` for the chapters a delta re-parse reused verbatim. */
  reusedChapterIdMap?: Record<string, string>;
  /** Previous chapter ids that no longer exist in the new book. */
  removedChapterIds?: readonly string[];
};

type ChapterTarget =
  /** The anchor's chapter was reused verbatim: remap its id prefix, keep its place in the text. */
  | { kind: 'reused'; oldChapterId: string; newChapterId: string; chapter: Chapter }
  /** The anchor's chapter was re-parsed: fuzzy matching is confined to that one chapter. */
  | { kind: 'modified'; chapter: Chapter };

function chapterIdFromBlockId(blockId: string): string {
  return blockId.split('_')[0] ?? '';
}

/**
 * Decide which new chapter an anchored item may resolve against.
 *
 * Why (tech): after a re-parse the stored `chapterId` may name a chapter that moved (reused), was
 * edited, or disappeared. Matching by text across the whole book is exactly the bug this guards
 * against — a new chapter that repeats a sentence would steal the anchor — so a reused chapter is
 * matched by id only, a modified chapter confines the search to itself, and anything else is left
 * unmatched rather than snapped somewhere plausible.
 */
function resolveChapterTarget(
  book: Book,
  itemChapterId: string | undefined,
  itemChapterTitle: string | undefined,
  blockId: string,
  options: ReanchorOptions,
): ChapterTarget | null {
  const oldChapterId = itemChapterId?.trim() || chapterIdFromBlockId(blockId);
  const reusedMap = options.reusedChapterIdMap ?? {};

  if (oldChapterId) {
    const newChapterId = reusedMap[oldChapterId];
    if (newChapterId) {
      const chapter = book.chapters.find((candidate) => candidate.id === newChapterId);
      if (chapter) return { kind: 'reused', oldChapterId, newChapterId, chapter };
    }
    // A deleted chapter's text may still exist elsewhere (moved into another chapter, duplicated
    // by an insertion): snapping to it would silently move the user's anchor, so keep it unmatched.
    if ((options.removedChapterIds ?? []).includes(oldChapterId)) return null;
  }

  // A re-parsed chapter keeps only its title as a stable identity; it must be unique.
  const title = itemChapterTitle?.trim();
  if (title) {
    const byTitle = book.chapters.filter((candidate) => candidate.title === title);
    if (byTitle.length === 1) return { kind: 'modified', chapter: byTitle[0]! };
    return null;
  }

  if (!oldChapterId) return null;
  const sameId = book.chapters.find((candidate) => candidate.id === oldChapterId);
  return sameId ? { kind: 'modified', chapter: sameId } : null;
}

function remapBlockId(blockId: string, oldChapterId: string, newChapterId: string): string {
  if (!blockId) return blockId;
  const prefix = `${oldChapterId}_`;
  if (blockId.startsWith(prefix)) {
    return `${newChapterId}_${blockId.slice(prefix.length)}`;
  }
  return blockId.replace(/^ch\d+_/, `${newChapterId}_`);
}

function hasBlock(chapter: Chapter, blockId: string): boolean {
  return Boolean(blockId) && chapter.blocks.some((block) => block.id === blockId);
}

function chapterOnlyBook(book: Book, chapter: Chapter): Book {
  return { ...book, chapters: [chapter] };
}

function isReanchorStrict(options?: ReanchorOptions): options is ReanchorOptions {
  if (!options) return false;
  return Boolean(options.reusedChapterIdMap) || Boolean(options.removedChapterIds);
}

/**
 * Re-resolve every highlight and bookmark against the freshly parsed book so their stored anchor
 * (block + offset), chapter id and chapter title match the new chapter structure. The user-facing
 * fields (quote, context, note, color, id, createdAt) are never rewritten.
 *
 * When the delta result is supplied (`options`), the resolution is structure-aware: an anchor in a
 * chapter reused verbatim is remapped by id with its exact offset and length, an anchor in a
 * modified chapter is searched inside that chapter only, and an anchor whose chapter disappeared
 * stays unmatched. Without it, the historical whole-book fuzzy search runs.
 */
export function reanchorReaderItems(
  book: Book,
  state: BookReaderState,
  options?: ReanchorOptions,
): { state: BookReaderState; reanchoredHighlights: number; reanchoredBookmarks: number } {
  let reanchoredHighlights = 0;
  let reanchoredBookmarks = 0;

  const nextState: BookReaderState = { ...state };
  const strict = isReanchorStrict(options);

  if (Array.isArray(state.highlights)) {
    nextState.highlights = state.highlights.map((item: HighlightItem) => {
      const target = strict
        ? resolveChapterTarget(book, item.chapterId, item.chapterTitle, item.anchor.blockId, options)
        : null;
      if (strict && !target) return item;

      const range = target
        ? resolveHighlightInChapter(book, target, item)
        : resolveHighlightRange(book, item);
      if (!range || !range.anchor.blockId || range.length <= 0) return item;

      const chapter = target?.chapter ?? findChapterForBlock(book, range.anchor.blockId);
      const chapterId = chapter?.id ?? item.chapterId;
      const chapterTitle = chapter?.title ?? item.chapterTitle;
      const unchanged =
        item.anchor.blockId === range.anchor.blockId &&
        item.anchor.charOffset === range.anchor.charOffset &&
        item.length === range.length &&
        item.chapterId === chapterId &&
        item.chapterTitle === chapterTitle;
      if (unchanged) return item;

      reanchoredHighlights += 1;
      return {
        ...item,
        anchor: { blockId: range.anchor.blockId, charOffset: range.anchor.charOffset },
        length: range.length,
        chapterId,
        chapterTitle,
      };
    });
  }

  if (Array.isArray(state.bookmarkItems)) {
    nextState.bookmarkItems = state.bookmarkItems.map((item: BookmarkItem) => {
      // Legacy page-only bookmarks have no block to re-anchor; keep them untouched.
      if (!item.anchor.blockId) return item;

      const target = strict
        ? resolveChapterTarget(book, item.chapterId, item.chapterTitle, item.anchor.blockId, options)
        : null;
      if (strict && !target) return item;

      const anchor = target
        ? resolveBookmarkInChapter(book, target, item)
        : resolveBookmarkAnchor(book, item);
      if (!anchor.blockId) return item;

      const chapter = target?.chapter ?? findChapterForBlock(book, anchor.blockId);
      const chapterId = chapter?.id ?? item.chapterId;
      const chapterTitle = chapter?.title ?? item.chapterTitle;
      const unchanged =
        item.anchor.blockId === anchor.blockId &&
        item.anchor.charOffset === anchor.charOffset &&
        item.chapterId === chapterId &&
        item.chapterTitle === chapterTitle;
      if (unchanged) return item;

      reanchoredBookmarks += 1;
      return {
        ...item,
        anchor: { blockId: anchor.blockId, charOffset: anchor.charOffset },
        chapterId,
        chapterTitle,
      };
    });
  }

  return { state: nextState, reanchoredHighlights, reanchoredBookmarks };
}

/**
 * A highlight inside one known chapter: a reused chapter keeps its exact offset/length (its text
 * never changed), a modified chapter is searched (exact block, then context) within that chapter.
 */
function resolveHighlightInChapter(
  book: Book,
  target: ChapterTarget,
  item: HighlightItem,
): { anchor: { blockId: string; charOffset: number }; length: number } | null {
  if (target.kind === 'reused') {
    const blockId = remapBlockId(item.anchor.blockId, target.oldChapterId, target.newChapterId);
    if (hasBlock(target.chapter, blockId)) {
      return { anchor: { blockId, charOffset: item.anchor.charOffset }, length: item.length };
    }
  }
  const scoped = chapterOnlyBook(book, target.chapter);
  const range = resolveHighlightRange(scoped, item);
  if (!range || !hasBlock(target.chapter, range.anchor.blockId)) return null;
  return range;
}

/** A bookmark inside one known chapter, with the same reuse/mutation rules as highlights. */
function resolveBookmarkInChapter(
  book: Book,
  target: ChapterTarget,
  item: BookmarkItem,
): { blockId: string; charOffset: number } {
  if (target.kind === 'reused') {
    const blockId = remapBlockId(item.anchor.blockId, target.oldChapterId, target.newChapterId);
    if (hasBlock(target.chapter, blockId)) {
      return { blockId, charOffset: item.anchor.charOffset };
    }
  }
  const scoped = chapterOnlyBook(book, target.chapter);
  const anchor = resolveBookmarkAnchor(scoped, item);
  if (!hasBlock(target.chapter, anchor.blockId)) return { blockId: '', charOffset: 0 };
  return anchor;
}

async function loadPreviousBook(
  bookId: string,
  bookDir: Directory,
  sourceFormat: 'md' | 'txt',
  fileName: string,
  cleanArabic: boolean,
): Promise<Book> {
  const cache = await readParsedCache(bookDir);
  if (
    cache &&
    cache.parserVersion === PARSER_VERSION &&
    cache.sourceFormat === sourceFormat &&
    (cache.cleanArabic === true) === cleanArabic
  ) {
    return { ...cache.book, id: bookId };
  }

  const bookFile = new File(bookDir, BOOK_FILE);
  if (bookFile.exists) {
    const existingText = await readFileText(bookFile);
    const parsed =
      sourceFormat === 'txt'
        ? parseTxt(existingText, fileName, { cleanArabic })
        : parseBook(existingText, fileName, { cleanArabic });
    return { ...parsed, id: bookId };
  }

  return {
    id: bookId,
    meta: { title: bookId, lang: 'ar', dir: 'rtl' },
    chapters: [],
    footnotes: {},
    wordCount: 0,
  };
}

async function refreshLibraryRecord(book: Book, db?: DatabaseAdapter): Promise<void> {
  const record = await getBookRecord(book.id, db);
  if (!record) return;
  const title = book.meta.title;
  const author = book.meta.author ?? null;
  if (record.title === title && record.author === author && record.dir === book.meta.dir) return;

  // upsertBook keeps the existing `progress` and `addedAt`; only the metadata columns move.
  await upsertBook(
    {
      ...record,
      title,
      author,
      dir: book.meta.dir,
      coverSeed: title,
      coverColor: book.meta.coverColor ?? record.coverColor,
    },
    db,
  );
}

/**
 * Replace a book's raw content while re-parsing only the chapters that actually changed.
 *
 * Writes `book.md`, `manifest.json` (now carrying each chapter's `rawHash`) and
 * `parsed-cache.json`, re-indexes just the changed/added/removed chapters in FTS5, refreshes the
 * library record when the title/author/direction moved, and re-anchors highlights & bookmarks
 * against the new structure before saving `.reader-state.json`.
 */
export async function updateBookContentDelta(
  bookId: string,
  newRawText: string,
  db?: DatabaseAdapter,
): Promise<{ book: Book; delta: DeltaReparseResult; state: BookReaderState }> {
  const bookDir = getBookDir(bookId);
  if (!bookDir.exists) {
    bookDir.create({ intermediates: true, idempotent: true });
  }

  const existingManifest = await readStoredManifest(bookDir);
  const sourceFormat: 'md' | 'txt' = existingManifest?.sourceFormat ?? 'md';
  const cleanArabic = existingManifest?.cleanArabic === true;
  const fileName = `${existingManifest?.meta?.title ?? bookId}.${sourceFormat}`;

  const previousBook = await loadPreviousBook(bookId, bookDir, sourceFormat, fileName, cleanArabic);
  const delta =
    sourceFormat === 'txt'
      ? deltaReparseTxt(newRawText, fileName, previousBook, { cleanArabic })
      : deltaReparseBook(newRawText, fileName, previousBook, { cleanArabic });
  const book: Book = { ...delta.book, id: bookId };

  await new File(bookDir, BOOK_FILE).write(newRawText);
  await new File(bookDir, MANIFEST_FILE).write(
    JSON.stringify(buildStoredManifest(book, sourceFormat, cleanArabic), null, 2),
  );
  try {
    await writeParsedCache(bookDir, {
      parserVersion: PARSER_VERSION,
      sourceFormat,
      cleanArabic,
      rawTextHash: rawTextHash(newRawText),
      book,
    });
  } catch {
    // Why: `book.md` and the manifest already landed, so a cache-write failure must not fail the
    // update — the next open re-parses and re-seeds the cache from the new content.
  }

  // Only the chapters that changed (plus stale ids that disappeared) travel to FTS5. When nothing
  // moved both lists are empty and `indexBookChaptersDelta` performs zero SQL. A delta is only safe
  // when the untouched chapters really are indexed, so a marker that does not match the previous
  // book means the baseline is unknown and the whole book is re-indexed instead.
  try {
    const previousHash = computeSearchContentHash(previousBook);
    const indexedHash = await readSearchIndexHash(bookId, db);
    if (indexedHash !== previousHash) {
      await indexBookForSearch(book, db);
    } else {
      await indexBookChaptersDelta(
        book,
        delta.changedChapterIds,
        delta.removedChapterIds,
        db,
      );
    }
  } catch {
    // The search index is a cache: a DB hiccup must never lose the updated bundle.
  }

  try {
    await refreshLibraryRecord(book, db);
  } catch {
    // Same reasoning as above — metadata refresh is best effort.
  }

  const existingState = await readReaderState(bookId);
  const { state, reanchoredHighlights, reanchoredBookmarks } = reanchorReaderItems(
    book,
    existingState,
    {
      reusedChapterIdMap: delta.reusedChapterIdMap,
      removedChapterIds: delta.removedChapterIds,
    },
  );

  if (reanchoredHighlights > 0 || reanchoredBookmarks > 0) {
    const savedState: BookReaderState = { ...state, updatedAt: Date.now() };
    await saveBookReaderState(bookId, savedState, db);
    return { book, delta, state: savedState };
  }

  return { book, delta, state };
}
