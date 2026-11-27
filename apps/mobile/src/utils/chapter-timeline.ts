import type { HighlightColor } from '@/types/reader';

/**
 * F29 — weighted chapter timeline.
 *
 * Pure math and mapping only: no React, no layout reads, no I/O. The scrubber draws one track, and
 * this module decides where every chapter boundary, bookmark, highlight and tooltip line sits. Every
 * ratio here is reading progress (0 = first word of the book, 1 = last). The physical mirroring for
 * RTL happens at the very end, in `ratioToPhysicalX`, so the gesture math in `PageScrubber` keeps
 * working in physical LTR coordinates.
 */

/** Smallest share of the track a chapter can own, so an empty chapter stays visible and tappable. */
export const MAX_CHAPTER_WEIGHT_FLOOR = 0.02;

/** The tooltip preview is one clean line: ~45 Arabic characters then an ellipsis. */
export const PREVIEW_MAX_CHARS = 45;

export type TimelineChapterInput = {
  id: string;
  title: string;
  wordCount: number;
  /** Block ids in reading order — used to place a bookmark/highlight inside the chapter. */
  blockIds?: readonly string[];
  /**
   * Plain-text length of each block, aligned with `blockIds`. When present, a marker's position
   * inside the chapter is measured by cumulative text length (long paragraph = more of the
   * chapter's share) instead of by block count. Missing/short arrays fall back to block count.
   */
  blockTextLengths?: readonly number[];
  /** Page where the chapter starts, when the engine has measured the TOC. */
  startPage?: number;
  /** Pages the chapter spans, when the engine has measured the TOC. */
  pageCount?: number;
  /** First line of the chapter (plain text or the block's inline HTML — both are handled). */
  preview?: string;
};

export type ChapterSegment = {
  id: string;
  title: string;
  index: number;
  wordCount: number;
  /** Share of the track, always > 0 and summing to exactly 1 across the segments. */
  weight: number;
  /** Reading-progress ratio where the segment starts. */
  startRatio: number;
  /** Reading-progress ratio where the segment ends. */
  endRatio: number;
};

export type TimelineTick = {
  /** Index of the chapter that ends at this divider. */
  index: number;
  /** Reading-progress ratio of the boundary. */
  ratio: number;
  /** Physical x ratio (0 = left edge, 1 = right edge) after applying `dir`. */
  x: number;
};

export type TimelineMarkerKind = 'bookmark' | 'highlight';

export type TimelineMarker = {
  id: string;
  kind: TimelineMarkerKind;
  /** Reading-progress ratio of the marker. */
  ratio: number;
  chapterId: string;
  /** Highlight colour (highlights only). */
  color?: HighlightColor;
};

/** Anything that carries an id, a chapter and an optional text anchor. */
export type TimelineMarkerSource = {
  id: string;
  chapterId?: string;
  anchor?: { blockId?: string; charOffset?: number } | null;
  color?: HighlightColor;
};

export type ScrubTooltip = {
  chapterId: string;
  chapterTitle: string;
  page: number;
  preview: string;
};

type BuildOptions = {
  /** Override the floor (clamped to `1 / chapterCount`). Exposed for tests and tuning. */
  minWeight?: number;
};

