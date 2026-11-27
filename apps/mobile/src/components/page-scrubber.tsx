import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { AppThemeTokens } from '@/theme/types';
import { HIGHLIGHT_COLORS, type ThemeId } from '@/types/reader';
import {
  buildChapterTimeline,
  buildPageScale,
  pageToRatioInScale,
  physicalXToRatio,
  ratioToPageInScale,
  ratioToPhysicalX,
  resolveScrubTooltip,
  segmentsToTicks,
  stripHtmlToText,
  truncatePreview,
  type ChapterSegment,
  type TimelineChapterInput,
  type TimelineMarker,
  type TimelinePageSpan,
  type TimelineTick,
} from '@/utils/chapter-timeline';

export type PageScrubberProps = {
  page: number;
  pageCount: number;
  dir: 'rtl' | 'ltr';
  theme?: ThemeId;
  /** Resolved chrome tokens (custom pair), so the scrubber matches the HUD above it. */
  tokens?: AppThemeTokens;
  onSeekPage: (targetPage: number) => void;
  /**
   * F29 — optional chapter timeline. Callers that omit these get exactly the pre-F29 scrubber.
   * Segments are derived from `timelineChapters` when not supplied.
   */
  timelineChapters?: readonly TimelineChapterInput[];
  timelineSegments?: readonly ChapterSegment[];
  timelineMarkers?: readonly TimelineMarker[];
};

const THUMB_SIZE = 15;
const MARKER_SIZE = 6;
/** How long the tooltip stays after a released drag, so the reader sees where they landed. */
const TOOLTIP_LINGER_MS = 1800;

const EMPTY_CHAPTERS: readonly TimelineChapterInput[] = [];
const EMPTY_MARKERS: readonly TimelineMarker[] = [];

/**
 * Physical touch x -> page, through the same weighted chapter scale the ticks are drawn from.
 *
 * Why (Codex #54 P1): the old version mapped the finger linearly across `pageCount` while the
 * dividers/markers were placed by chapter word weight, so "the page at the divider" was not the
 * page the chapter actually starts on.
 */
function computePageFromX(
  x: number,
  width: number,
  pageCount: number,
  isRtl: boolean,
  pageScale: readonly TimelinePageSpan[],
): number {
  'worklet';
  if (width <= 0 || pageCount <= 1) return 1;
  const ratio = physicalXToRatio(x / width, isRtl ? 'rtl' : 'ltr');
  return ratioToPageInScale(pageScale, ratio, pageCount);
}

type DrawnMarker = TimelineMarker & { x: number };

/** Ticks are pure decoration; memoising them keeps a drag from re-rendering the whole rail. */
const ChapterTicks = memo(
  function ChapterTicks({ ticks, color }: { ticks: readonly TimelineTick[]; color: string }) {
    return (
      <>
        {ticks.map((tick) => (
          <View
            key={`tick-${tick.index}`}
            testID={`timeline-tick-${tick.index}`}
            pointerEvents="none"
            style={[styles.tick, { left: `${tick.x * 100}%`, backgroundColor: color }]}
          />
        ))}
      </>
    );
  },
  (prev, next) => prev.ticks === next.ticks && prev.color === next.color,
);

const TimelineDots = memo(
  function TimelineDots({
    markers,
    isDark,
    ribbon,
  }: {
    markers: readonly DrawnMarker[];
    isDark: boolean;
    ribbon: string;
  }) {
    return (
      <>
        {markers.map((marker) => (
          <View
            key={`${marker.kind}-${marker.id}`}
            testID={`timeline-marker-${marker.kind}-${marker.id}`}
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: `${marker.x * 100}%`,
                backgroundColor: markerColor(marker, isDark, ribbon),
              },
            ]}
          />
        ))}
      </>
    );
  },
  (prev, next) =>
    prev.markers === next.markers &&
    prev.isDark === next.isDark &&
    prev.ribbon === next.ribbon,
);

