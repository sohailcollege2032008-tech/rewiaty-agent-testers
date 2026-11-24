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

export type PageScrubberProps = {
  page: number;
  pageCount: number;
  dir: 'rtl' | 'ltr';
  onSeekPage: (targetPage: number) => void;
};

const THUMB_SIZE = 20;

function computePageFromX(x: number, width: number, pageCount: number, isRtl: boolean): number {
  'worklet';
  if (width <= 0 || pageCount <= 1) return 1;
  const clampedRatio = Math.max(0, Math.min(1, x / width));
  const progress = isRtl ? 1 - clampedRatio : clampedRatio;
  return Math.max(1, Math.min(pageCount, Math.round(1 + progress * (pageCount - 1))));
}

export function PageScrubber({ page, pageCount, dir, onSeekPage }: PageScrubberProps) {
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
        <Text style={styles.previewText}>{`صفحة ${previewPage}`}</Text>
      ) : null}
      <GestureDetector gesture={gesture}>
        <View
          testID="reader-scrubber-track"
          style={styles.touchArea}
          onLayout={handleLayout}
          accessibilityRole="adjustable"
          accessibilityLabel="شريط التنقل بين الصفحات"
        >
          <View style={styles.track}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
          <Animated.View style={[styles.thumb, thumbStyle]} />
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
  previewText: {
    alignSelf: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#8B5A2B',
    fontVariant: ['tabular-nums'],
  },
  touchArea: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5DDD0',
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#8B5A2B',
    borderRadius: 999,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#8B5A2B',
    borderWidth: 2,
    borderColor: '#FFFDF9',
    boxShadow: '0 2px 5px rgba(0, 0, 0, 0.22)',
  },
});
