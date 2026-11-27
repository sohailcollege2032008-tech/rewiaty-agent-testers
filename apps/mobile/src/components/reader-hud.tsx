import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens, THEME_OPTIONS } from '@/theme/reader-theme';
import type { AppThemeTokens } from '@/theme/types';
import type { ReadingMode, ThemeId } from '@/types/reader';
import type {
  ChapterSegment,
  TimelineChapterInput,
  TimelineMarker,
} from '@/utils/chapter-timeline';
import { PageScrubber } from './page-scrubber';

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

export type ReaderHudProps = {
  visible: boolean;
  bookTitle: string;
  chapterTitle: string;
  page: number;
  pageCount: number;
  /** F22: which layout the engine is rendering. Defaults to `paginated`. */
  readingMode?: ReadingMode;
  /** F22 scroll mode: 0..1 position inside the current chapter. */
  chapterProgress?: number;
  /** The engine has not measured every chapter yet, so `pageCount` is an estimate. */
  estimated?: boolean;
  chapterCount?: number;
  isBookmarked?: boolean;
  isTablet?: boolean;
  isTabletLandscape?: boolean;
  dir: 'rtl' | 'ltr';
  theme?: ThemeId;
  /**
   * Fully resolved chrome tokens. When a custom pair is enabled the screen passes
   * `buildCustomAppTheme(...)` here so the HUD paints in the reader's own colours instead of the
   * preset's — the bars sit directly on the custom page, so a cream HUD over a dark custom page
   * would look like a bug.
   */
  tokens?: AppThemeTokens;
  /** A custom pair is painting: no preset in the quick menu may look active. */
  customColorsActive?: boolean;
  /** F29 — weighted chapter timeline data, forwarded to the page scrubber. */
  timelineChapters?: readonly TimelineChapterInput[];
  timelineSegments?: readonly ChapterSegment[];
  timelineMarkers?: readonly TimelineMarker[];
  onBack: () => void;
  onOpenToc: () => void;
  onOpenSettings: () => void;
  onSelectTheme?: (theme: ThemeId) => void;
  onSeekPage: (page: number) => void;
  onBarsLayout?: (heights: { headerHeight: number; footerHeight: number }) => void;
};

