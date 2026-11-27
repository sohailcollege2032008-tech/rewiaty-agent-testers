import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { View, ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native';

import { PageScrubber } from '@/components/page-scrubber';
import {
  buildChapterTimeline,
  buildPageScale,
  mapBookmarks,
  mapHighlights,
  ratioToPhysicalX,
  type TimelineChapterInput,
} from '@/utils/chapter-timeline';
import * as chapterTimelineUtils from '@/utils/chapter-timeline';

// The gesture + reanimated mocks in jest.setup.ts are frozen (a shared value never changes), which is
// enough to render but cannot exercise a drag. This suite needs the real drag arithmetic, so the
// config objects the component registers are captured and driven by hand, and shared values hold
// their value across re-renders like the real ones do.
const mockPanConfig: Record<string, (event: { x: number; canceled?: boolean }) => void> = {};
const mockTapConfig: Record<string, (event: { x: number; canceled?: boolean }) => void> = {};

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  usePanGesture: (config: Record<string, (event: { x: number }) => void>) => {
    Object.assign(mockPanConfig, config);
    return {};
  },
  useTapGesture: (config: Record<string, (event: { x: number }) => void>) => {
    Object.assign(mockTapConfig, config);
    return {};
  },
  useSimultaneousGestures: () => ({}),
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    default: { View: RNView, createAnimatedComponent: (component: unknown) => component },
    View: RNView,
    Easing: { bezier: () => () => 0 },
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef(null);
      if (ref.current === null) {
        let value = initial;
        ref.current = {
          get: () => value,
          set: (next: unknown) => {
            value = next;
          },
        };
      }
      return ref.current;
    },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    useReducedMotion: () => false,
    withTiming: (value: unknown) => value,
  };
});

const CHAPTERS: TimelineChapterInput[] = [
  {
    id: 'ch01',
    title: 'حَجَرُ الْمَاءِ',
    wordCount: 1000,
    blockIds: ['c1_p1', 'c1_p2'],
    preview: '<p>كان النهر هادئاً في أول الليل</p>',
    startPage: 1,
    pageCount: 25,
  },
  {
    id: 'ch02',
    title: 'الفصل الثاني',
    wordCount: 3000,
    blockIds: ['c2_p1', 'c2_p2', 'c2_p3', 'c2_p4'],
    preview: 'ثم جاءت الريح',
    startPage: 26,
    pageCount: 75,
  },
];

const SEGMENTS = buildChapterTimeline(CHAPTERS);
const BOOKMARKS = mapBookmarks(CHAPTERS, SEGMENTS, [
  { id: 'bm1', chapterId: 'ch02', anchor: { blockId: 'c2_p1', charOffset: 0 } },
]);
const HIGHLIGHTS = mapHighlights(CHAPTERS, SEGMENTS, [
  { id: 'hl1', chapterId: 'ch01', color: 'gold', anchor: { blockId: 'c1_p2', charOffset: 0 } },
]);

function flatStyle(node: { props: { style?: unknown } }): ViewStyle {
  return (StyleSheet.flatten(node.props.style as ViewStyle) ?? {}) as ViewStyle;
}

async function renderScrubber(overrides: Partial<Parameters<typeof PageScrubber>[0]> = {}) {
  const onSeekPage = jest.fn();
  const utils = await render(
    <PageScrubber
      page={1}
      pageCount={100}
      dir="rtl"
      theme="warraq"
      onSeekPage={onSeekPage}
      {...overrides}
    />,
  );
  return { utils, onSeekPage };
}

