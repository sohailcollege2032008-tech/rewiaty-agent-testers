import type { Anchor, Block, Book, Chapter } from '@rewiaty/book-format';

import type { BookReaderState } from '@/types/reader';

/**
 * F28 — «فين كنا واقفين؟».
 *
 * Opening a book after a long absence should feel like coming home, not like a cold restart:
 * the recap card says how long the reader was away, where they stopped, the last paragraphs
 * they read and their newest bookmark/highlight. This module owns the *rules* only — what
 * counts as a long absence and what the recap contains — so both the screen and the tests can
 * exercise them without rendering anything.
 */

/** Strictly more than three days away means the reader gets a welcome-back recap. */
export const WELCOME_BACK_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

export type WelcomeBackMarkKind = 'bookmark' | 'highlight' | 'note';

export type WelcomeBackMark = {
  kind: WelcomeBackMarkKind;
  /** «آخر علامة» / «آخر اقتباس» / «آخر ملاحظة». */
  label: string;
  quote: string;
  note?: string;
  chapterTitle?: string;
};

export type WelcomeBackRecap = {
  /** How long the reader was away, in milliseconds. */
  awayMs: number;
  /** Human Arabic sentence, e.g. «غبت ٤ أيام» or «غبت أسبوعين». */
  awayLabel: string;
  /** Title of the chapter the reader stopped in. */
  chapterTitle: string;
  /** Last one or two prose paragraphs, in reading order. */
  paragraphs: string[];
  /** The newest bookmark/highlight, when there is one. */
  mark: WelcomeBackMark | null;
};

export type WelcomeBackInput = {
  book: Book;
  state: BookReaderState;
  now?: number;
  /**
   * The library record's `lastOpenedAt`, used only when the reader state has no usable
   * `updatedAt` (older book states). Read it *before* `touchBookOpened` overwrites it.
   */
  lastOpenedAt?: number | null;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toArabicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit);
}

/**
 * Plain prose from a block's inline HTML: tags removed, entities decoded, whitespace
 * collapsed. Arabic tashkeel is never touched.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity, body: string) => {
      if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
      }
      const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
        mdash: '—',
        ndash: '–',
        hellip: '…',
        laquo: '«',
        raquo: '»',
      };
      return named[body.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function hasStarted(state: BookReaderState): boolean {
  return Boolean(state.anchor) || (isFiniteNumber(state.progress) && state.progress > 0);
}

/**
 * The moment the reader actually last read this book. `updatedAt` is authoritative because it
 * moves on every page turn; the library's `lastOpenedAt` is only a fallback for older states.
 * A missing, unusable or future timestamp means "we cannot tell", so no card is shown.
 */
function resolveLastReadAt(
  state: BookReaderState,
  lastOpenedAt: number | null | undefined,
  now: number,
): number | null {
  if (isFiniteNumber(state.updatedAt) && state.updatedAt > 0) {
    return state.updatedAt <= now ? state.updatedAt : null;
  }
  if (isFiniteNumber(lastOpenedAt) && lastOpenedAt > 0) {
    return lastOpenedAt <= now ? lastOpenedAt : null;
  }
  return null;
}

export function formatAwayArabic(awayMs: number): string {
  if (!Number.isFinite(awayMs) || awayMs <= 0) return 'غبت منذ فترة';
  const days = Math.floor(awayMs / DAY_MS);
  if (days < 3) return 'غبت منذ فترة';

  if (days < 14) {
    if (days >= 11) return `غبت ${toArabicDigits(days)} يومًا`;
    return `غبت ${toArabicDigits(days)} أيام`;
  }

  if (days < 60) {
    const weeks = Math.floor(days / 7);
    if (weeks === 2) return 'غبت أسبوعين';
    if (weeks <= 10) return `غبت ${toArabicDigits(weeks)} أسابيع`;
    return `غبت ${toArabicDigits(days)} يومًا`;
  }

  const months = Math.floor(days / 30);
  if (months === 1) return 'غبت شهرًا';
  if (months === 2) return 'غبت شهرين';
  if (months <= 10) return `غبت ${toArabicDigits(months)} شهور`;
  return 'غبت منذ فترة';
}

type LocatedBlock = { chapter: Chapter; block: Block };

function flattenBlocks(book: Book): LocatedBlock[] {
  const located: LocatedBlock[] = [];
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      located.push({ chapter, block });
    }
  }
  return located;
}

function findLocatedBlock(book: Book, blockId: string | undefined): LocatedBlock | null {
  if (!blockId) return null;
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      if (block.id === blockId) return { chapter, block };
    }
  }
  return null;
}

/** Truncation marker, so a cut sentence never looks like a complete one. */
const ELLIPSIS = '…';

function isProseBlock(block: Block): boolean {
  return block.kind === 'p' || block.kind === 'quote';
}

/**
 * Only the part of `text` the reader has already passed: cut at the reader's stopping point,
 * never mid-word, and marked with `…` when something was left out.
 */