function clamp01(value: number): number {
  'worklet';
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function sanitizeWordCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Distribute a budget of 1 across chapters in proportion to their word counts, while guaranteeing
 * that no chapter falls below `floor`. Chapters are only floored when they would otherwise be
 * invisible; the rest share the remaining budget proportionally (water filling), so the weights
 * always sum to exactly 1 — never NaN, never a divide-by-zero.
 */
function distributeWeights(counts: readonly number[], floor: number): number[] {
  const count = counts.length;
  const total = counts.reduce((sum, value) => sum + value, 0);
  const raw = total > 0 ? counts.map((value) => value / total) : counts.map(() => 1 / count);

  const weights = new Array<number>(count).fill(0);
  let active = counts.map((_, index) => index);
  let remaining = 1;
  let rawSumActive = 1;
  let guard = 0;

  while (active.length > 0 && guard <= count + 1) {
    guard += 1;
    const below = active.filter((index) => {
      const share = rawSumActive > 0 ? (raw[index]! / rawSumActive) * remaining : 0;
      return share < floor - 1e-12;
    });

    if (below.length === 0) {
      for (const index of active) {
        weights[index] = rawSumActive > 0 ? (raw[index]! / rawSumActive) * remaining : remaining / active.length;
      }
      remaining = 0;
      active = [];
      break;
    }

    for (const index of below) {
      weights[index] = floor;
      remaining -= floor;
      rawSumActive -= raw[index]!;
    }
    active = active.filter((index) => !below.includes(index));
    if (remaining <= 1e-12) remaining = 0;
  }

  // Degenerate case: every chapter was floored but the floor did not consume the whole budget.
  // Spread the leftover equally rather than leaving the track short of 1.
  if (remaining > 1e-12) {
    const add = remaining / count;
    for (let index = 0; index < count; index += 1) weights[index]! += add;
  }

  return weights;
}

export function buildChapterTimeline(
  chapters: readonly TimelineChapterInput[],
  options: BuildOptions = {},
): ChapterSegment[] {
  const count = chapters.length;
  if (count === 0) return [];

  const counts = chapters.map((chapter) => sanitizeWordCount(chapter.wordCount));
  const requestedFloor = Number.isFinite(options.minWeight)
    ? Math.max(0, options.minWeight as number)
    : MAX_CHAPTER_WEIGHT_FLOOR;
  // A floor above 1/count is impossible to satisfy for every chapter at once, so cap it there.
  const floor = Math.min(requestedFloor, 1 / count);
  const weights = distributeWeights(counts, floor);

  const segments: ChapterSegment[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const chapter = chapters[index]!;
    const isLast = index === count - 1;
    const startRatio = cursor;
    const endRatio = isLast ? 1 : cursor + (weights[index] ?? 0);
    segments.push({
      id: chapter.id,
      title: chapter.title,
      index,
      wordCount: chapter.wordCount,
      weight: isLast ? 1 - startRatio : (weights[index] ?? 0),
      startRatio,
      endRatio: isLast ? 1 : endRatio,
    });
    cursor = endRatio;
  }

  return segments;
}

/** Physical x ratio (0 = left edge, 1 = right edge) for a reading-progress ratio. */
export function ratioToPhysicalX(ratio: number, dir: 'rtl' | 'ltr'): number {
  'worklet';
  const clamped = clamp01(ratio);
  return dir === 'rtl' ? 1 - clamped : clamped;
}

/** Reading-progress ratio for a physical x ratio — the inverse of `ratioToPhysicalX`. */
export function physicalXToRatio(x: number, dir: 'rtl' | 'ltr'): number {
  'worklet';
  const clamped = clamp01(x);
  return dir === 'rtl' ? 1 - clamped : clamped;
}

/** One chapter's share of the rail plus the page range it owns, for page <-> ratio mapping. */
export type TimelinePageSpan = {
  startRatio: number;
  endRatio: number;
  /** First page of the chapter (1-based). */
  startPage: number;
  /** How many whole pages the chapter's share covers; 0 when the share is thinner than one page. */
  span: number;
};

/**
 * Lays the chapter page ranges on the SAME weighted segments the ticks and markers are drawn from.
 *
 * This is the invariant that kills the reported mismatch: the page where chapter *i* starts is
 * exactly the page reached by tapping/stopping at chapter *i*'s divider, and the thumb for that
 * page sits exactly on the divider. One mapping, one rail.
 */
export function buildPageScale(
  segments: readonly ChapterSegment[],
  pageCount: number,
): TimelinePageSpan[] {
  const count = segments.length;
  if (count === 0) return [];
  const total = Number.isFinite(pageCount) ? Math.max(1, Math.floor(pageCount)) : 1;

  // Boundary page of every chapter, monotonically non-decreasing and clamped to the book.
  const boundaries: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      boundaries.push(1);
      continue;
    }
    const segment = segments[index]!;
    const raw = 1 + segment.startRatio * (total - 1);
    const previous = boundaries[index - 1]!;
    boundaries.push(Math.max(previous, Math.min(total, Math.round(raw))));
  }

  return segments.map((segment, index) => {
    const startPage = boundaries[index]!;
    // The last chapter ends on the last page, whatever rounding did to the boundary before it.
    const endPage = index === count - 1 ? total : boundaries[index + 1]!;
    return {
      startRatio: segment.startRatio,
      endRatio: segment.endRatio,
      startPage,
      span: Math.max(0, endPage - startPage),
    };
  });
}

/** Weighted segment + offset -> page. The inverse of `pageToRatioInScale`. */
export function ratioToPageInScale(
  spans: readonly TimelinePageSpan[],
  ratio: number,
  pageCount: number,
): number {
  'worklet';
  const total = Number.isFinite(pageCount) ? Math.max(1, Math.floor(pageCount)) : 1;
  if (total <= 1) return 1;

  if (spans.length === 0) {
    // Fallback: one chapter (or none) means the rail is simply linear over the pages.
    return Math.max(1, Math.min(total, Math.round(1 + clamp01(ratio) * (total - 1))));
  }

  const clamped = clamp01(ratio);
  let index = spans.length - 1;
  for (let candidate = 0; candidate < spans.length; candidate += 1) {
    if (clamped < spans[candidate]!.endRatio || candidate === spans.length - 1) {
      index = candidate;
      break;
    }
  }

  const span = spans[index]!;
  if (span.span <= 0) return Math.max(1, Math.min(total, span.startPage));
  const width = span.endRatio - span.startRatio;
  const local = width > 0 ? (clamped - span.startRatio) / width : 0;
  return Math.max(1, Math.min(total, Math.round(span.startPage + local * span.span)));
}