describe('PageScrubber — F29 weighted chapter timeline', () => {
  beforeEach(() => {
    jest.useRealTimers();
    for (const key of Object.keys(mockPanConfig)) delete mockPanConfig[key];
    for (const key of Object.keys(mockTapConfig)) delete mockTapConfig[key];
  });

  it('keeps the existing track, mid reference and thumb testIDs without timeline props', async () => {
    const { utils } = await renderScrubber();
    const { getByTestId, queryByTestId } = utils;

    expect(getByTestId('reader-scrubber-track')).toBeTruthy();
    expect(getByTestId('reader-scrubber-mid')).toBeTruthy();
    expect(getByTestId('reader-scrubber-thumb')).toBeTruthy();
    // No timeline data: nothing extra is drawn, so older callers render exactly as before.
    expect(queryByTestId('timeline-tick-0')).toBeNull();
    expect(queryByTestId('timeline-marker-bookmark-bm1')).toBeNull();
  });

  it('draws one non-interactive tick divider per chapter boundary, mirrored for RTL', async () => {
    const { utils } = await renderScrubber({
      timelineChapters: CHAPTERS,
      timelineSegments: SEGMENTS,
    });
    const { getByTestId } = utils;

    const tick = getByTestId('timeline-tick-0');
    expect(tick.props.pointerEvents).toBe('none');
    // ch01 is 0.25 of the book; in RTL that boundary sits 75% from the physical left edge.
    expect(flatStyle(tick).left).toBe('75%');
    // The physical-LTR invariant the whole drag math depends on is still on the touch area.
    expect(flatStyle(getByTestId('reader-scrubber-track')).direction).toBe('ltr');
  });

  it('mirrors the tick to 25% in LTR', async () => {
    const { utils } = await renderScrubber({
      dir: 'ltr',
      timelineChapters: CHAPTERS,
      timelineSegments: SEGMENTS,
    });
    const { getByTestId } = utils;
    expect(flatStyle(getByTestId('timeline-tick-0')).left).toBe('25%');
  });

  it('places bookmark and highlight dots at their physical position, coloured and non-interactive', async () => {
    const { utils } = await renderScrubber({
      timelineChapters: CHAPTERS,
      timelineSegments: SEGMENTS,
      timelineMarkers: [...BOOKMARKS, ...HIGHLIGHTS],
    });
    const { getByTestId } = utils;

    // ch02 starts at ratio 0.25 -> RTL physical x 0.75.
    const bookmark = getByTestId('timeline-marker-bookmark-bm1');
    expect(flatStyle(bookmark).left).toBe('75%');
    expect(bookmark.props.pointerEvents).toBe('none');
    expect(flatStyle(bookmark).backgroundColor).toBeTruthy();

    // ch01's second block of two -> ratio 0.125 -> RTL physical x 0.875.
    const highlight = getByTestId('timeline-marker-highlight-hl1');
    expect(flatStyle(highlight).left).toBe('87.5%');
    expect(highlight.props.pointerEvents).toBe('none');
    // Gold, not the accent: the dot keeps the highlight's own colour.
    expect(flatStyle(highlight).backgroundColor).toBe('#E5B842');
  });

  it('shows a rich tooltip while dragging: chapter title, page and stripped first line', async () => {
    const { utils } = await renderScrubber({
      timelineChapters: CHAPTERS,
      timelineSegments: SEGMENTS,
      timelineMarkers: [...BOOKMARKS, ...HIGHLIGHTS],
    });
    const { getByTestId, getByText } = utils;

    await fireEvent(getByTestId('reader-scrubber-track'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 32 } },
    });

    await act(async () => {
      mockPanConfig.onActivate?.({ x: 90 });
    });

    // RTL: x=90/300 -> 30% from the left edge -> 70% of the book -> page 70 of 100.
    const tooltip = getByTestId('reader-scrubber-tooltip');
    expect(tooltip).toBeTruthy();
    expect(getByText('الفصل الثاني')).toBeTruthy();
    expect(getByText('صفحة 70')).toBeTruthy();
    expect(getByText('ثم جاءت الريح')).toBeTruthy();
  });

  it('commits the page the finger is on and lingers the tooltip briefly, then clears it', async () => {
    jest.useFakeTimers();
    const { utils, onSeekPage } = await renderScrubber({
      timelineChapters: CHAPTERS,
      timelineSegments: SEGMENTS,
    });
    const { getByTestId, queryByTestId } = utils;

    await fireEvent(getByTestId('reader-scrubber-track'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 32 } },
    });

    await act(async () => {
      mockPanConfig.onDeactivate?.({ x: 225, canceled: false });
    });

    // RTL: x=225/300 is 75% from the left edge, i.e. a quarter into the book -> page 26.
    expect(onSeekPage).toHaveBeenCalledWith(26);
    expect(getByTestId('reader-scrubber-tooltip')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await waitFor(() => expect(queryByTestId('reader-scrubber-tooltip')).toBeNull());
  });

  it('does not commit or show a tooltip when the gesture is cancelled', async () => {
    const { utils, onSeekPage } = await renderScrubber({
      timelineChapters: CHAPTERS,
      timelineSegments: SEGMENTS,
    });
    const { getByTestId, queryByTestId } = utils;

    await fireEvent(getByTestId('reader-scrubber-track'), 'layout', {
      nativeEvent: { layout: { width: 300, height: 32 } },
    });

    await act(async () => {
      mockPanConfig.onActivate?.({ x: 30 });
      mockPanConfig.onDeactivate?.({ x: 30, canceled: true });
    });

    expect(onSeekPage).not.toHaveBeenCalled();
    expect(queryByTestId('reader-scrubber-tooltip')).toBeNull();
  });
});

