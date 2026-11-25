import type { Anchor, Block, Book, Chapter } from '@rewiaty/book-format';

import type { BookmarkItem } from '@/types/reader';

export type { BookmarkItem };

const QUOTE_MAX_CHARS = 80;
const CONTEXT_MAX_CHARS = 25;
const FUZZY_CONTEXT_WINDOW = 40;

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * Plain text of a block exactly as the DOM sees it: tags removed, entities decoded,
 * and every character (including Arabic Tashkeel) kept as-is. `<br>` contributes no
 * character in `textContent`, so dropping it keeps `charOffset` aligned with the engine.
 */
export function blockToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITY_MAP[entity] ?? entity);
}

function findBlock(book: Book, blockId: string): { chapter: Chapter; block: Block } | null {
  if (!blockId) return null;
  for (const chapter of book.chapters) {
    const block = chapter.blocks.find((candidate) => candidate.id === blockId);
    if (block) return { chapter, block };
  }
  return null;
}

function clampOffset(value: number, length: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), length);
}

/**
 * Quote (up to ~80 chars) at the anchor plus the surrounding context, from the chapter
 * that owns the anchored block. Never throws on an unknown block: it degrades to an
 * empty quote while still naming the chapter when the id prefix makes it obvious.
 */
export function extractBookmarkContext(
  book: Book,
  anchor: Anchor,
): {
  chapterId: string;
  chapterTitle: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
} {
  const found = findBlock(book, anchor.blockId);
  if (!found) {
    const chapterId = anchor.blockId.split('_')[0] ?? '';
    const chapter = book.chapters.find((candidate) => candidate.id === chapterId);
    return {
      chapterId: chapter?.id ?? chapterId,
      chapterTitle: chapter?.title ?? '',
      quote: '',
      contextBefore: '',
      contextAfter: '',
    };
  }

  const text = blockToPlainText(found.block.html);
  let start = clampOffset(anchor.charOffset, text.length);
  // Skip whitespace at the anchor so the stored quote starts on a readable character.
  while (start < text.length && /\s/.test(text[start] ?? '')) {
    start += 1;
  }

  const quote = text.slice(start, start + QUOTE_MAX_CHARS).trimEnd();
  const quoteEnd = start + quote.length;
  const contextBefore = text.slice(Math.max(0, start - CONTEXT_MAX_CHARS), start).trim();
  const contextAfter = text.slice(quoteEnd, quoteEnd + CONTEXT_MAX_CHARS).trim();

  return {
    chapterId: found.chapter.id,
    chapterTitle: found.chapter.title,
    quote,
    contextBefore,
    contextAfter,
  };
}

const TASHKEEL_OR_TATWEEL =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/;
const WHITESPACE = /\s/;

function normalizeChar(ch: string): string {
  switch (ch) {
    case 'أ':
    case 'إ':
    case 'آ':
      return 'ا';
    case 'ى':
      return 'ي';
    case 'ة':
      return 'ه';
    case 'ؤ':
      return 'و';
    case 'ئ':
      return 'ي';
    default:
      return ch;
  }
}

/**
 * Normalized text for fuzzy matching, plus a map from every normalized index back to
 * the original string index so a match can be turned into a real `charOffset`.
 */
export function normalizeForMatch(text: string): { text: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = false;

  for (let index = 0; index < text.length; index += 1) {
    const original = text[index] ?? '';
    if (TASHKEEL_OR_TATWEEL.test(original)) continue;

    let ch = original;
    if (WHITESPACE.test(ch)) {
      if (lastWasSpace) continue;
      ch = ' ';
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
      ch = normalizeChar(ch);
    }

    normalized += ch;
    map.push(index);
  }

  return { text: normalized, map };
}

