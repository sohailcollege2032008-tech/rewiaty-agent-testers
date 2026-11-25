import { Share } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { Anchor, Block, Book, Chapter } from '@rewiaty/book-format';

import { blockToPlainText, normalizeForMatch } from '@/storage/bookmarks';
import {
  HIGHLIGHT_COLORS,
  type EngineHighlight,
  type HighlightColor,
  type HighlightItem,
} from '@/types/reader';

export type { HighlightColor, HighlightItem };

export const HIGHLIGHT_CONTEXT_CHARS = 20;
const FUZZY_CONTEXT_WINDOW = 48;
const TASHKEEL_OR_TATWEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/;
const VALID_COLORS = new Set<HighlightColor>(HIGHLIGHT_COLORS.map((c) => c.id));

function findBlock(book: Book, blockId: string): { chapter: Chapter; block: Block; blockIndex: number } | null {
  if (!blockId) return null;
  for (const chapter of book.chapters) {
    const blockIndex = chapter.blocks.findIndex((candidate) => candidate.id === blockId);
    if (blockIndex >= 0) {
      return { chapter, block: chapter.blocks[blockIndex]!, blockIndex };
    }
  }
  return null;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function includeTrailingTashkeel(text: string, endExclusive: number): number {
  let cursor = endExclusive;
  while (cursor < text.length && TASHKEEL_OR_TATWEEL.test(text[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor;
}

function suffixMatchScore(haystackEnd: string, needle: string): number {
  if (!needle || !haystackEnd) return 0;
  if (haystackEnd.endsWith(needle)) return 4;
  const maxCheck = Math.min(haystackEnd.length, needle.length);
  let matched = 0;
  for (let i = 1; i <= maxCheck; i += 1) {
    if (haystackEnd[haystackEnd.length - i] === needle[needle.length - i]) {
      matched += 1;
    } else {
      break;
    }
  }
  if (matched >= 6) return 2;
  if (matched >= 3) return 1;
  return 0;
}

function prefixMatchScore(haystackStart: string, needle: string): number {
  if (!needle || !haystackStart) return 0;
  if (haystackStart.startsWith(needle)) return 4;
  const maxCheck = Math.min(haystackStart.length, needle.length);
  let matched = 0;
  for (let i = 0; i < maxCheck; i += 1) {
    if (haystackStart[i] === needle[i]) {
      matched += 1;
    } else {
      break;
    }
  }
  if (matched >= 6) return 2;
  if (matched >= 3) return 1;
  return 0;
}

function scoreContext(
  text: string,
  originalStart: number,
  originalEndExclusive: number,
  normalizedBefore: string,
  normalizedAfter: string,
): number {
  let score = 0;
  if (normalizedBefore) {
    const beforeRaw = text.slice(Math.max(0, originalStart - FUZZY_CONTEXT_WINDOW), originalStart);
    const beforeNorm = normalizeForMatch(beforeRaw).text.trimEnd();
    score += suffixMatchScore(beforeNorm, normalizedBefore);
  }
  if (normalizedAfter) {
    const afterRaw = text.slice(originalEndExclusive, originalEndExclusive + FUZZY_CONTEXT_WINDOW);
    const afterNorm = normalizeForMatch(afterRaw).text.trimStart();
    score += prefixMatchScore(afterNorm, normalizedAfter);
  }
  return score;
}

export function extractHighlightContext(
  book: Book,
  anchor: Anchor,
  length: number,
): {
  chapterId: string;
  chapterTitle: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  length: number;
  charOffset: number;
} {
  const found = findBlock(book, anchor.blockId);
  if (!found) {
    const chapterId = anchor.blockId.split('_')[0] ?? '';
    const chapter = book.chapters.find((c) => c.id === chapterId);
    return {
      chapterId: chapter?.id ?? chapterId,
      chapterTitle: chapter?.title ?? '',
      quote: '',
      contextBefore: '',
      contextAfter: '',
      length: Math.max(0, Math.floor(length)),
      charOffset: Math.max(0, Math.floor(anchor.charOffset)),
    };
  }

  const text = blockToPlainText(found.block.html);
  let start = clampInt(anchor.charOffset, 0, text.length);
  let end = clampInt(start + Math.max(0, length), start, text.length);

  while (start < end && /\s/.test(text[start] ?? '')) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? '')) end -= 1;

  const quote = text.slice(start, end);
  const contextBefore = text.slice(Math.max(0, start - HIGHLIGHT_CONTEXT_CHARS), start);
  const contextAfter = text.slice(end, end + HIGHLIGHT_CONTEXT_CHARS);

  return {
    chapterId: found.chapter.id,
    chapterTitle: found.chapter.title,
    quote,
    contextBefore,
    contextAfter,
    length: quote.length,
    charOffset: start,
  };
}

function findBestExactInBlock(
  text: string,
  blockId: string,
  quote: string,
  preferredOffset: number,
  normalizedBefore: string,
  normalizedAfter: string,
): { anchor: Anchor; length: number; score: number } | null {
  let best: { anchor: Anchor; length: number; score: number; dist: number } | null = null;
  let searchFrom = 0;

  for (;;) {
    const idx = text.indexOf(quote, searchFrom);
    if (idx < 0) break;
    const score = scoreContext(text, idx, idx + quote.length, normalizedBefore, normalizedAfter);
    const dist = Math.abs(idx - preferredOffset);
    if (!best || score > best.score || (score === best.score && dist < best.dist)) {
      best = { anchor: { blockId, charOffset: idx }, length: quote.length, score, dist };
    }
    searchFrom = idx + 1;
  }

  return best ? { anchor: best.anchor, length: best.length, score: best.score } : null;
}

function findFuzzyByContextAndQuote(
  book: Book,
  item: HighlightItem,
): { anchor: Anchor; length: number } | null {
  const normalizedQuote = normalizeForMatch(item.quote).text.trim();
  const normalizedBefore = normalizeForMatch(item.contextBefore).text.trim();
  const normalizedAfter = normalizeForMatch(item.contextAfter).text.trim();
  if (!normalizedQuote && (!normalizedBefore || !normalizedAfter)) return null;

  const preferredChapterId = item.chapterId || item.anchor.blockId.split('_')[0] || '';
  const orderedChapters = [
    ...book.chapters.filter((ch) => ch.id === preferredChapterId),
    ...book.chapters.filter((ch) => ch.id !== preferredChapterId),
  ];

  let best: { anchor: Anchor; length: number; score: number } | null = null;

  // Pass 1: normalized quote match across blocks, ranked by 20-char context before & after.
  if (normalizedQuote) {
    for (const chapter of orderedChapters) {
      for (const block of chapter.blocks) {
        const text = blockToPlainText(block.html);
        if (!text) continue;
        const normalized = normalizeForMatch(text);
        let searchFrom = 0;

        for (;;) {
          const matchIndex = normalized.text.indexOf(normalizedQuote, searchFrom);
          if (matchIndex < 0) break;

          const originalStart = normalized.map[matchIndex] ?? 0;
          const lastBaseIdx =
            normalized.map[Math.min(normalized.text.length - 1, matchIndex + normalizedQuote.length - 1)] ??
            originalStart;
          const originalEndExclusive = includeTrailingTashkeel(text, lastBaseIdx + 1);

          let score = scoreContext(
            text,
            originalStart,
            originalEndExclusive,
            normalizedBefore,
            normalizedAfter,
          );
          if (chapter.id === preferredChapterId) score += 1;
          if (block.id === item.anchor.blockId) score += 1;

          if (!best || score > best.score) {
            best = {
              anchor: { blockId: block.id, charOffset: originalStart },
              length: Math.max(1, originalEndExclusive - originalStart),
              score,
            };
          }
          searchFrom = matchIndex + 1;
        }
      }
    }
  }

  if (best) {
    return { anchor: best.anchor, length: best.length };
  }

  // Pass 2: quote itself was edited slightly; bracket via contextBefore + contextAfter.
  if (normalizedBefore.length >= 4 && normalizedAfter.length >= 4) {
    for (const chapter of orderedChapters) {
      for (const block of chapter.blocks) {
        const text = blockToPlainText(block.html);
        if (!text) continue;
        const normalized = normalizeForMatch(text);
        const beforeIdx = normalized.text.indexOf(normalizedBefore);
        if (beforeIdx < 0) continue;

        const spanNormStart = beforeIdx + normalizedBefore.length;
        const afterIdx = normalized.text.indexOf(normalizedAfter, spanNormStart);
        if (afterIdx <= spanNormStart) continue;

        const spanNormLen = afterIdx - spanNormStart;
        const expectedLen = Math.max(4, normalizedQuote.length);
        if (spanNormLen > Math.max(expectedLen * 2.5, expectedLen + 40)) continue;

        let trimmedStart = spanNormStart;
        while (trimmedStart < afterIdx && normalized.text[trimmedStart] === ' ') trimmedStart += 1;
        let trimmedEnd = afterIdx;
        while (trimmedEnd > trimmedStart && normalized.text[trimmedEnd - 1] === ' ') trimmedEnd -= 1;
        if (trimmedEnd <= trimmedStart) continue;

        const originalStart = normalized.map[trimmedStart] ?? 0;
        const lastBaseIdx = normalized.map[trimmedEnd - 1] ?? originalStart;
        const originalEndExclusive = includeTrailingTashkeel(text, lastBaseIdx + 1);

        return {
          anchor: { blockId: block.id, charOffset: originalStart },
          length: Math.max(1, originalEndExclusive - originalStart),
        };
      }
    }
  }

  // Pass 3: long quote edited in the middle — match prefix + suffix anchors inside a block.
  if (normalizedQuote.length >= 16) {
    const anchorLen = Math.max(6, Math.floor(normalizedQuote.length * 0.35));
    const head = normalizedQuote.slice(0, anchorLen).trim();
    const tail = normalizedQuote.slice(normalizedQuote.length - anchorLen).trim();
    if (head.length >= 5 && tail.length >= 5) {
      for (const chapter of orderedChapters) {
        for (const block of chapter.blocks) {
          const text = blockToPlainText(block.html);
          if (!text) continue;
          const normalized = normalizeForMatch(text);
          const headIdx = normalized.text.indexOf(head);
          if (headIdx < 0) continue;
          const tailIdx = normalized.text.indexOf(tail, headIdx + head.length);
          if (tailIdx < 0) continue;

          const spanLen = tailIdx + tail.length - headIdx;
          if (spanLen > normalizedQuote.length * 2.5 + 30) continue;

          const originalStart = normalized.map[headIdx] ?? 0;
          const lastBaseIdx = normalized.map[tailIdx + tail.length - 1] ?? originalStart;
          const originalEndExclusive = includeTrailingTashkeel(text, lastBaseIdx + 1);
          return {
            anchor: { blockId: block.id, charOffset: originalStart },
            length: Math.max(1, originalEndExclusive - originalStart),
          };
        }
      }
    }
  }

  return null;
}

/**
 * Re-resolve a highlight's block + offset + length against the current parsed book.
 * Matches by text anchor and 20-char surrounding context (never by page number).
 */
export function resolveHighlightRange(
  book: Book,
  item: HighlightItem,
): { anchor: Anchor; length: number } | null {
  const stored = item.anchor;
  const found = findBlock(book, stored.blockId);
  const normalizedBefore = normalizeForMatch(item.contextBefore).text.trim();
  const normalizedAfter = normalizeForMatch(item.contextAfter).text.trim();

  if (found) {
    const text = blockToPlainText(found.block.html);
    if (!item.quote) {
      const offset = clampInt(stored.charOffset, 0, text.length);
      const len = clampInt(item.length, 0, Math.max(0, text.length - offset));
      return { anchor: { blockId: stored.blockId, charOffset: offset }, length: len };
    }

    const offset = clampInt(stored.charOffset, 0, text.length);
    if (text.startsWith(item.quote, offset)) {
      return {
        anchor: { blockId: stored.blockId, charOffset: offset },
        length: item.quote.length,
      };
    }

    const movedExact = findBestExactInBlock(
      text,
      stored.blockId,
      item.quote,
      offset,
      normalizedBefore,
      normalizedAfter,
    );
    if (movedExact) {
      return { anchor: movedExact.anchor, length: movedExact.length };
    }
  }

  const fuzzy = findFuzzyByContextAndQuote(book, item);
  if (fuzzy) return fuzzy;

  // Why: when neither the quote nor its context can be found the text under the stored offset
  // is something else now; painting there would highlight the wrong words (Codex #26 P1).
  return null;
}

export function resolveHighlightsForBook(book: Book, items: HighlightItem[]): EngineHighlight[] {
  const resolved: EngineHighlight[] = [];
  for (const item of items) {
    const range = resolveHighlightRange(book, item);
    if (!range || !range.anchor.blockId || range.length <= 0) continue;
    const exists = findBlock(book, range.anchor.blockId);
    if (!exists) continue;
    resolved.push({
      id: item.id,
      blockId: range.anchor.blockId,
      charOffset: range.anchor.charOffset,
      length: range.length,
      color: item.color,
      hasNote: Boolean(item.note && item.note.trim()),
    });
  }
  return resolved;
}

export function normalizeHighlightItems(rawItems: unknown, book?: Book): HighlightItem[] {
  if (!Array.isArray(rawItems)) return [];
  const items: HighlightItem[] = [];
  const seenIds = new Set<string>();

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Partial<HighlightItem> & Record<string, unknown>;
    const rawAnchor = c.anchor as Partial<Anchor> | null | undefined;
    if (!rawAnchor || typeof rawAnchor !== 'object') continue;

    const blockId = rawAnchor.blockId;
    const charOffset = rawAnchor.charOffset;
    const length = c.length;
    if (typeof blockId !== 'string' || !blockId) continue;
    if (typeof charOffset !== 'number' || !Number.isFinite(charOffset) || charOffset < 0) continue;
    if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) continue;

    const color: HighlightColor =
      typeof c.color === 'string' && VALID_COLORS.has(c.color as HighlightColor)
        ? (c.color as HighlightColor)
        : 'gold';

    const createdAt =
      typeof c.createdAt === 'number' && Number.isFinite(c.createdAt) ? c.createdAt : 0;
    const updatedAt =
      typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt) ? c.updatedAt : createdAt;

    const id =
      typeof c.id === 'string' && c.id
        ? c.id
        : `hl-${createdAt}-${blockId}-${Math.round(charOffset)}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    let chapterId = typeof c.chapterId === 'string' ? c.chapterId : '';
    let chapterTitle = typeof c.chapterTitle === 'string' ? c.chapterTitle : '';
    let quote = typeof c.quote === 'string' ? c.quote : '';
    let contextBefore = typeof c.contextBefore === 'string' ? c.contextBefore : '';
    let contextAfter = typeof c.contextAfter === 'string' ? c.contextAfter : '';

    if (book && (!quote || !chapterTitle || !chapterId)) {
      const extracted = extractHighlightContext(book, { blockId, charOffset }, length);
      if (!quote) quote = extracted.quote;
      if (!chapterId) chapterId = extracted.chapterId;
      if (!chapterTitle) chapterTitle = extracted.chapterTitle;
      if (!contextBefore) contextBefore = extracted.contextBefore;
      if (!contextAfter) contextAfter = extracted.contextAfter;
    }

    const note = typeof c.note === 'string' && c.note.trim() ? c.note.trim() : undefined;

    items.push({
      id,
      anchor: { blockId, charOffset: Math.floor(charOffset) },
      length: Math.floor(length),
      color,
      quote,
      contextBefore: contextBefore.slice(-HIGHLIGHT_CONTEXT_CHARS),
      contextAfter: contextAfter.slice(0, HIGHLIGHT_CONTEXT_CHARS),
      chapterId,
      chapterTitle,
      ...(note ? { note } : {}),
      createdAt,
      updatedAt,
    });
  }

  return items;
}

export type CreateHighlightInput = {
  anchor: Anchor;
  length: number;
  color: HighlightColor;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  chapterId: string;
  chapterTitle: string;
  note?: string;
  now?: number;
};

export function addHighlight(
  items: HighlightItem[],
  input: CreateHighlightInput,
): { items: HighlightItem[]; created: HighlightItem } {
  const now = input.now ?? Date.now();
  const baseId = `hl-${now}-${input.anchor.blockId}-${Math.round(input.anchor.charOffset)}`;
  let id = baseId;
  let suffix = 2;
  while (items.some((item) => item.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const trimmedNote = input.note?.trim();
  const created: HighlightItem = {
    id,
    anchor: {
      blockId: input.anchor.blockId,
      charOffset: Math.max(0, Math.floor(input.anchor.charOffset)),
    },
    length: Math.max(1, Math.floor(input.length)),
    color: input.color,
    quote: input.quote,
    contextBefore: input.contextBefore.slice(-HIGHLIGHT_CONTEXT_CHARS),
    contextAfter: input.contextAfter.slice(0, HIGHLIGHT_CONTEXT_CHARS),
    chapterId: input.chapterId,
    chapterTitle: input.chapterTitle,
    ...(trimmedNote ? { note: trimmedNote } : {}),
    createdAt: now,
    updatedAt: now,
  };

  return { items: [...items, created], created };
}

export function updateHighlightColor(
  items: HighlightItem[],
  id: string,
  color: HighlightColor,
  now = Date.now(),
): HighlightItem[] {
  return items.map((item) => (item.id === id ? { ...item, color, updatedAt: now } : item));
}

export function updateHighlightNote(
  items: HighlightItem[],
  id: string,
  note: string | undefined,
  now = Date.now(),
): HighlightItem[] {
  const trimmed = note?.trim();
  return items.map((item) => {
    if (item.id !== id) return item;
    const next: HighlightItem = { ...item, updatedAt: now };
    if (trimmed) {
      next.note = trimmed;
    } else {
      delete next.note;
    }
    return next;
  });
}

export function removeHighlightById(items: HighlightItem[], id: string): HighlightItem[] {
  return items.filter((item) => item.id !== id);
}

export function sortHighlightsNewestFirst(items: HighlightItem[]): HighlightItem[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

function formatBlockquoteMarkdown(quote: string): string {
  return quote
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * Format highlights and notes as Markdown, grouped by chapter in reading order
 * (never ordered by page number).
 */
export function exportHighlightsToMarkdown(book: Book, items: HighlightItem[]): string {
  const lines: string[] = [`# اقتباسات وملاحظات: ${book.meta.title}`];
  if (book.meta.author) {
    lines.push('', `_المؤلف: ${book.meta.author}_`);
  }

  if (items.length === 0) {
    lines.push('', 'لا توجد اقتباسات أو ملاحظات محفوظة بعد.');
    return lines.join('\n') + '\n';
  }

  const chapterOrder = new Map<string, number>();
  const chapterTitles = new Map<string, string>();
  const blockOrder = new Map<string, { chapterId: string; index: number }>();

  book.chapters.forEach((chapter, chIdx) => {
    chapterOrder.set(chapter.id, chIdx);
    chapterTitles.set(chapter.id, chapter.title);
    chapter.blocks.forEach((block, bIdx) => {
      blockOrder.set(block.id, { chapterId: chapter.id, index: bIdx });
    });
  });

  type PositionedItem = {
    item: HighlightItem;
    chapterId: string;
    chapterTitle: string;
    chapterIndex: number;
    blockIndex: number;
    charOffset: number;
  };

  const positioned: PositionedItem[] = items.map((item) => {
    // Unmatched highlights keep their stored position for ordering; the quote text itself is
    // still exported, it just is not painted in the reader.
    const resolvedAnchor = resolveHighlightRange(book, item)?.anchor ?? item.anchor;
    const blockMeta = blockOrder.get(resolvedAnchor.blockId);
    const chapterId = blockMeta?.chapterId ?? (item.chapterId || 'other');
    const chapterIndex = chapterOrder.get(chapterId) ?? Number.MAX_SAFE_INTEGER;
    const chapterTitle =
      chapterTitles.get(chapterId) ?? (item.chapterTitle || 'اقتباسات أخرى');

    return {
      item,
      chapterId,
      chapterTitle,
      chapterIndex,
      blockIndex: blockMeta?.index ?? Number.MAX_SAFE_INTEGER,
      charOffset: resolvedAnchor.charOffset,
    };
  });

  positioned.sort(
    (a, b) =>
      a.chapterIndex - b.chapterIndex ||
      a.chapterId.localeCompare(b.chapterId) ||
      a.blockIndex - b.blockIndex ||
      a.charOffset - b.charOffset ||
      a.item.createdAt - b.item.createdAt,
  );

  const grouped = new Map<string, { title: string; entries: PositionedItem[] }>();
  for (const entry of positioned) {
    const bucket = grouped.get(entry.chapterId);
    if (bucket) {
      bucket.entries.push(entry);
    } else {
      grouped.set(entry.chapterId, { title: entry.chapterTitle, entries: [entry] });
    }
  }

  for (const group of grouped.values()) {
    lines.push('', `## ${group.title}`);
    for (const { item } of group.entries) {
      lines.push('', formatBlockquoteMarkdown(item.quote));
      if (item.note && item.note.trim()) {
        lines.push('', `- **ملاحظة:** ${item.note.trim()}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

function sanitizeExportFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${cleaned || 'rewiaty'}-highlights.md`;
}

export async function shareHighlightsMarkdown(
  book: Book,
  items: HighlightItem[],
): Promise<{ markdown: string; fileUri: string }> {
  const markdown = exportHighlightsToMarkdown(book, items);
  const exportDir = new Directory(Paths.cache, 'exports');
  exportDir.create({ intermediates: true, idempotent: true });

  const file = new File(exportDir, sanitizeExportFileName(book.meta.title));
  await file.write(markdown);

  const title = `اقتباسات وملاحظات: ${book.meta.title}`;
  const sharingAvailable = await Sharing.isAvailableAsync().catch(() => false);
  if (sharingAvailable) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/markdown',
      dialogTitle: title,
      UTI: 'net.daringfireball.markdown',
    });
  } else {
    await Share.share({
      title,
      message: markdown,
      url: file.uri,
    });
  }

  return { markdown, fileUri: file.uri };
}
