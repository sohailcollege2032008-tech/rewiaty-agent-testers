import { useCallback, useState } from 'react';
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
import type { ThemeId } from '@/types/reader';

export type PageScrubberProps = {
  page: number;
  pageCount: number;
  dir: 'rtl' | 'ltr';
  theme?: ThemeId;
  onSeekPage: (targetPage: number) => void;
};

const THUMB_SIZE = 15;

function computePageFromX(x: number, width: number, pageCount: number, isRtl: boolean): number {
  'worklet';
  if (width <= 0 || pageCount <= 1) return 1;
  const clampedRatio = Math.max(0, Math.min(1, x / width));
  const progress = isRtl ? 1 - clampedRatio : clampedRatio;
  return Math.max(1, Math.min(pageCount, Math.round(1 + progress * (pageCount - 1))));
}

export function PageScrubber({ page, pageCount, dir, theme, onSeekPage }: PageScrubberProps) {
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const trackWidth = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const dragRatio = useSharedValue(0);

  const safeCount = Math.max(1, pageCount);
  const safePage = Math.max(1, Math.min(safeCount, page));
  const currentProgress = safeCount <= 1 ? 1 : (safePage - 1) / (safeCount - 1);

  const commitPage = useCallback(
    (targetPage: number) => {
      setPreviewPage(null);
      onSeekPage(targetPage);
    },
    [onSeekPage],
  );

  const updatePreview = useCallback((targetPage: number) => {
    setPreviewPage(targetPage);
  }, []);

  const clearPreview = useCallback(() => {
    setPreviewPage(null);
  }, []);

  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    onActivate: (e) => {
      'worklet';
      const w = trackWidth.get();
      if (w <= 0) return;
      isDragging.set(true);
      const ratio = Math.max(0, Math.min(1, e.x / w));
      dragRatio.set(ratio);
      const target = computePageFromX(e.x, w, safeCount, isRtl);
      scheduleOnRN(updatePreview, target);
    },
    onUpdate: (e) => {
      'worklet';
      const w = trackWidth.get();
      if (w <= 0) return;
      const ratio = Math.max(0, Math.min(1, e.x / w));
      dragRatio.set(ratio);
      const target = computePageFromX(e.x, w, safeCount, isRtl);
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
      const target = computePageFromX(e.x, w, safeCount, isRtl);
      scheduleOnRN(commitPage, target);
    },
  });

  const tap = useTapGesture({
    onDeactivate: (e) => {
      'worklet';
      const w = trackWidth.get();
      if (w <= 0 || e.canceled) return;
      const target = computePageFromX(e.x, w, safeCount, isRtl);
      scheduleOnRN(commitPage, target);
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
      : isRtl
        ? 1 - currentProgress
        : currentProgress;
    const xPos = Math.max(0, Math.min(w, xRatio * w)) - THUMB_SIZE / 2;
    return {
      transform: [{ translateX: xPos }],
    };
  }, [currentProgress, isRtl]);

  const fillStyle = useAnimatedStyle(() => {
    const w = trackWidth.get();
    const xRatio = isDragging.get()
      ? dragRatio.get()
      : isRtl
        ? 1 - currentProgress
        : currentProgress;
    const progress = isRtl ? 1 - xRatio : xRatio;
    const clamped = Math.max(0, Math.min(1, progress));
    const fillW = clamped * w;
    return {
      width: fillW,
      left: isRtl ? w - fillW : 0,
    };
  }, [currentProgress, isRtl]);

  return (
    <View style={styles.container}>
      {previewPage !== null ? (
        <View
          style={[
            styles.previewTooltip,
            {
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.border,
            },
          ]}
        >
          <Text
            style={[
              styles.previewText,
              {
                color: palette.accent,
                fontFamily: TYPOGRAPHY.uiFont,
              },
            ]}
          >
            {`صفحة ${previewPage}`}
          </Text>
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
          </View>
          <Animated.View
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

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 4,
  },
  previewTooltip: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
  },
  previewText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
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
