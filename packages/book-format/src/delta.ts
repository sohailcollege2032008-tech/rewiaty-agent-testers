import { hashString } from './hash.js';
import {
  buildChapterBlocks,
  chapterIdForIndex,
  computeChapterRawHash,
  finalizeChapter,
  prepareMarkdownBook,
  prepareTxtBook,
  type BookSourceFormat,
  type ParseOptions,
  type PreparedBookSource,
} from './parser.js';
import type { Block, Book, Chapter } from './types.js';

/**
 * What a delta re-parse did, so callers can touch only the rows that actually moved:
 *
 * - `changedChapterIds` — ids (in the NEW book) whose content must be re-indexed. Covers new
 *   chapters, edited chapters, and chapters whose index (and therefore id) shifted.
 * - `unchangedChapterIds` — ids whose `Chapter` object was reused verbatim, never re-parsed.
 * - `addedChapterIds` — ids of freshly parsed chapters whose title did not exist in the previous
 *   book, i.e. a genuinely new chapter rather than an edit of an existing one.
 * - `removedChapterIds` — previous ids that no longer exist in the new book (stale index rows).
 * - `reusedChapterIdMap` — `oldChapterId -> newChapterId` for every previous chapter reused
 *   verbatim. Anchors (highlights/bookmarks) that point into a reused chapter can be remapped by
 *   id alone, which is the only safe answer when the chapter moved: a fuzzy text search would
 *   happily land on a different chapter that happens to repeat the same sentence.
 * - `reparsedCount` — how many chapters went through block/inline parsing again.
 */
export type DeltaReparseResult = {
  book: Book;
  changedChapterIds: string[];
  unchangedChapterIds: string[];
  addedChapterIds: string[];
  removedChapterIds: string[];
  reusedChapterIdMap: Record<string, string>;
  reparsedCount: number;
  footnotesChanged: boolean;
};

/**
 * Delta re-parse a Markdown book against a previously parsed one.
 *
 * Chapters whose raw source hash is unchanged are reused (or remapped to their new id when the
 * document shifted them) and never travel through the markdown pipeline again. The returned
 * `book` is byte-identical to `parseBook(rawText, fileName, options)`, including its id.
 */
export function deltaReparseBook(
  rawText: string,
  fileName: string,
  previousBook: Book,
  options?: ParseOptions,
): DeltaReparseResult {
  return buildDelta(prepareMarkdownBook(rawText, fileName, options), 'md', fileName, previousBook, options);
}

/**
 * Delta re-parse a plain-text book against a previously parsed one. Mirrors
 * `deltaReparseBook` and is byte-identical to `parseTxt(rawText, fileName, options)`.
 */
export function deltaReparseTxt(
  rawText: string,
  fileName: string,
  previousBook: Book,
  options?: ParseOptions,
): DeltaReparseResult {
  return buildDelta(prepareTxtBook(rawText, fileName, options), 'txt', fileName, previousBook, options);
}

function footnotesSignature(footnotes: Record<string, Block[]>): string {
  const ids = Object.keys(footnotes).sort();
  const rows = ids.map((id) => {
    const blocks = footnotes[id] ?? [];
    const blockPart = blocks
      .map((block) => `${block.id}|${block.kind}|${block.noIndent ? '1' : '0'}|${block.html}`)
      .join('~');
    return `${id}=${blockPart}`;
  });
  return hashString(rows.join('\n'));
}

/**
 * Move a reused chapter to a different index: the chapter id and every block id prefix follow,
 * while titles, html, word counts and hashes stay untouched (their content never changed).
 */
function remapChapter(previous: Chapter, newIndex: number, rawHash: string): Chapter {
  const newId = chapterIdForIndex(newIndex);
  const oldPrefix = `${previous.id}_`;
  const blocks: Block[] = previous.blocks.map((block) => {
    const blockId = block.id.startsWith(oldPrefix)
      ? `${newId}_${block.id.slice(oldPrefix.length)}`
      : block.id.replace(/^ch\d+_/, `${newId}_`);
    const next: Block = { id: blockId, kind: block.kind, html: block.html };
    if (block.noIndent) {
      next.noIndent = true;
    }
    return next;
  });

  return {
    id: newId,
    title: previous.title,
    blocks,
    wordCount: previous.wordCount,
    hash: previous.hash,
    rawHash,
  };
}