/** Page -> weighted segment + offset, returning a reading-progress ratio (0..1). */
export function pageToRatioInScale(
  spans: readonly TimelinePageSpan[],
  page: number,
  pageCount: number,
): number {
  'worklet';
  const total = Number.isFinite(pageCount) ? Math.max(1, Math.floor(pageCount)) : 1;
  // A one-page book has no range: the thumb parks at the reading end, as it always did.
  if (total <= 1) return 1;

  if (spans.length === 0) {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.min(total, page)) : 1;
    return clamp01((safePage - 1) / (total - 1));
  }

  const safePage = Number.isFinite(page) ? Math.max(1, Math.min(total, page)) : 1;
  let index = spans.length - 1;
  for (let candidate = 0; candidate < spans.length; candidate += 1) {
    const span = spans[candidate]!;
    const isLast = candidate === spans.length - 1;
    if (safePage < span.startPage + span.span || isLast) {
      index = candidate;
      break;
    }
  }

  const span = spans[index]!;
  const local = span.span > 0 ? (safePage - span.startPage) / span.span : 0;
  return clamp01(span.startRatio + local * (span.endRatio - span.startRatio));
}

/** One divider per boundary between two chapters, in physical coordinates. */
export function segmentsToTicks(
  segments: readonly ChapterSegment[],
  dir: 'rtl' | 'ltr',
): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const ratio = clamp01(segments[index]!.startRatio);
    ticks.push({ index: index - 1, ratio, x: ratioToPhysicalX(ratio, dir) });
  }
  return ticks;
}

/** The chapter whose span contains a reading-progress ratio (last chapter owns ratio 1). */
export function chapterAtRatio(
  segments: readonly ChapterSegment[],
  ratio: number,
): ChapterSegment | null {
  if (segments.length === 0) return null;
  const clamped = clamp01(ratio);
  for (const segment of segments) {
    if (clamped >= segment.startRatio && clamped < segment.endRatio) return segment;
  }
  return segments[segments.length - 1] ?? null;
}

function segmentForChapter(
  chapters: readonly TimelineChapterInput[],
  segments: readonly ChapterSegment[],
  chapterId: string | undefined,
): { chapter: TimelineChapterInput; segment: ChapterSegment } | null {
  if (!chapterId) return null;
  const chapterIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  if (chapterIndex < 0) return null;
  const chapter = chapters[chapterIndex]!;
  const segment =
    segments.find((candidate) => candidate.id === chapterId) ?? segments[chapterIndex];
  if (!segment) return null;
  return { chapter, segment };
}

function sanitizeTextLength(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function markerRatio(
  chapters: readonly TimelineChapterInput[],
  segments: readonly ChapterSegment[],
  source: TimelineMarkerSource,
): number | null {
  const found = segmentForChapter(chapters, segments, source.chapterId);
  if (!found) return null;

  const span = found.segment.endRatio - found.segment.startRatio;
  const atChapterStart = (): number => clamp01(found.segment.startRatio);

  const blockId = source.anchor?.blockId;
  const blockIds = found.chapter.blockIds ?? [];
  const blockIndex = blockId ? blockIds.indexOf(blockId) : -1;
  // Unknown block (a reflowed book) or no anchor at all: the chapter start is the honest fallback.
  if (blockIndex < 0 || blockIds.length === 0) return atChapterStart();

  const lengths = found.chapter.blockTextLengths ?? [];
  const measured = lengths.length === blockIds.length;

  let localRatio: number;
  if (!measured) {
    // No text metric: block position is the only signal, exactly as before.
    localRatio = blockIndex / blockIds.length;
  } else {
    // Why (Codex #54 P3): block index alone says a 5-line paragraph takes as much of the chapter as
    // a two-page one. Measure the offset in characters instead, then add the anchor's char offset.
    let totalLength = 0;
    let prefixLength = 0;
    for (let index = 0; index < blockIds.length; index += 1) {
      const length = sanitizeTextLength(lengths[index]);
      if (index < blockIndex) prefixLength += length;
      totalLength += length;
    }

    if (totalLength > 0) {
      const blockLength = sanitizeTextLength(lengths[blockIndex]);
      const rawOffset = source.anchor?.charOffset;
      const charOffset =
        typeof rawOffset === 'number' && Number.isFinite(rawOffset) && rawOffset > 0
          ? Math.min(rawOffset, blockLength)
          : 0;
      localRatio = (prefixLength + charOffset) / totalLength;
    } else {
      localRatio = blockIndex / blockIds.length;
    }
  }

  return clamp01(found.segment.startRatio + span * localRatio);
}

export function mapBookmarks(
  chapters: readonly TimelineChapterInput[],
  segments: readonly ChapterSegment[],
  bookmarks: readonly TimelineMarkerSource[],
): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  for (const bookmark of bookmarks) {
    const ratio = markerRatio(chapters, segments, bookmark);
    if (ratio === null) continue;
    markers.push({
      id: bookmark.id,
      kind: 'bookmark',
      ratio,
      chapterId: bookmark.chapterId as string,
    });
  }
  return markers;
}

