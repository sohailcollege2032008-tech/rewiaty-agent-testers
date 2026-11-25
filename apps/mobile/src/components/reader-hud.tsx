import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';
import { PageScrubber } from './page-scrubber';

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

export type ReaderHudProps = {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  page: number;
  pageCount: number;
  chapterCount?: number;
  isBookmarked?: boolean;
  isTablet?: boolean;
  isTabletLandscape?: boolean;
  dir: 'rtl' | 'ltr';
  theme?: ThemeId;
  onBack: () => void;
  onOpenToc: () => void;
  onOpenSettings: () => void;
  onSeekPage: (page: number) => void;
  onBarsLayout?: (heights: { headerHeight: number; footerHeight: number }) => void;
};

export function ReaderHud({
  visible,
  bookTitle,
  chapterTitle,
  page,
  pageCount,
  chapterCount,
  isBookmarked = false,
  isTablet = false,
  isTabletLandscape = false,
  dir,
  theme,
  onBack,
  onOpenToc,
  onOpenSettings,
  onSeekPage,
  onBarsLayout,
}: ReaderHudProps) {
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(theme);
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(visible ? 1 : 0);
  const measuredBarsRef = useRef<{ headerHeight: number; footerHeight: number }>({
    headerHeight: 0,
    footerHeight: 0,
  });

  const handleHeaderLayout = (event: LayoutChangeEvent) => {
    const h = Math.round(event.nativeEvent.layout.height);
    if (h > 0 && h !== measuredBarsRef.current.headerHeight) {
      measuredBarsRef.current.headerHeight = h;
      if (measuredBarsRef.current.footerHeight > 0) {
        onBarsLayout?.({ ...measuredBarsRef.current });
      }
    }
  };

  const handleFooterLayout = (event: LayoutChangeEvent) => {
    const h = Math.round(event.nativeEvent.layout.height);
    if (h > 0 && h !== measuredBarsRef.current.footerHeight) {
      measuredBarsRef.current.footerHeight = h;
      if (measuredBarsRef.current.headerHeight > 0) {
        onBarsLayout?.({ ...measuredBarsRef.current });
      }
    }
  };

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
        onLayout={handleHeaderLayout}
        pointerEvents={barPointerEvents}
        style={[
          styles.header,
          isTablet && styles.headerTablet,
          {
            paddingTop: Math.max(insets.top, isTablet ? 14 : 12),
            backgroundColor: palette.hudBg,
            borderBottomColor: palette.border,
          },
          topStyle,
        ]}
      >
        <Pressable
          testID="reader-back-button"
          onPress={onBack}
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            isTablet && styles.iconBtnTablet,
            pressed && { backgroundColor: palette.accentSoft },
          ]}
          accessibilityRole="button"
          accessibilityLabel="رجوع إلى المكتبة"
        >
          <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
            <Path
              d="M9 18l6-6-6-6"
              stroke={palette.text}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          {isTablet ? (
            <Text style={[styles.btnText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
              المكتبة
            </Text>
          ) : null}
        </Pressable>

        <View style={styles.titleCenterWrap}>
          <Text
            testID="reader-book-title"
            style={[
              styles.bookTitle,
              {
                color: palette.text,
                fontFamily: TYPOGRAPHY.displayFont,
                fontSize: isTablet ? 21 : 18,
              },
            ]}
            numberOfLines={1}
          >
            {bookTitle}
          </Text>
          {isTablet ? (
            <View
              style={[
                styles.modePill,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.modePillText,
                  { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                {isTabletLandscape ? 'كتاب مفتوح · صفحتان' : 'تابلت · صفحة واحدة'}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            testID="reader-toc-button"
            onPress={onOpenToc}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={({ pressed }) => [
              styles.iconBtn,
              isTablet && styles.iconBtnTablet,
              pressed && { backgroundColor: palette.accentSoft },
            ]}
            accessibilityRole="button"
            accessibilityLabel="الفهرس"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 6h16M4 12h11M4 18h14"
                stroke={palette.text}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </Svg>
            {isTablet ? (
              <Text style={[styles.btnText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
                الفهرس
              </Text>
            ) : null}
          </Pressable>

          <Pressable
            testID="reader-settings-button"
            onPress={onOpenSettings}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={({ pressed }) => [
              styles.iconBtn,
              isTablet && styles.iconBtnTablet,
              pressed && { backgroundColor: palette.accentSoft },
            ]}
            accessibilityRole="button"
            accessibilityLabel="إعدادات القراءة"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 20h16M6 16l4-12 4 12M7.5 12h5"
                stroke={palette.accent}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            {isTablet ? (
              <Text
                style={[styles.btnText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                المظهر والخط
              </Text>
            ) : null}
          </Pressable>
        </View>
      </Animated.View>

      <Animated.View
        testID="reader-hud-footer"
        onLayout={handleFooterLayout}
        pointerEvents={barPointerEvents}
        style={[
          styles.footer,
          isTablet && styles.footerTablet,
          {
            paddingBottom: Math.max(insets.bottom, 18),
            backgroundColor: palette.hudBg,
            borderTopColor: palette.border,
          },
          bottomStyle,
        ]}
      >
        <View style={[styles.footerInner, isTablet && styles.footerInnerTablet]}>
          <View style={styles.footerInfoRow}>
            <Text
              testID="reader-chapter-title"
              style={[
                styles.chapterTitle,
                { color: palette.text, fontFamily: TYPOGRAPHY.uiFont },
              ]}
              numberOfLines={1}
            >
              {chapterTitle}
            </Text>
            <Text
              testID="reader-page-counter"
              style={[
                styles.pageCounter,
                { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              {`صفحة ${page} من ${pageCount}`}
            </Text>
          </View>

          <PageScrubber
            page={page}
            pageCount={pageCount}
            dir={dir}
            theme={theme}
            onSeekPage={onSeekPage}
          />

          <View style={styles.footerSubRow}>
            <Text style={[styles.subText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {chapterCount ? `${chapterCount} فصول` : 'القراءة الحالية'}
            </Text>
            <Text style={[styles.subText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {isBookmarked ? 'الصفحة محفوظة بالشريطة' : 'اضغط الشريطة لحفظ الصفحة'}
            </Text>
          </View>
        </View>
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
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTablet: {
    paddingHorizontal: 28,
    paddingBottom: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    minWidth: 40,
    minHeight: 40,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  iconBtnTablet: {
    paddingHorizontal: 11,
    borderRadius: 7,
  },
  btnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  titleCenterWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minWidth: 0,
  },
  bookTitle: {
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  modePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  modePillText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  footerTablet: {
    paddingHorizontal: 48,
    paddingTop: 16,
  },
  footerInner: {
    width: '100%',
    gap: 8,
  },
  footerInnerTablet: {
    maxWidth: 900,
    alignSelf: 'center',
  },
  footerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chapterTitle: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'right',
  },
  pageCounter: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  footerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  subText: {
    fontSize: 11,
  },
});