export function PageScrubber({
  page,
  pageCount,
  dir,
  theme,
  tokens,
  onSeekPage,
  timelineChapters,
  timelineSegments,
  timelineMarkers,
}: PageScrubberProps) {
  const palette = tokens ?? getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackWidth = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const dragRatio = useSharedValue(0);

  const safeCount = Math.max(1, pageCount);
  const safePage = Math.max(1, Math.min(safeCount, page));
  const chapterList = timelineChapters ?? EMPTY_CHAPTERS;

  // The track is weighted by chapter word count: a long chapter gets a longer stretch of the rail.
  const segments = useMemo(
    () => timelineSegments ?? (timelineChapters ? buildChapterTimeline(timelineChapters) : []),
    [timelineSegments, timelineChapters],
  );
  // One page <-> ratio scale per data change; the thumb, the fill, a drag and the tooltip all read
  // from it, so they can never disagree with the dividers.
  const pageScale = useMemo(() => buildPageScale(segments, safeCount), [segments, safeCount]);
  const ticks = useMemo(() => segmentsToTicks(segments, dir), [segments, dir]);
  const currentRatio = pageToRatioInScale(pageScale, safePage, safeCount);
  const markers = useMemo(
    () =>
      (timelineMarkers ?? EMPTY_MARKERS).map((marker) => ({
        ...marker,
        x: ratioToPhysicalX(marker.ratio, dir),
      })),
    [timelineMarkers, dir],
  );
  // Why (Codex #54 P2): the first line of every chapter is cleaned ONCE per chapter-data change,
  // not on every drag tick.
  const previews = useMemo(() => {
    const map = new Map<string, string>();
    for (const chapter of chapterList) {
      map.set(chapter.id, truncatePreview(stripHtmlToText(chapter.preview)));
    }
    return map;
  }, [chapterList]);
  const tooltip = useMemo(
    () =>
      previewPage === null
        ? null
        : resolveScrubTooltip({
            chapters: chapterList,
            page: previewPage,
            pageCount: safeCount,
            segments,
            previews,
          }),
    [previewPage, chapterList, safeCount, segments, previews],
  );

  const clearLingerTimer = useCallback(() => {
    if (lingerTimerRef.current !== null) {
      clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearLingerTimer, [clearLingerTimer]);

  const commitPage = useCallback(
    (targetPage: number) => {
      // Keep the tooltip visible for a beat after release: it confirms the page the reader landed on.
      setPreviewPage(targetPage);
      clearLingerTimer();
      lingerTimerRef.current = setTimeout(() => {
        lingerTimerRef.current = null;
        setPreviewPage(null);
      }, TOOLTIP_LINGER_MS);
      onSeekPage(targetPage);
    },
    [clearLingerTimer, onSeekPage],
  );

  const updatePreview = useCallback(
    (targetPage: number) => {
      clearLingerTimer();
      setPreviewPage(targetPage);
    },
    [clearLingerTimer],
  );

  // A tap is a direct jump: it needs no confirmation card, so it keeps the pre-F29 behaviour.
  const commitPageWithoutTooltip = useCallback(
    (targetPage: number) => {
      clearLingerTimer();
      setPreviewPage(null);
      onSeekPage(targetPage);
    },
    [clearLingerTimer, onSeekPage],
  );

  const clearPreview = useCallback(() => {
    clearLingerTimer();
    setPreviewPage(null);
  }, [clearLingerTimer]);

  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    onActivate: (e) => {
      'worklet';
      const w = trackWidth.get();
      if (w <= 0) return;
      isDragging.set(true);
      const ratio = Math.max(0, Math.min(1, e.x / w));
      dragRatio.set(ratio);
      const target = computePageFromX(e.x, w, safeCount, isRtl, pageScale);
      scheduleOnRN(updatePreview, target);
    },
    onUpdate: (e) => {
      'worklet';
      const w = trackWidth.get();
      if (w <= 0) return;
      const ratio = Math.max(0, Math.min(1, e.x / w));
      dragRatio.set(ratio);
      const target = computePageFromX(e.x, w, safeCount, isRtl, pageScale);
      scheduleOnRN(updatePreview, target);
    },
    onDeactivate: (e) => {
      'worklet';
      const w = trackWidth.get();
      isDragging.set(false);
      if (w <= 0 || e.canceled) {
        scheduleOnRN(clearPreview);
        return;
      }
      const target = computePageFromX(e.x, w, safeCount, isRtl, pageScale);
      scheduleOnRN(commitPage, target);
    },
  });

  const tap = useTapGesture({
    onDeactivate: (e) => {
      'worklet';
      const w = trackWidth.get();
      if (w <= 0 || e.canceled) return;
      const target = computePageFromX(e.x, w, safeCount, isRtl, pageScale);
      scheduleOnRN(commitPageWithoutTooltip, target);
    },
  });

  const gesture = useSimultaneousGestures(tap, pan);

  const handleLayout = (event: LayoutChangeEvent) => {
    trackWidth.set(event.nativeEvent.layout.width);
  };

  const thumbStyle = useAnimatedStyle(() => {
    const w = trackWidth.get();
    const xRatio = isDragging.get()
      ? dragRatio.get()
      : ratioToPhysicalX(currentRatio, isRtl ? 'rtl' : 'ltr');
    const xPos = Math.max(0, Math.min(w, xRatio * w)) - THUMB_SIZE / 2;
    return {
      transform: [{ translateX: xPos }],
    };
  }, [currentRatio, isRtl]);

  const fillStyle = useAnimatedStyle(() => {
    const w = trackWidth.get();
    const xRatio = isDragging.get()
      ? dragRatio.get()
      : ratioToPhysicalX(currentRatio, isRtl ? 'rtl' : 'ltr');
    const progress = isRtl ? 1 - xRatio : xRatio;
    const clamped = Math.max(0, Math.min(1, progress));
    const fillW = clamped * w;
    return {
      width: fillW,
      left: isRtl ? w - fillW : 0,
    };
  }, [currentRatio, isRtl]);

  return (
    <View style={styles.container}>
      {tooltip !== null ? (
        <View
          testID="reader-scrubber-tooltip"
          style={[
            styles.previewTooltip,
            {
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.border,
            },
          ]}
        >
          {tooltip.chapterTitle ? (
            <Text
              testID="reader-scrubber-tooltip-chapter"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.previewChapter,
                {
                  color: palette.heading ?? palette.text,
                  fontFamily: TYPOGRAPHY.uiFont,
                },
              ]}
            >
              {tooltip.chapterTitle}
            </Text>
          ) : null}
          <Text
            testID="reader-scrubber-tooltip-page"
            style={[
              styles.previewText,
              {
                color: palette.accent,
                fontFamily: TYPOGRAPHY.uiFont,
              },
            ]}
          >
            {`صفحة ${tooltip.page}`}
          </Text>
          {tooltip.preview ? (
            <Text
              testID="reader-scrubber-tooltip-preview"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.previewLine,
                {
                  color: palette.muted,
                  fontFamily: TYPOGRAPHY.uiFont,
                },
              ]}
            >
              {tooltip.preview}
            </Text>
          ) : null}
        </View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <View
          testID="reader-scrubber-track"
          hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
          style={styles.touchArea}
          onLayout={handleLayout}
          accessibilityRole="adjustable"
          accessibilityLabel="شريط التنقل بين الصفحات"
        >
          <View style={[styles.track, { backgroundColor: palette.border }]}>
            <Animated.View style={[styles.fill, { backgroundColor: palette.accent }, fillStyle]} />
            <ChapterTicks ticks={ticks} color={palette.hudBg} />
          </View>
          {/* Fixed reference at the physical middle of the track; journeys assert the thumb is
              left/right of it, because the RTL bug was visual (the page math was right). */}
          <View testID="reader-scrubber-mid" pointerEvents="none" style={styles.midMarker} />
          <TimelineDots markers={markers} isDark={palette.isDark} ribbon={palette.ribbon} />
          <Animated.View
            testID="reader-scrubber-thumb"
            style={[
              styles.thumb,
              {
                backgroundColor: palette.accent,
                borderColor: palette.surfaceElevated,
              },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

/** Bookmark = the theme's crimson ribbon; highlight = its own stored colour. */
function markerColor(marker: TimelineMarker, isDark: boolean, ribbon: string): string {
  if (marker.kind === 'bookmark') return ribbon;
  const meta = HIGHLIGHT_COLORS.find((candidate) => candidate.id === marker.color);
  if (!meta) return ribbon;
  return isDark ? meta.swatchDark : meta.swatchLight;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 4,
  },
  previewTooltip: {
    alignSelf: 'center',
    maxWidth: '92%',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    gap: 2,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
  },
  previewChapter: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  previewText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  previewLine: {
    fontSize: 11.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  touchArea: {
    // Why: the app forces RTL (I18nManager.forceRTL), so RN would flip `left` to `right` for the
    // thumb and fill while the gesture's `e.x` stays physical (from the left edge). That made the
    // thumb move opposite to the finger. The track is laid out in physical LTR coordinates and the
    // reading direction is applied only in computePageFromX / currentProgress.
    direction: 'ltr',
    height: 32,
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 2,
  },
  tick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    opacity: 0.9,
  },
  marker: {
    position: 'absolute',
    top: (32 - MARKER_SIZE) / 2 + 1,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    transform: [{ translateX: -MARKER_SIZE / 2 }],
  },
  midMarker: {
    position: 'absolute',
    left: '50%',
    top: 15,
    width: 2,
    height: 2,
    opacity: 0.01,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 2,
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
  },
});