export function mapHighlights(
  chapters: readonly TimelineChapterInput[],
  segments: readonly ChapterSegment[],
  highlights: readonly TimelineMarkerSource[],
): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  for (const highlight of highlights) {
    const ratio = markerRatio(chapters, segments, highlight);
    if (ratio === null) continue;
    markers.push({
      id: highlight.id,
      kind: 'highlight',
      ratio,
      chapterId: highlight.chapterId as string,
      ...(highlight.color ? { color: highlight.color } : {}),
    });
  }
  return markers;
}

/**
 * Named HTML entities we decode. Anything not listed is decoded generically when it is a numeric
 * reference; unknown named references are left verbatim rather than silently deleted.
 */
const HTML_NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  zwj: '',
  zwnj: '',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  divide: '÷',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
};

/**
 * Matches real HTML tags only: a tag name must start with an ASCII letter (comments too). This is
 * what keeps ordinary text inside angle brackets such as `<تنبيه>` intact — the old `<[^>]*>` ate
 * any bracketed run, including Arabic prose.
 */
const HTML_TAG_PATTERN = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s[^<>]*?)?\/?>/g;

/** Decodes named, decimal (`&#169;`) and hexadecimal (`&#x627;`) character references in one pass. */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const digits = body.slice(isHex ? 2 : 1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      // Lone surrogates are not valid characters; keep the reference instead of emitting garbage.
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return HTML_NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Plain text of inline HTML: real tags dropped, every entity decoded, whitespace collapsed.
 *
 * Idempotent on purpose — running it twice never removes more text than running it once, so a
 * preview that was already sanitised by `firstLinePreview` survives a second pass untouched.
 */
export function stripHtmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(HTML_TAG_PATTERN, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export type TimelineChapterPreviewSource = {
  blocks?: readonly { id?: string; kind?: string; html?: string }[];
};

/** First block of the chapter that carries text, as plain text (never raw HTML). */
export function firstLinePreview(chapter: TimelineChapterPreviewSource | undefined): string {
  if (!chapter?.blocks) return '';
  for (const block of chapter.blocks) {
    const text = stripHtmlToText(block.html);
    if (text) return text;
  }
  return '';
}

export const chapterFirstLine = firstLinePreview;

/**
 * One clean line for the drag tooltip: cut at `max` characters and add an ellipsis. Arabic letters
 * are never reshaped or isolated here — the string is only sliced, so shaping stays with the font.
 */
export function truncatePreview(text: string | null | undefined, max = PREVIEW_MAX_CHARS): string {
  if (!text) return '';
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * Everything the drag tooltip shows for a candidate page: the chapter it falls in, the page number
 * itself, and the chapter's first line as clean truncated text. Safe for any page value.
 *
 * `segments` and `previews` let a caller reuse the timeline it already built for the rail: the drag
 * path must not rebuild chapter weights or re-run HTML cleanup on every tick.
 */
export function resolveScrubTooltip(input: {
  chapters: readonly TimelineChapterInput[];
  page: number;
  pageCount: number;
  segments?: readonly ChapterSegment[];
  previews?: ReadonlyMap<string, string>;
}): ScrubTooltip {
  const safePageCount = Number.isFinite(input.pageCount) ? Math.max(1, Math.floor(input.pageCount)) : 1;
  const rawPage = Number.isFinite(input.page) ? Math.round(input.page) : 1;
  const page = Math.max(1, Math.min(safePageCount, rawPage));

  if (input.chapters.length === 0) {
    return { chapterId: '', chapterTitle: '', page, preview: '' };
  }

  // Why (Codex #54 P1): resolve the chapter from the SAME weighted scale the rail, ticks and
  // markers are drawn from, so the tooltip can never name a chapter the thumb is not inside.
  const segments = input.segments ?? buildChapterTimeline(input.chapters);
  const scale = buildPageScale(segments, safePageCount);
  const segment = chapterAtRatio(segments, pageToRatioInScale(scale, page, safePageCount));
  const chapter = segment ? input.chapters.find((candidate) => candidate.id === segment.id) ?? null : null;
  if (!chapter) {
    return { chapterId: '', chapterTitle: '', page, preview: '' };
  }

  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    page,
    preview: input.previews?.get(chapter.id) ?? truncatePreview(stripHtmlToText(chapter.preview)),
  };
}
