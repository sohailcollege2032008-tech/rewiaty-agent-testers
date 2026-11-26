import {
  buildChapterTimeline,
  chapterAtRatio,
  chapterFirstLine,
  firstLinePreview,
  mapBookmarks,
  mapHighlights,
  MAX_CHAPTER_WEIGHT_FLOOR,
  ratioToPhysicalX,
  resolveScrubTooltip,
  segmentsToTicks,
  truncatePreview,
  type TimelineChapterInput,
} from '@/utils/chapter-timeline';

function chapter(
  id: string,
  wordCount: number,
  overrides: Partial<TimelineChapterInput> = {},
): TimelineChapterInput {
  return { id, title: `فصل ${id}`, wordCount, ...overrides };
}

describe('buildChapterTimeline — weighted chapter segments', () => {
  it('weights each chapter by word count and sums to exactly 1', () => {
    const segments = buildChapterTimeline([chapter('ch01', 1000), chapter('ch02', 3000)]);

    expect(segments.map((s) => s.weight)).toEqual([0.25, 0.75]);
    expect(segments[0]!.startRatio).toBe(0);
    expect(segments[0]!.endRatio).toBe(0.25);
    expect(segments[1]!.startRatio).toBe(0.25);
    expect(segments[1]!.endRatio).toBe(1);

    const total = segments.reduce((sum, s) => sum + s.weight, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(segments.at(-1)!.endRatio).toBe(1);
  });

  it('keeps a zero-word chapter visible with the floor weight instead of collapsing it', () => {
    const segments = buildChapterTimeline([chapter('ch01', 5000), chapter('ch02', 0)]);

    const empty = segments[1]!;
    expect(empty.weight).toBeGreaterThan(0);
    expect(empty.weight).toBeGreaterThanOrEqual(MAX_CHAPTER_WEIGHT_FLOOR);
    // The floor is paid by the heavy chapter, never by a running total above 1.
    expect(segments[0]!.weight).toBeCloseTo(0.98, 10);
    expect(segments.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1, 10);
  });

  it('never lets the floor push the total over 1 when every chapter is tiny', () => {
    const segments = buildChapterTimeline([
      chapter('ch01', 0),
      chapter('ch02', 0),
      chapter('ch03', 0),
      chapter('ch04', 0),
    ]);

    expect(segments).toHaveLength(4);
    expect(segments.map((s) => s.weight)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(segments.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1, 10);
    for (const segment of segments) {
      expect(Number.isFinite(segment.startRatio)).toBe(true);
      expect(Number.isFinite(segment.endRatio)).toBe(true);
    }
  });

  it('handles a single chapter as the whole track', () => {
    const segments = buildChapterTimeline([chapter('only', 1200)]);
    expect(segments).toEqual([
      expect.objectContaining({ id: 'only', weight: 1, startRatio: 0, endRatio: 1 }),
    ]);
  });

  it('handles an empty book without NaN or divide-by-zero', () => {
    expect(buildChapterTimeline([])).toEqual([]);
  });

  it('survives negative and non-finite word counts', () => {
    const segments = buildChapterTimeline([
      chapter('ch01', -50),
      chapter('ch02', Number.NaN),
      chapter('ch03', 900),
    ]);
    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(Number.isFinite(segment.weight)).toBe(true);
      expect(segment.weight).toBeGreaterThan(0);
    }
    expect(segments.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(1, 10);
  });
});

describe('physical mapping — RTL grows right-to-left', () => {
  const chapters = [chapter('ch01', 1000), chapter('ch02', 3000)];

  it('puts chapter 1 at the physical right and the last chapter at the physical left in RTL', () => {
    const segments = buildChapterTimeline(chapters);
    const first = segments[0]!;
    const last = segments[1]!;

    expect(ratioToPhysicalX(first.startRatio, 'rtl')).toBe(1);
    expect(ratioToPhysicalX(last.endRatio, 'rtl')).toBe(0);
    expect(ratioToPhysicalX(first.startRatio, 'rtl')).toBeGreaterThan(0.5);
    expect(ratioToPhysicalX(last.endRatio, 'rtl')).toBeLessThan(0.5);
  });

  it('mirrors the mapping in LTR', () => {
    const segments = buildChapterTimeline(chapters);
    expect(ratioToPhysicalX(segments[0]!.startRatio, 'ltr')).toBe(0);
    expect(ratioToPhysicalX(segments[1]!.endRatio, 'ltr')).toBe(1);
  });

  it('places tick dividers on the shared chapter boundaries in both directions', () => {
    const segments = buildChapterTimeline([
      chapter('ch01', 1000),
      chapter('ch02', 1000),
      chapter('ch03', 2000),
    ]);

    const rtlTicks = segmentsToTicks(segments, 'rtl');
    expect(rtlTicks).toEqual([
      { index: 0, ratio: 0.25, x: 0.75 },
      { index: 1, ratio: 0.5, x: 0.5 },
    ]);

    const ltrTicks = segmentsToTicks(segments, 'ltr');
    expect(ltrTicks).toEqual([
      { index: 0, ratio: 0.25, x: 0.25 },
      { index: 1, ratio: 0.5, x: 0.5 },
    ]);
  });

  it('draws no dividers for a single chapter', () => {
    expect(segmentsToTicks(buildChapterTimeline([chapter('only', 10)]), 'rtl')).toEqual([]);
  });
});

describe('bookmark & highlight markers', () => {
  const chapters = [
    chapter('ch01', 1000, { blockIds: ['c1_p1', 'c1_p2'] }),
    chapter('ch02', 3000, { blockIds: ['c2_p1', 'c2_p2', 'c2_p3', 'c2_p4'] }),
  ];

  it('maps a bookmark to its block position inside its chapter', () => {
    const segments = buildChapterTimeline(chapters);
    const markers = mapBookmarks(chapters, segments, [
      {
        id: 'bm-1',
        chapterId: 'ch02',
        anchor: { blockId: 'c2_p3', charOffset: 0 },
      },
    ]);

    expect(markers).toHaveLength(1);
    // ch02 spans 0.25..1; block index 2 of 4 -> a quarter into that span.
    expect(markers[0]!.ratio).toBeCloseTo(0.25 + 0.75 * 0.5, 10);
    expect(markers[0]!.kind).toBe('bookmark');
    expect(markers[0]!.id).toBe('bm-1');
  });

  it('falls back to the chapter start when the block is unknown', () => {
    const segments = buildChapterTimeline(chapters);
    const markers = mapBookmarks(chapters, segments, [
      { id: 'bm-2', chapterId: 'ch02', anchor: { blockId: 'nope', charOffset: 4 } },
    ]);
    expect(markers[0]!.ratio).toBeCloseTo(0.25, 10);
  });

  it('falls back to the chapter start when the anchor is missing entirely', () => {
    const segments = buildChapterTimeline(chapters);
    const markers = mapBookmarks(chapters, segments, [
      { id: 'bm-3', chapterId: 'ch01' } as never,
    ]);
    expect(markers[0]!.ratio).toBe(0);
  });

  it('maps highlights with their colour and keeps bookmark/highlight ids separate', () => {
    const segments = buildChapterTimeline(chapters);
    const highlights = mapHighlights(chapters, segments, [
      {
        id: 'hl-1',
        chapterId: 'ch01',
        color: 'gold',
        anchor: { blockId: 'c1_p2', charOffset: 3 },
      },
      {
        id: 'hl-2',
        chapterId: 'ch02',
        color: 'sky',
        anchor: { blockId: 'c2_p1', charOffset: 0 },
      },
    ]);

    expect(highlights.map((m) => m.kind)).toEqual(['highlight', 'highlight']);
    expect(highlights.map((m) => m.color)).toEqual(['gold', 'sky']);
    expect(highlights[0]!.ratio).toBeCloseTo(0.25 * 0.5, 10);
    expect(highlights[1]!.ratio).toBeCloseTo(0.25, 10);
  });

  it('ignores markers from chapters that are not on this timeline', () => {
    const segments = buildChapterTimeline(chapters);
    const markers = mapBookmarks(chapters, segments, [
      { id: 'bm-x', chapterId: 'footnote:1', anchor: { blockId: 'x', charOffset: 0 } },
    ]);
    expect(markers).toEqual([]);
  });

  it('converts each marker ratio to a physical x that a dot can be drawn at', () => {
    const segments = buildChapterTimeline(chapters);
    const [marker] = mapHighlights(chapters, segments, [
      {
        id: 'hl-3',
        chapterId: 'ch02',
        color: 'rose',
        anchor: { blockId: 'c2_p1', charOffset: 0 },
      },
    ]);

    expect(ratioToPhysicalX(marker!.ratio, 'rtl')).toBeCloseTo(0.75, 10);
    expect(ratioToPhysicalX(marker!.ratio, 'ltr')).toBeCloseTo(0.25, 10);
  });
});

describe('chapterAtRatio', () => {
  const segments = buildChapterTimeline([
    chapter('ch01', 1000),
    chapter('ch02', 2000),
    chapter('ch03', 1000),
  ]);

  it('resolves the chapter under a progress ratio, including the boundaries', () => {
    expect(chapterAtRatio(segments, 0)?.id).toBe('ch01');
    expect(chapterAtRatio(segments, 0.25)?.id).toBe('ch02');
    expect(chapterAtRatio(segments, 0.7499)?.id).toBe('ch02');
    expect(chapterAtRatio(segments, 1)?.id).toBe('ch03');
  });

  it('clamps ratios outside 0..1 and survives an empty timeline', () => {
    expect(chapterAtRatio(segments, -3)?.id).toBe('ch01');
    expect(chapterAtRatio(segments, 9)?.id).toBe('ch03');
    expect(chapterAtRatio([], 0.5)).toBeNull();
  });
});

describe('plain-text previews', () => {
  it('strips HTML tags and decodes entities instead of leaking raw markup', () => {
    const preview = firstLinePreview({
      blocks: [
        { id: 'p1', kind: 'p', html: '<p>فتح الباب <b>بهدوء</b> &amp; نظر</p>' },
      ],
    });
    expect(preview).toBe('فتح الباب بهدوء & نظر');
    expect(preview).not.toContain('<');
  });

  it('skips empty scaffolding blocks and takes the first line that has text', () => {
    const preview = firstLinePreview({
      blocks: [
        { id: 'br', kind: 'break', html: '<br/>' },
        { id: 'img', kind: 'image', html: '<img src="a.png"/>' },
        { id: 'p1', kind: 'p', html: '  <p>أول سطر حقيقي</p>  ' },
        { id: 'p2', kind: 'p', html: '<p>سطر تاني</p>' },
      ],
    });
    expect(preview).toBe('أول سطر حقيقي');
    expect(chapterFirstLine({ blocks: [{ id: 'p', kind: 'p', html: '<i>مائل</i>' }] })).toBe('مائل');
    expect(firstLinePreview({ blocks: [] })).toBe('');
    expect(firstLinePreview(undefined)).toBe('');
  });

  it('truncates long previews cleanly with an ellipsis and never breaks Arabic shaping', () => {
    const long = 'ا'.repeat(80);
    const short = truncatePreview(long, 45);
    expect(short).toBe(`${'ا'.repeat(45)}…`);
    expect(short).toHaveLength(46);
    // A line that already fits is returned untouched — no ellipsis, no reshaped letters.
    expect(truncatePreview('سطر قصير', 45)).toBe('سطر قصير');
    // Arabic diacritics are ordinary characters here: nothing is stripped or reordered.
    const tashkeel = 'حَجَرُ الْمَاءِ';
    expect(truncatePreview(tashkeel, 45)).toBe(tashkeel);
  });

  it('never returns undefined text', () => {
    expect(truncatePreview('')).toBe('');
    expect(truncatePreview(undefined as unknown as string)).toBe('');
  });
});

describe('resolveScrubTooltip — the rich drag tooltip', () => {
  const chapters = [
    chapter('ch01', 1000, {
      title: 'حَجَرُ الْمَاءِ',
      preview: '<p>كان النهر هادئاً في أول الليل</p>',
      startPage: 1,
      pageCount: 25,
    }),
    chapter('ch02', 3000, {
      title: 'الفصل الثاني',
      preview: 'ثم جاءت الريح',
      startPage: 26,
      pageCount: 75,
    }),
  ];

  it('resolves chapter title, page number and a stripped first line for a target page', () => {
    const tooltip = resolveScrubTooltip({ chapters, page: 70, pageCount: 100 });

    expect(tooltip).toEqual({
      chapterId: 'ch02',
      chapterTitle: 'الفصل الثاني',
      page: 70,
      preview: 'ثم جاءت الريح',
    });
  });

  it('strips HTML from a raw first-line preview and truncates it to ~45 characters', () => {
    const tooltip = resolveScrubTooltip({ chapters, page: 3, pageCount: 100 });
    expect(tooltip.chapterTitle).toBe('حَجَرُ الْمَاءِ');
    expect(tooltip.preview).toBe('كان النهر هادئاً في أول الليل');
    expect(tooltip.preview).not.toContain('<');
    expect(tooltip.page).toBe(3);
  });

  it('uses word-weighted spans when the engine has not measured page ranges yet', () => {
    const unmeasured = [
      chapter('ch01', 1000, { title: 'الأول', preview: 'بداية' }),
      chapter('ch02', 3000, { title: 'الثاني', preview: 'نهاية' }),
    ];
    // 100 pages: pages 1..25 are ch01, 26..100 are ch02 by weight.
    expect(resolveScrubTooltip({ chapters: unmeasured, page: 24, pageCount: 100 }).chapterId).toBe('ch01');
    expect(resolveScrubTooltip({ chapters: unmeasured, page: 26, pageCount: 100 }).chapterId).toBe('ch02');
  });

  it('clamps out-of-range pages and survives an empty timeline', () => {
    expect(resolveScrubTooltip({ chapters, page: 0, pageCount: 100 }).page).toBe(1);
    expect(resolveScrubTooltip({ chapters, page: 999, pageCount: 100 }).page).toBe(100);
    expect(resolveScrubTooltip({ chapters: [], page: 4, pageCount: 10 })).toEqual({
      chapterId: '',
      chapterTitle: '',
      page: 4,
      preview: '',
    });
  });
});