function buildDelta(
  prepared: PreparedBookSource,
  format: BookSourceFormat,
  fileName: string,
  previousBook: Book,
  options?: ParseOptions,
): DeltaReparseResult {
  const previousChapters = previousBook.chapters;
  const previousTitles = new Set(previousChapters.map((chapter) => chapter.title));
  const rawHashes = prepared.slices.map((slice) =>
    computeChapterRawHash(slice, prepared.knownFootnotes, format, options),
  );

  // Every previous chapter can be matched at most once, and only when it carries a hash computed
  // by the current algorithm (older caches simply re-parse).
  const previousByHash = new Map<string, number[]>();
  for (let i = 0; i < previousChapters.length; i += 1) {
    const hash = previousChapters[i]?.rawHash;
    if (!hash) continue;
    const bucket = previousByHash.get(hash);
    if (bucket) {
      bucket.push(i);
    } else {
      previousByHash.set(hash, [i]);
    }
  }

  const usedPreviousIndexes = new Set<number>();
  const chapters: Chapter[] = [];
  const changedChapterIds: string[] = [];
  const unchangedChapterIds: string[] = [];
  const addedChapterIds: string[] = [];
  const reusedChapterIdMap: Record<string, string> = {};
  let reparsedCount = 0;

  for (let i = 0; i < prepared.slices.length; i += 1) {
    const slice = prepared.slices[i]!;
    const rawHash = rawHashes[i]!;
    const newId = chapterIdForIndex(i + 1);

    // Prefer the chapter sitting at the same index (the common edit-in-place case), then any
    // unused chapter that carries the same raw hash (a pure move/reorder).
    let reusedIndex: number | undefined;
    const sameIndex = previousChapters[i];
    if (sameIndex && !usedPreviousIndexes.has(i) && sameIndex.rawHash === rawHash) {
      reusedIndex = i;
    } else {
      const candidates = previousByHash.get(rawHash);
      if (candidates) {
        reusedIndex = candidates.find((idx) => !usedPreviousIndexes.has(idx));
      }
    }

    if (reusedIndex !== undefined) {
      const previous = previousChapters[reusedIndex]!;
      usedPreviousIndexes.add(reusedIndex);
      reusedChapterIdMap[previous.id] = newId;
      if (reusedIndex === i && previous.id === newId) {
        // Same place, same content: hand back the exact object, no parsing at all.
        chapters.push(previous);
        unchangedChapterIds.push(newId);
      } else {
        chapters.push(remapChapter(previous, i + 1, rawHash));
        changedChapterIds.push(newId);
      }
      continue;
    }

    const chapter = finalizeChapter(
      i + 1,
      slice.title,
      buildChapterBlocks(format, slice, prepared.knownFootnotes),
      rawHash,
    );
    chapters.push(chapter);
    changedChapterIds.push(chapter.id);
    reparsedCount += 1;
    if (!previousTitles.has(chapter.title)) {
      addedChapterIds.push(chapter.id);
    }
  }

  const newIds = new Set(chapters.map((chapter) => chapter.id));
  const removedChapterIds: string[] = [];
  for (const previous of previousChapters) {
    if (!newIds.has(previous.id) && !removedChapterIds.includes(previous.id)) {
      removedChapterIds.push(previous.id);
    }
  }

  const wordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const book: Book = {
    id: `book_${hashString(`${fileName}\n${prepared.meta.title}\n${chapters[0]?.hash ?? ''}`)}`,
    meta: prepared.meta,
    chapters,
    footnotes: prepared.footnotes,
    wordCount,
  };

  return {
    book,
    changedChapterIds,
    unchangedChapterIds,
    addedChapterIds,
    removedChapterIds,
    reusedChapterIdMap,
    reparsedCount,
    footnotesChanged:
      footnotesSignature(prepared.footnotes) !== footnotesSignature(previousBook.footnotes),
  };
}