function findFuzzyAnchor(book: Book, item: BookmarkItem): Anchor | null {
  const normalizedQuote = normalizeForMatch(item.quote).text.trim();
  if (!normalizedQuote) return null;

  const normalizedBefore = normalizeForMatch(item.contextBefore).text.trim();
  const normalizedAfter = normalizeForMatch(item.contextAfter).text.trim();

  const preferredChapterId = item.chapterId || item.anchor.blockId.split('_')[0] || '';
  const orderedChapters = [
    ...book.chapters.filter((chapter) => chapter.id === preferredChapterId),
    ...book.chapters.filter((chapter) => chapter.id !== preferredChapterId),
  ];

  let best: { anchor: Anchor; score: number } | null = null;

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
        const originalEnd =
          normalized.map[Math.min(normalized.text.length - 1, matchIndex + normalizedQuote.length - 1)] ??
          originalStart;

        let score = 0;
        if (normalizedBefore) {
          const before = normalizeForMatch(
            text.slice(Math.max(0, originalStart - FUZZY_CONTEXT_WINDOW), originalStart),
          ).text;
          if (before.endsWith(normalizedBefore)) score += 2;
        }
        if (normalizedAfter) {
          const after = normalizeForMatch(
            text.slice(originalEnd + 1, originalEnd + 1 + FUZZY_CONTEXT_WINDOW),
          ).text;
          if (after.startsWith(normalizedAfter)) score += 2;
        }

        if (!best || score > best.score) {
          best = { anchor: { blockId: block.id, charOffset: originalStart }, score };
        }

        searchFrom = matchIndex + 1;
      }
    }
  }

  return best?.anchor ?? null;
}

/**
 * The anchor a bookmark should jump to today. Prefers the stored block, falls back to a
 * quote search inside the chapter and then the whole book (text reflow / re-parse), and
 * finally returns the stored anchor so navigation never dead-ends.
 */
export function resolveBookmarkAnchor(book: Book, item: BookmarkItem): Anchor {
  const stored = item.anchor;
  const found = findBlock(book, stored.blockId);

  if (found) {
    const text = blockToPlainText(found.block.html);
    if (!item.quote) return { blockId: stored.blockId, charOffset: clampOffset(stored.charOffset, text.length) };

    const offset = clampOffset(stored.charOffset, text.length);
    if (text.startsWith(item.quote, offset)) {
      return { blockId: stored.blockId, charOffset: offset };
    }

    const movedIndex = text.indexOf(item.quote);
    if (movedIndex >= 0) {
      return { blockId: stored.blockId, charOffset: movedIndex };
    }
  }

  return (
    findFuzzyAnchor(book, item) ?? {
      blockId: stored.blockId,
      charOffset: Math.max(0, Math.floor(stored.charOffset)),
    }
  );
}

/**
 * Read bookmarks back from storage without ever throwing: valid text-anchored items are
 * kept, malformed rows are dropped, and old numeric (page-only) bookmarks survive as
 * page-anchored items so nothing a reader saved disappears.
 */
export function normalizeBookmarkItems(
  rawItems: unknown,
  legacyPages: unknown,
  book?: Book,
): BookmarkItem[] {
  const items: BookmarkItem[] = [];
  const seenIds = new Set<string>();

  if (Array.isArray(rawItems)) {
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const candidate = raw as Partial<BookmarkItem> & Record<string, unknown>;
      const rawAnchor = candidate.anchor as Partial<Anchor> | null | undefined;
      if (!rawAnchor || typeof rawAnchor !== 'object') continue;

      const blockId = rawAnchor.blockId;
      const charOffset = rawAnchor.charOffset;
      const rawPage = candidate.page;
      const isLegacyPageItem =
        blockId === '' && typeof rawPage === 'number' && Number.isFinite(rawPage);
      if (typeof blockId !== 'string' || (!blockId && !isLegacyPageItem)) continue;
      if (typeof charOffset !== 'number' || !Number.isFinite(charOffset)) continue;

      const createdAt =
        typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : 0;
      const id =
        typeof candidate.id === 'string' && candidate.id
          ? candidate.id
          : `bookmark-${createdAt}-${blockId}-${Math.round(charOffset)}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      let chapterId = typeof candidate.chapterId === 'string' ? candidate.chapterId : '';
      let chapterTitle = typeof candidate.chapterTitle === 'string' ? candidate.chapterTitle : '';
      let quote = typeof candidate.quote === 'string' ? candidate.quote : '';
      let contextBefore =
        typeof candidate.contextBefore === 'string' ? candidate.contextBefore : '';
      let contextAfter = typeof candidate.contextAfter === 'string' ? candidate.contextAfter : '';

      if (book && blockId && (!quote || !chapterTitle || !chapterId)) {
        const context = extractBookmarkContext(book, { blockId, charOffset });
        if (!quote) quote = context.quote;
        if (!chapterId) chapterId = context.chapterId;
        if (!chapterTitle) chapterTitle = context.chapterTitle;
        if (!contextBefore) contextBefore = context.contextBefore;
        if (!contextAfter) contextAfter = context.contextAfter;
      }

      const page =
        typeof candidate.page === 'number' && Number.isFinite(candidate.page)
          ? candidate.page
          : undefined;

      items.push({
        id,
        anchor: { blockId, charOffset },
        chapterId,
        chapterTitle,
        quote,
        contextBefore,
        contextAfter,
        ...(page !== undefined ? { page } : {}),
        createdAt,
      });
    }
  }

  if (Array.isArray(legacyPages)) {
    for (const rawPage of legacyPages) {
      if (typeof rawPage !== 'number' || !Number.isFinite(rawPage)) continue;
      if (items.some((item) => item.page === rawPage)) continue;

      const id = `legacy-page-${rawPage}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      items.push({
        id,
        anchor: { blockId: '', charOffset: 0 },
        chapterId: '',
        chapterTitle: '',
        quote: '',
        contextBefore: '',
        contextAfter: '',
        page: rawPage,
        createdAt: 0,
      });
    }
  }

  return items;
}