export function ReaderHud({
  visible,
  bookTitle,
  chapterTitle,
  page,
  pageCount,
  readingMode = 'paginated',
  chapterProgress,
  estimated = false,
  chapterCount,
  isBookmarked = false,
  isTablet = false,
  isTabletLandscape = false,
  dir,
  theme,
  tokens,
  customColorsActive = false,
  timelineChapters,
  timelineSegments,
  timelineMarkers,
  onBack,
  onOpenToc,
  onOpenSettings,
  onSelectTheme,
  onSeekPage,
  onBarsLayout,
}: ReaderHudProps) {
  const insets = useSafeAreaInsets();
  const palette = tokens ?? getAppThemeTokens(theme);
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(visible ? 1 : 0);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(0);
  const measuredBarsRef = useRef<{ headerHeight: number; footerHeight: number }>({
    headerHeight: 0,
    footerHeight: 0,
  });

  const handleHeaderLayout = (event: LayoutChangeEvent) => {
    const h = Math.round(event.nativeEvent.layout.height);
    if (h > 0 && h !== measuredBarsRef.current.headerHeight) {
      measuredBarsRef.current.headerHeight = h;
      setMeasuredHeaderHeight(h);
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
    if (!visible) {
      setThemeMenuOpen(false);
    }
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
                color: palette.heading ?? palette.text,
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
            onPress={() => {
              setThemeMenuOpen(false);
              onOpenToc();
            }}
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
            testID="reader-theme-button"
            onPress={() => setThemeMenuOpen((prev) => !prev)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={({ pressed }) => [
              styles.iconBtn,
              isTablet && styles.iconBtnTablet,
              (pressed || themeMenuOpen) && { backgroundColor: palette.accentSoft },
            ]}
            accessibilityRole="button"
            accessibilityLabel="المظهر"
            accessibilityState={{ expanded: themeMenuOpen }}
          >
            <View
              style={[
                styles.themeBtnSwatch,
                {
                  backgroundColor: palette.bg,
                  borderColor: themeMenuOpen ? palette.accent : palette.text,
                },
              ]}
            >
              <View style={[styles.themeBtnDot, { backgroundColor: palette.accent }]} />
            </View>
            {isTablet ? (
              <Text
                style={[
                  styles.btnText,
                  {
                    color: themeMenuOpen ? palette.accent : palette.text,
                    fontFamily: TYPOGRAPHY.uiFont,
                  },
                ]}
              >
                المظهر
              </Text>
            ) : null}
          </Pressable>

          <Pressable
            testID="reader-settings-button"
            onPress={() => {
              setThemeMenuOpen(false);
              onOpenSettings();
            }}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={({ pressed }) => [
              styles.iconBtn,
              isTablet && styles.iconBtnTablet,
              pressed && { backgroundColor: palette.accentSoft },
            ]}
            accessibilityRole="button"
            accessibilityLabel="الإعدادات"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 6h4M13 6h7M4 12h9M18 12h2M4 18h6M15 18h5"
                stroke={palette.accent}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
              <Circle cx={10.5} cy={6} r={2.2} stroke={palette.accent} strokeWidth={1.8} />
              <Circle cx={15.5} cy={12} r={2.2} stroke={palette.accent} strokeWidth={1.8} />
              <Circle cx={12.5} cy={18} r={2.2} stroke={palette.accent} strokeWidth={1.8} />
            </Svg>
            {isTablet ? (
              <Text
                style={[styles.btnText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                الإعدادات
              </Text>
            ) : null}
          </Pressable>
        </View>
      </Animated.View>

      {visible && themeMenuOpen ? (
        <View style={styles.themePopoverLayer} pointerEvents="box-none">
          <Pressable
            testID="reader-theme-backdrop"
            style={StyleSheet.absoluteFill}
            onPress={() => setThemeMenuOpen(false)}
            accessibilityLabel="إغلاق قائمة المظهر"
          />
          <View
            testID="reader-theme-popover"
            style={[
              styles.themePopover,
              {
                marginTop:
                  (measuredHeaderHeight > 0
                    ? measuredHeaderHeight
                    : Math.max(insets.top, isTablet ? 14 : 12) + 52) + 6,
                marginEnd: isTablet ? 28 : 16,
                backgroundColor: palette.popoverBg,
                borderColor: palette.popoverBorder,
              },
            ]}
          >
            {THEME_OPTIONS.map((opt) => {
              // With a custom pair painting, none of these presets is the active surface — showing
              // a tick on Warraq would claim a theme the page is not using.
              const active = !customColorsActive && palette.id === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  testID={`theme-quick-${opt.id}`}
                  onPress={() => {
                    onSelectTheme?.(opt.id);
                    setThemeMenuOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.themePopoverItem,
                    active && { backgroundColor: palette.accentSoft },
                    pressed && { opacity: 0.78 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={opt.labelAr}
                  accessibilityState={{ selected: active }}
                >
                  <View
                    style={[
                      styles.themePopoverCircle,
                      {
                        backgroundColor: opt.bg,
                        borderColor: active ? palette.accent : palette.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.themePopoverInnerDot,
                        { backgroundColor: active ? opt.accent : opt.text },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.themePopoverLabel,
                      {
                        color: active ? palette.accent : palette.text,
                        fontWeight: active ? '700' : '500',
                        fontFamily: TYPOGRAPHY.uiFont,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {opt.labelAr}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

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
              ellipsizeMode="tail"
            >
              {chapterTitle}
            </Text>
            <Text
              testID="reader-page-counter"
              numberOfLines={1}
              style={[
                styles.pageCounter,
                { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              {readingMode === 'scroll'
                ? `الفصل ${Math.round(Math.max(0, Math.min(1, chapterProgress ?? 0)) * 100)}%`
                : `صفحة ${page} من ${estimated ? '~' : ''}${pageCount}`}
            </Text>
          </View>

          <PageScrubber
            page={page}
            pageCount={pageCount}
            dir={dir}
            theme={theme}
            tokens={tokens}
            onSeekPage={onSeekPage}
            timelineChapters={timelineChapters}
            timelineSegments={timelineSegments}
            timelineMarkers={timelineMarkers}
          />

          <View style={styles.footerSubRow}>
            <Text style={[styles.subText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {chapterCount ? `${chapterCount} فصول` : 'القراءة الحالية'}
            </Text>
            {isBookmarked ? (
              <Text style={[styles.subText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                الصفحة محفوظة بالشريطة
              </Text>
            ) : null}
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
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'right',
  },
  pageCounter: {
    flexShrink: 0,
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
  themeBtnSwatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeBtnDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  themePopoverLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    zIndex: 30,
  },
  themePopover: {
    minWidth: 184,
    borderRadius: 10,
    borderWidth: 1,
    padding: 6,
    gap: 2,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.24)',
  },
  themePopoverItem: {
    minHeight: 42,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themePopoverCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themePopoverInnerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  themePopoverLabel: {
    fontSize: 13.5,
    textAlign: 'right',
  },
});
