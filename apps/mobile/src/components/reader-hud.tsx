import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PageScrubber } from './page-scrubber';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export type ReaderHudProps = {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  page: number;
  pageCount: number;
  dir: 'rtl' | 'ltr';
  onBack: () => void;
  onOpenToc: () => void;
  onSeekPage: (page: number) => void;
};

export function ReaderHud({
  visible,
  bookTitle,
  chapterTitle,
  page,
  pageCount,
  dir,
  onBack,
  onOpenToc,
  onSeekPage,
}: ReaderHudProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    progress.set(
      withTiming(visible ? 1 : 0, {
        duration: reducedMotion ? 120 : 220,
        easing: EASE_OUT,
      }),
    );
  }, [visible, reducedMotion, progress]);

  const topStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: [{ translateY: reducedMotion ? 0 : (1 - p) * -28 }],
    };
  }, [reducedMotion]);

  const bottomStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: [{ translateY: reducedMotion ? 0 : (1 - p) * 28 }],
    };
  }, [reducedMotion]);

  const barPointerEvents = visible ? 'auto' : 'none';

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View
        testID="reader-hud-header"
        pointerEvents={barPointerEvents}
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top, 12) },
          topStyle,
        ]}
      >
        <Pressable
          testID="reader-back-button"
          onPress={onBack}
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="رجوع إلى المكتبة"
        >
          <Text style={styles.btnText}>رجوع</Text>
        </Pressable>

        <Text style={styles.bookTitle} numberOfLines={1}>
          {bookTitle}
        </Text>

        <Pressable
          testID="reader-toc-button"
          onPress={onOpenToc}
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="الفهرس"
        >
          <Text style={styles.btnText}>الفهرس</Text>
        </Pressable>
      </Animated.View>

      <Animated.View
        testID="reader-hud-footer"
        pointerEvents={barPointerEvents}
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, 14) },
          bottomStyle,
        ]}
      >
        <View style={styles.footerInfoRow}>
          <Text style={styles.chapterTitle} numberOfLines={1}>
            {chapterTitle}
          </Text>
          <Text style={styles.pageCounter}>{`صفحة ${page} من ${pageCount}`}</Text>
        </View>

        <PageScrubber page={page} pageCount={pageCount} dir={dir} onSeekPage={onSeekPage} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    zIndex: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: 'rgba(250, 248, 245, 0.96)',
    borderBottomWidth: 1,
    borderBottomColor: '#E5DDD0',
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)',
  },
  iconBtn: {
    minWidth: 56,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(139, 90, 43, 0.1)',
  },
  btnPressed: {
    opacity: 0.72,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8B5A2B',
  },
  bookTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#24211D',
    textAlign: 'center',
  },
  footer: {
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 12,
    backgroundColor: 'rgba(250, 248, 245, 0.96)',
    borderTopWidth: 1,
    borderTopColor: '#E5DDD0',
    boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.08)',
  },
  footerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chapterTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#6E675F',
    textAlign: 'right',
  },
  pageCounter: {
    fontSize: 13,
    fontWeight: '700',
    color: '#24211D',
    fontVariant: ['tabular-nums'],
  },
});
