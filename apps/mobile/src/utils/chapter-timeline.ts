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
  const clamped = clamp01(ratio);
  return dir === 'rtl' ? 1 - clamped : clamped;
}

/** Reading-progress ratio for a physical x ratio — the inverse of `ratioToPhysicalX`. */
export function physicalXToRatio(x: number, dir: 'rtl' | 'ltr'): number {
  const clamped = clamp01(x);
  return dir === 'rtl' ? 1 - clamped : clamped;
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

function markerRatio(
  chapters: readonly TimelineChapterInput[],
  segments: readonly ChapterSegment[],
  source: TimelineMarkerSource,
): number | null {
  const found = segmentForChapter(chapters, segments, source.chapterId);
  if (!found) return null;

  const blockId = source.anchor?.blockId;
  const blockIds = found.chapter.blockIds ?? [];
  const blockIndex = blockId ? blockIds.indexOf(blockId) : -1;
  // Unknown block (a reflowed book) or no anchor at all: the chapter start is the honest fallback.
  const localRatio = blockIndex >= 0 && blockIds.length > 0 ? blockIndex / blockIds.length : 0;
  const span = found.segment.endRatio - found.segment.startRatio;
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

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Plain text of inline HTML: tags dropped, entities decoded, whitespace collapsed. */
export function stripHtmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITY_MAP[entity] ?? entity)
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

function chapterForPage(
  chapters: readonly TimelineChapterInput[],
  segments: readonly ChapterSegment[],
  page: number,
  pageCount: number,
): TimelineChapterInput | null {
  const measured = chapters.filter(
    (chapter) =>
      typeof chapter.startPage === 'number' &&
      Number.isFinite(chapter.startPage) &&
      typeof chapter.pageCount === 'number' &&
      Number.isFinite(chapter.pageCount) &&
      chapter.pageCount > 0,
  );
  if (measured.length > 0) {
    const exact = measured.find(
      (chapter) => page >= chapter.startPage! && page < chapter.startPage! + chapter.pageCount!,
    );
    if (exact) return exact;
    // A page past every measured range belongs to the last measured chapter.
    if (page >= measured[measured.length - 1]!.startPage!) return measured[measured.length - 1]!;
    return measured[0]!;
  }

  // The engine has not measured the TOC yet: fall back to the word-weighted spans.
  const progress = pageCount <= 1 ? 1 : (page - 1) / (pageCount - 1);
  const segment = chapterAtRatio(segments, progress);
  if (!segment) return null;
  return chapters.find((chapter) => chapter.id === segment.id) ?? null;
}

/**
 * Everything the drag tooltip shows for a candidate page: the chapter it falls in, the page number
 * itself, and the chapter's first line as clean truncated text. Safe for any page value.
 */
export function resolveScrubTooltip(input: {
  chapters: readonly TimelineChapterInput[];
  page: number;
  pageCount: number;
}): ScrubTooltip {
  const safePageCount = Number.isFinite(input.pageCount) ? Math.max(1, Math.floor(input.pageCount)) : 1;
  const rawPage = Number.isFinite(input.page) ? Math.round(input.page) : 1;
  const page = Math.max(1, Math.min(safePageCount, rawPage));

  if (input.chapters.length === 0) {
    return { chapterId: '', chapterTitle: '', page, preview: '' };
  }

  const segments = buildChapterTimeline(input.chapters);
  const chapter = chapterForPage(input.chapters, segments, page, safePageCount);
  if (!chapter) {
    return { chapterId: '', chapterTitle: '', page, preview: '' };
  }

  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    page,
    preview: truncatePreview(stripHtmlToText(chapter.preview)),
  };
}