export function isPositionBookmarked(
  items: BookmarkItem[],
  anchor: Anchor | null,
  page: number,
): boolean {
  return items.some((item) => {
    if (
      anchor &&
      item.anchor.blockId &&
      item.anchor.blockId === anchor.blockId &&
      item.anchor.charOffset === anchor.charOffset
    ) {
      return true;
    }
    // Why: page numbers shift with font size/theme/rotation, so only legacy page-only items
    // (no anchor) may match by page; anchored items match by anchor alone.
    return !item.anchor.blockId && item.page !== undefined && page > 0 && item.page === page;
  });
}

export type BookmarkPosition = {
  anchor: Anchor | null;
  page?: number;
  chapterId: string;
  chapterTitle: string;
  quote?: string;
  contextBefore?: string;
  contextAfter?: string;
  now?: number;
};

export type ToggleBookmarkResult = {
  items: BookmarkItem[];
  added: boolean;
  removedId: string | null;
};

/**
 * Add a bookmark at the current reading position, or remove the one already sitting
 * there (same anchor, or the same page when the anchor moved within the page).
 */
export function toggleBookmarkAtPosition(
  items: BookmarkItem[],
  position: BookmarkPosition,
): ToggleBookmarkResult {
  const anchor = position.anchor;
  const existing = items.find((item) => {
    if (anchor && item.anchor.blockId && item.anchor.blockId === anchor.blockId) {
      if (item.anchor.charOffset === anchor.charOffset) return true;
    }
    return (
      !item.anchor.blockId &&
      item.page !== undefined &&
      position.page !== undefined &&
      position.page > 0 &&
      item.page === position.page
    );
  });

  if (existing) {
    return {
      items: removeBookmarkById(items, existing.id),
      added: false,
      removedId: existing.id,
    };
  }

  const createdAt = position.now ?? Date.now();
  const blockKey = anchor?.blockId || 'page';
  const offsetKey = anchor ? Math.round(anchor.charOffset) : (position.page ?? 0);
  let id = `bookmark-${createdAt}-${blockKey}-${offsetKey}`;
  if (items.some((item) => item.id === id)) {
    id = `${id}-${items.length + 1}`;
  }

  const item: BookmarkItem = {
    id,
    anchor: anchor ?? { blockId: '', charOffset: 0 },
    chapterId: position.chapterId,
    chapterTitle: position.chapterTitle,
    quote: position.quote ?? '',
    contextBefore: position.contextBefore ?? '',
    contextAfter: position.contextAfter ?? '',
    ...(position.page !== undefined ? { page: position.page } : {}),
    createdAt,
  };

  return { items: [...items, item], added: true, removedId: null };
}

export function removeBookmarkById(items: BookmarkItem[], id: string): BookmarkItem[] {
  return items.filter((item) => item.id !== id);
}

export function sortBookmarksNewestFirst(items: BookmarkItem[]): BookmarkItem[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