describe('PageScrubber — weighted page mapping matches the drawn rail (Codex #54 P1)', () => {
  // 100x lopsided: the short chapter is floored to 2% of the rail, the long one owns the rest.
  const UNEVEN: TimelineChapterInput[] = [
    { id: 'short', title: 'قصير جداً', wordCount: 120 },
    { id: 'long', title: 'طويل جداً', wordCount: 12000 },
  ];
  const UNEVEN_SEGMENTS = buildChapterTimeline(UNEVEN);
  const PAGE_COUNT = 200;
  const WIDTH = 300;

  beforeEach(() => {
    jest.useRealTimers();
    for (const key of Object.keys(mockPanConfig)) delete mockPanConfig[key];
    for (const key of Object.keys(mockTapConfig)) delete mockTapConfig[key];
  });

  it.each(['rtl', 'ltr'] as const)(
    'commits the chapter start page when the drag lands on that divider (%s)',
    async (dir) => {
      const { utils, onSeekPage } = await renderScrubber({
        dir,
        pageCount: PAGE_COUNT,
        timelineChapters: UNEVEN,
        timelineSegments: UNEVEN_SEGMENTS,
      });
      const { getByTestId } = utils;
      const scale = buildPageScale(UNEVEN_SEGMENTS, PAGE_COUNT);

      await fireEvent(getByTestId('reader-scrubber-track'), 'layout', {
        nativeEvent: { layout: { width: WIDTH, height: 32 } },
      });

      const dividerX = ratioToPhysicalX(UNEVEN_SEGMENTS[1]!.startRatio, dir) * WIDTH;
      await act(async () => {
        mockPanConfig.onDeactivate?.({ x: dividerX, canceled: false });
      });

      expect(scale[1]!.startPage).toBeGreaterThan(1);
      expect(onSeekPage).toHaveBeenCalledWith(scale[1]!.startPage);
    },
  );

  it('draws the divider on the same physical x the thumb takes for that page (RTL)', async () => {
    const scale = buildPageScale(UNEVEN_SEGMENTS, PAGE_COUNT);
    const page = scale[1]!.startPage;
    const onSeekPage = jest.fn();
    const element = () => (
      <PageScrubber
        page={page}
        pageCount={PAGE_COUNT}
        dir="rtl"
        theme="warraq"
        onSeekPage={onSeekPage}
        timelineChapters={UNEVEN}
        timelineSegments={UNEVEN_SEGMENTS}
      />
    );
    const utils = await render(element());
    const { getByTestId } = utils;

    await fireEvent(getByTestId('reader-scrubber-track'), 'layout', {
      nativeEvent: { layout: { width: WIDTH, height: 32 } },
    });
    // The shared value mock does not re-render on update, so render once more with the width set.
    await utils.rerender(element());

    const divider = flatStyle(getByTestId('timeline-tick-0')).left as string;
    const dividerX = (parseFloat(divider) / 100) * WIDTH;

    const thumb = flatStyle(getByTestId('reader-scrubber-thumb'));
    const transform = thumb.transform as { translateX: number }[];
    // The thumb is translated from its left edge; its centre must sit on the divider.
    const thumbCentre = transform[0]!.translateX + 15 / 2;
    expect(thumbCentre).toBeCloseTo(dividerX, 5);
  });

  it('shows the page the weighted finger position resolves to, and cleans chapter text once per drag', async () => {
    const stripSpy = jest.spyOn(chapterTimelineUtils, 'stripHtmlToText');
    const { utils } = await renderScrubber({
      dir: 'rtl',
      pageCount: PAGE_COUNT,
      timelineChapters: UNEVEN,
      timelineSegments: UNEVEN_SEGMENTS,
    });
    const { getByTestId, getByText } = utils;

    await fireEvent(getByTestId('reader-scrubber-track'), 'layout', {
      nativeEvent: { layout: { width: WIDTH, height: 32 } },
    });

    const scale = buildPageScale(UNEVEN_SEGMENTS, PAGE_COUNT);
    const fingerX = ratioToPhysicalX(UNEVEN_SEGMENTS[1]!.startRatio, 'rtl') * WIDTH + 30;

    await act(async () => {
      mockPanConfig.onActivate?.({ x: fingerX });
      mockPanConfig.onUpdate?.({ x: fingerX + 10 });
      mockPanConfig.onUpdate?.({ x: fingerX + 20 });
      mockPanConfig.onUpdate?.({ x: fingerX + 30 });
    });

    // The tooltip page comes from the same scale as the rail, not from linear page math.
    const lastX = fingerX + 30;
    const ratio = 1 - lastX / WIDTH;
    const { ratioToPageInScale } = chapterTimelineUtils;
    expect(getByText(`صفحة ${ratioToPageInScale(scale, ratio, PAGE_COUNT)}`)).toBeTruthy();

    // Two chapters -> the first line of each is cleaned once, no matter how many drag ticks fired.
    expect(stripSpy).toHaveBeenCalledTimes(UNEVEN.length);
    stripSpy.mockRestore();
  });
});