function textBeforeOffset(text: string, charOffset: number): string {
  if (charOffset <= 0) return '';
  if (charOffset >= text.length) return text;

  let visible = text.slice(0, charOffset);
  const lastChar = visible.slice(-1);
  const nextChar = text.charAt(charOffset);
  // A cut in the middle of a word drops the partial word instead of showing half of it.
  if (lastChar && !/\s/.test(lastChar) && nextChar && !/\s/.test(nextChar)) {
    const withoutPartialWord = visible.replace(/\S+$/, '');
    if (withoutPartialWord.trim()) visible = withoutPartialWord;
  }
  visible = visible.trimEnd();
  return visible ? `${visible}${ELLIPSIS}` : '';
}

/**
 * The last `limit` prose blocks up to — and never past — where the reader stopped, in reading
 * order. `break`, `image` and `h2` blocks are skipped, and walking back across a chapter
 * boundary naturally continues into the previous chapter (anchor on the first block of chapter 2).
 *
 * Spoiler guard (Codex P2): a missing anchor, or an anchor block that is not in this book, means
 * we cannot tell where the reader is — so nothing is shown. Falling back to the end of the book
 * would give away the ending.
 */
export function extractRecapParagraphs(
  book: Book,
  anchor: Anchor | null | undefined,
  limit = 2,
): string[] {
  if (limit <= 0) return [];
  const blocks = flattenBlocks(book);
  if (blocks.length === 0) return [];

  const anchorIndex = anchor?.blockId
    ? blocks.findIndex((entry) => entry.block.id === anchor.blockId)
    : -1;
  if (anchorIndex < 0) return [];

  const anchorEntry = blocks[anchorIndex]!;
  const charOffset = isFiniteNumber(anchor?.charOffset)
    ? Math.max(0, Math.trunc(anchor.charOffset))
    : 0;

  const paragraphs: string[] = [];
  let index = anchorIndex;
  if (charOffset > 0 && isProseBlock(anchorEntry.block)) {
    const partial = textBeforeOffset(stripHtml(anchorEntry.block.html), charOffset);
    if (partial) paragraphs.push(partial);
    index = anchorIndex - 1;
  }

  // With `charOffset === 0` the reader is at the very start of the anchor block, so that block
  // is already on screen and safe to include as the last line of the recap.
  for (; index >= 0 && paragraphs.length < limit; index -= 1) {
    const entry = blocks[index];
    if (!entry) continue;
    if (!isProseBlock(entry.block)) continue;
    const text = stripHtml(entry.block.html);
    if (!text) continue;
    paragraphs.push(text);
  }
  return paragraphs.reverse();
}

/**
 * The newest item across bookmarks and highlights, compared by `createdAt`. A highlight
 * carrying a note is labelled «آخر ملاحظة»; a bare highlight is «آخر اقتباس».
 */
export function pickLatestMark(state: BookReaderState): WelcomeBackMark | null {
  const candidates: Array<{ mark: WelcomeBackMark; createdAt: number }> = [];

  for (const item of state.bookmarkItems ?? []) {
    if (!item) continue;
    const quote = isNonEmptyText(item.quote) ? item.quote.trim() : '';
    if (!quote) continue;
    candidates.push({
      mark: {
        kind: 'bookmark',
        label: 'آخر علامة',
        quote,
        ...(isNonEmptyText(item.chapterTitle) ? { chapterTitle: item.chapterTitle } : {}),
      },
      createdAt: isFiniteNumber(item.createdAt) ? item.createdAt : 0,
    });
  }

  for (const item of state.highlights ?? []) {
    if (!item) continue;
    const quote = isNonEmptyText(item.quote) ? item.quote.trim() : '';
    const note = isNonEmptyText(item.note) ? item.note.trim() : undefined;
    if (!quote && !note) continue;
    candidates.push({
      mark: {
        kind: note ? 'note' : 'highlight',
        label: note ? 'آخر ملاحظة' : 'آخر اقتباس',
        quote,
        ...(note ? { note } : {}),
        ...(isNonEmptyText(item.chapterTitle) ? { chapterTitle: item.chapterTitle } : {}),
      },
      createdAt: isFiniteNumber(item.createdAt) ? item.createdAt : 0,
    });
  }

  const first = candidates[0];
  if (!first) return null;
  let best = first;
  for (const candidate of candidates) {
    if (candidate.createdAt >= best.createdAt) best = candidate;
  }
  return best.mark;
}

/**
 * Builds the whole recap, or `null` when the card must not be shown. Eligibility is decided
 * here so the screen never has to duplicate the three-day rule.
 */
export function buildWelcomeBackRecap({
  book,
  state,
  now = Date.now(),
  lastOpenedAt,
}: WelcomeBackInput): WelcomeBackRecap | null {
  if (!hasStarted(state)) return null;

  const lastReadAt = resolveLastReadAt(state, lastOpenedAt, now);
  if (lastReadAt === null) return null;

  const awayMs = now - lastReadAt;
  if (!(awayMs > WELCOME_BACK_THRESHOLD_MS)) return null;

  const located = findLocatedBlock(book, state.anchor?.blockId);
  const chapterTitle =
    located?.chapter.title ??
    book.chapters.find((chapter) => chapter.id === state.chapterId)?.title ??
    book.meta.title;

  return {
    awayMs,
    awayLabel: formatAwayArabic(awayMs),
    chapterTitle,
    paragraphs: extractRecapParagraphs(book, state.anchor, 2),
    mark: pickLatestMark(state),
  };
}
