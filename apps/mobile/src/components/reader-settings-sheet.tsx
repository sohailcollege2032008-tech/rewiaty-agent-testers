import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  I18nManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemeEncyclopediaModal } from '@/components/theme-encyclopedia-modal';
import { DEFAULT_SETTINGS, READER_FONT_FAMILIES, type SettingsTabId } from '@/storage/settings-store';
import { buildCustomAppTheme } from '@/theme/custom-theme';
import { FONT_LABELS_AR, RADIUS, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens, THEME_OPTIONS, type AppThemeTokens } from '@/theme/reader-theme';
import { toArabicDigits } from '@/theme/themes/build-theme';
import {
  DEFAULT_CUSTOM_COLORS,
  type IndentMode,
  type ReadingFocusMode,
  type ReadingMode,
  type ReaderSettings,
  type TashkeelMode,
  type TextAlignMode,
  type ThemeId,
} from '@/types/reader';

/**
 * F33 — what the engine reported about the reading focus. `currentIndex` is 1-based among the
 * paragraphs the visible page gave the engine to choose from.
 */
export type ReadingFocusStatus = {
  mode: ReadingFocusMode;
  currentIndex: number | null;
  blockCount: number;
};

export type ReaderSettingsSheetProps = {
  visible: boolean;
  settings: ReaderSettings;
  onChange: (partial: Partial<ReaderSettings>) => void;
  onReset?: (tab: SettingsTabId) => void;
  /** F32: opens the custom-colours picker (the modal lives on the reader screen). */
  onOpenCustomColors?: () => void;
  /** F33: the engine's live answer — which paragraph is on the reading line right now. */
  readingFocusStatus?: ReadingFocusStatus | null;
  onClose: () => void;
};

/**
 * Breathing room under the last settings row: 28px on top of the bottom safe-area inset.
 * The sheet container is also raised by `bottomInset`, so on a phone the last row («السطوع»)
 * ends clear of both the navigation bar and the sheet's own bottom edge.
 */
const SETTINGS_SCROLL_BOTTOM_SPACING = 28;

const FONT_WEIGHT_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 300, label: 'خفيف' },
  { value: 400, label: 'عادي' },
  { value: 500, label: 'متوسط' },
  { value: 600, label: 'داكن' },
];

const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlignMode; label: string }> = [
  { value: 'justify', label: 'ضبط الحواف' },
  { value: 'start', label: 'محاذاة البداية' },
];

const INDENT_OPTIONS: ReadonlyArray<{ value: IndentMode; label: string }> = [
  { value: 'classic', label: 'كلاسيكي بمسافة' },
  { value: 'block', label: 'فقرات منفصلة' },
];

/** F18 — أوضاع التشكيل: كامل (الافتراضي) / بدون / شدّة وتنوين بس. */
const TASHKEEL_OPTIONS: ReadonlyArray<{ value: TashkeelMode; label: string }> = [
  { value: 'full', label: 'كامل' },
  { value: 'none', label: 'بدون' },
  { value: 'shadda-tanween', label: 'شدّة وتنوين' },
];

const DIR_OPTIONS: ReadonlyArray<{ value: 'auto' | 'rtl' | 'ltr'; label: string }> = [
  { value: 'auto', label: 'تلقائي' },
  { value: 'rtl', label: 'يمين لليسار' },
  { value: 'ltr', label: 'يسار لليمين' },
];

/** F31 — auto theme modes: follow the phone / follow the clock / the reader's hand. */
const AUTO_THEME_OPTIONS: ReadonlyArray<{
  value: 'system' | 'schedule' | 'manual';
  label: string;
}> = [
  { value: 'system', label: 'النظام' },
  { value: 'schedule', label: 'بالوقت' },
  { value: 'manual', label: 'يدوي' },
];

function percentText(ratio: number): string {
  return `${toArabicDigits(String(Math.round((Number.isFinite(ratio) ? ratio : 0) * 100)))}٪`;
}

function formatHourArabic(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  if (h === 0) return '١٢ ص';
  if (h === 12) return '١٢ م';
  if (h < 12) return `${toArabicDigits(String(h))} ص`;
  return `${toArabicDigits(String(h - 12))} م`;
}

function themeLabel(themeId: ThemeId): string {
  return getAppThemeTokens(themeId).labelAr;
}

/** F22 — وضع القراءة: صفحات تتقلّب، أو تمرير رأسي متصل. */
const READING_MODE_OPTIONS: ReadonlyArray<{ value: ReadingMode; label: string }> = [
  { value: 'paginated', label: 'صفحات' },
  { value: 'scroll', label: 'تمرير' },
];

/** F33 — ثلاث حالات لتركيز القراية: إيقاف افتراضي، فقرة منوّرة، أو خط تتبّع. */
const READING_FOCUS_OPTIONS: ReadonlyArray<{ value: ReadingFocusMode; label: string }> = [
  { value: 'off', label: 'إيقاف' },
  { value: 'paragraph', label: 'تركيز الفقرة' },
  { value: 'ruler', label: 'مسطرة التتبع' },
];

// Why (P2 #60): under React Native `I18nManager.forceRTL(true)`, `textAlign: 'right'` mirrors
// to the physical LEFT edge while `'left'` maps to START (physical RIGHT). Computing the
// start-aligned value from `I18nManager.isRTL` keeps Arabic headings flush-right in both RTL
// and non-RTL runtimes.
const RTL_START_ALIGN: 'left' | 'right' = I18nManager.isRTL ? 'left' : 'right';

function StepperControl({
  label,
  valueText,
  testIdPrefix,
  onDecrement,
  onIncrement,
  canDecrement,
  canIncrement,
  palette,
}: {
  label: string;
  valueText: string;
  testIdPrefix: string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement: boolean;
  canIncrement: boolean;
  palette: AppThemeTokens;
}) {
  return (
    <View style={styles.ctrlRow}>
      <Text
        style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {label}
      </Text>
      <View
        style={[
          styles.stepper,
          {
            borderColor: palette.border,
            backgroundColor: palette.surfaceElevated,
          },
        ]}
      >
        <Pressable
          testID={`${testIdPrefix}-dec`}
          onPress={onDecrement}
          disabled={!canDecrement}
          hitSlop={{ top: 9, bottom: 9, left: 6, right: 6 }}
          style={({ pressed }) => [
            styles.stepBtn,
            !canDecrement && styles.stepDisabled,
            pressed && { backgroundColor: palette.accentSoft },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`إنقاص ${label}`}
        >
          <Text style={[styles.stepBtnText, { color: palette.text }]}>−</Text>
        </Pressable>

        <Text
          testID={`${testIdPrefix}-value`}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[
            styles.stepReadout,
            {
              color: palette.text,
              borderColor: palette.border,
              fontFamily: TYPOGRAPHY.uiFont,
            },
          ]}
        >
          {valueText}
        </Text>

        <Pressable
          testID={`${testIdPrefix}-inc`}
          onPress={onIncrement}
          disabled={!canIncrement}
          hitSlop={{ top: 9, bottom: 9, left: 6, right: 6 }}
          style={({ pressed }) => [
            styles.stepBtn,
            !canIncrement && styles.stepDisabled,
            pressed && { backgroundColor: palette.accentSoft },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`زيادة ${label}`}
        >
          <Text style={[styles.stepBtnText, { color: palette.text }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SettingsContent({
  settings,
  palette,
  isSidePanel,
  onChange,
  onReset,
  onOpenCustomColors,
  readingFocusStatus,
}: {
  settings: ReaderSettings;
  palette: AppThemeTokens;
  isSidePanel: boolean;
  onChange: (partial: Partial<ReaderSettings>) => void;
  onReset?: (tab: SettingsTabId) => void;
  onOpenCustomColors?: () => void;
  readingFocusStatus?: ReadingFocusStatus | null;
}) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const stackControlRow = fontScale > 1.35;
  const [activeTab, setActiveTab] = useState<SettingsTabId>('font');
  const [encyclopediaVisible, setEncyclopediaVisible] = useState(false);
  const sectionOffsets = useRef<Record<SettingsTabId, number>>({
    font: 0,
    layout: 0,
    theme: 0,
  });
  const scrollRef = useRef<{ scrollTo: (opts: { y?: number; animated?: boolean }) => void } | null>(
    null,
  );

  // Why (product): each tab shows only its own section. Scrolling to a section did nothing at the 35% snap
  // (@gorhom/bottom-sheet locks content scroll below the top snap point), so the Theme tab lit up while
  // the Font section stayed on screen — found by the settings-live Maestro flow on CI.
  const jumpToSection = (tab: SettingsTabId) => {
    setActiveTab(tab);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const ScrollContainer = isSidePanel ? ScrollView : BottomSheetScrollView;
  // F32: the sheet mirrors the stored pair, so the theme tab can show what is currently painting.
  const customColors = settings.customColors ?? DEFAULT_CUSTOM_COLORS;
  const customColorsActive = customColors.enabled;

  return (
    <ScrollContainer
      ref={(node: unknown) => {
        if (
          node &&
          typeof (node as { scrollTo?: (opts: { y?: number; animated?: boolean }) => void })
            .scrollTo === 'function'
        ) {
          scrollRef.current = node as {
            scrollTo: (opts: { y?: number; animated?: boolean }) => void;
          };
        }
      }}
      testID="settings-scroll"
      stickyHeaderIndices={[0]}
      contentContainerStyle={{
        // The bottom sheet is raised above the nav bar by `bottomInset` (see ReaderSettingsSheet),
        // and the padding is still inset-derived on purpose: on a device that cannot raise the
        // container the last row must stay scrollable above the bar instead of dying under it.
        paddingBottom: SETTINGS_SCROLL_BOTTOM_SPACING + Math.max(insets.bottom, 20),
      }}
      showsVerticalScrollIndicator
      persistentScrollbar
    >
      {/* Header with Warraq section tabs + Reset + Close */}
      <View
        style={[
          styles.sheetHead,
          { backgroundColor: palette.sheetBg, borderBottomColor: palette.border },
        ]}
      >
        <View style={styles.tabsRow}>
          {(
            [
              { id: 'font', label: 'الخط' },
              { id: 'layout', label: 'الصفحة' },
              { id: 'theme', label: 'المظهر' },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                testID={`settings-tab-${tab.id}`}
                onPress={() => jumpToSection(tab.id)}
                hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
                style={[
                  styles.sheetTab,
                  active && { borderBottomColor: palette.accent },
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  style={[
                    styles.sheetTabText,
                    {
                      color: active ? palette.accent : palette.muted,
                      fontFamily: TYPOGRAPHY.uiFont,
                    },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.headActions}>
          {onReset ? (
            <Pressable
              testID="settings-reset-button"
              onPress={() => onReset(activeTab)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              style={({ pressed }) => [
                styles.resetBtn,
                { backgroundColor: palette.chipBg, borderColor: palette.border },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`إرجاع إعدادات ${activeTab === 'font' ? 'الخط' : activeTab === 'layout' ? 'الصفحة' : 'المظهر'} للافتراضي`}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                style={[
                  styles.resetBtnText,
                  { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                افتراضي
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.sheetBody}>
        {/* Section 1: Font */}
        {activeTab === 'font' ? (
        <View
          style={styles.section}
          onLayout={(e) => {
            sectionOffsets.current.font = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            نوع الخط
          </Text>
          <View style={styles.chipWrap}>
            {READER_FONT_FAMILIES.map((font) => {
              const active = settings.fontFamily === font;
              return (
                <Pressable
                  key={font}
                  testID={`font-option-${font}`}
                  onPress={() => onChange({ fontFamily: font })}
                  hitSlop={{ top: 7, bottom: 7, left: 2, right: 2 }}
                  style={({ pressed }) => [
                    styles.fontChip,
                    {
                      backgroundColor: active ? palette.accentSoft : palette.surface,
                      borderColor: active ? palette.accent : palette.border,
                    },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    style={[
                      styles.fontChipText,
                      {
                        color: active ? palette.accent : palette.text,
                        fontWeight: active ? '600' : '400',
                      },
                    ]}
                  >
                    {FONT_LABELS_AR[font] ?? font}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <StepperControl
            label="حجم الخط"
            valueText={`${settings.fontSize}`}
            testIdPrefix="settings-font-size"
            canDecrement={settings.fontSize > 14}
            canIncrement={settings.fontSize < 36}
            onDecrement={() => onChange({ fontSize: Math.max(14, settings.fontSize - 1) })}
            onIncrement={() => onChange({ fontSize: Math.min(36, settings.fontSize + 1) })}
            palette={palette}
          />

          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              وزن الخط
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {FONT_WEIGHT_OPTIONS.map((w) => {
                const active = settings.fontWeight === w.value;
                return (
                  <Pressable
                    key={w.value}
                    testID={`settings-weight-${w.value}`}
                    onPress={() => onChange({ fontWeight: w.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {w.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <StepperControl
            label="تباعد الأسطر"
            valueText={settings.lineHeight.toFixed(2)}
            testIdPrefix="settings-line-height"
            canDecrement={settings.lineHeight > 1.5}
            canIncrement={settings.lineHeight < 2.6}
            onDecrement={() =>
              onChange({
                lineHeight: Math.max(1.5, Number((settings.lineHeight - 0.05).toFixed(2))),
              })
            }
            onIncrement={() =>
              onChange({
                lineHeight: Math.min(2.6, Number((settings.lineHeight + 0.05).toFixed(2))),
              })
            }
            palette={palette}
          />

          <StepperControl
            label="تباعد الكلمات"
            valueText={`${settings.wordSpacing} نقطة`}
            testIdPrefix="settings-word-spacing"
            canDecrement={settings.wordSpacing > -2}
            canIncrement={settings.wordSpacing < 16}
            onDecrement={() => onChange({ wordSpacing: Math.max(-2, settings.wordSpacing - 1) })}
            onIncrement={() => onChange({ wordSpacing: Math.min(16, settings.wordSpacing + 1) })}
            palette={palette}
          />

          <StepperControl
            label="تباعد الفقرات"
            valueText={`${settings.paragraphSpacing} نقطة`}
            testIdPrefix="settings-paragraph-spacing"
            canDecrement={settings.paragraphSpacing > 0}
            canIncrement={settings.paragraphSpacing < 28}
            onDecrement={() =>
              onChange({ paragraphSpacing: Math.max(0, settings.paragraphSpacing - 2) })
            }
            onIncrement={() =>
              onChange({ paragraphSpacing: Math.min(28, settings.paragraphSpacing + 2) })
            }
            palette={palette}
          />

          {/* F18 — أوضاع التشكيل: بيتنفّذ جوه المحرك وقت العرض على text nodes بس، ومفيش
              span بيتحط جوه الكلمة علشان التشبيك العربي ميتكسرش. */}
          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              التشكيل
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {TASHKEEL_OPTIONS.map((opt) => {
                const active = settings.tashkeel === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-tashkeel-${opt.value}`}
                    onPress={() => onChange({ tashkeel: opt.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        ) : null}
        {/* Section 2: Layout */}
        {activeTab === 'layout' ? (
        <View
          style={styles.section}
          onLayout={(e) => {
            sectionOffsets.current.layout = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            تنسيق الصفحة
          </Text>

          {/* F22 — «وضع القراءة»: الصفحات المقلوبة أو التمرير المتصل. */}
          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              وضع القراءة
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {READING_MODE_OPTIONS.map((opt) => {
                const active = (settings.readingMode ?? 'paginated') === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-reading-mode-${opt.value}`}
                    onPress={() => onChange({ readingMode: opt.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {settings.readingMode === 'scroll' ? (
            <View style={[styles.switchRow, { borderTopColor: palette.border }]}>
              <Text
                style={[styles.switchLabel, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                شريط التقدم العلوي
              </Text>
              <Switch
                testID="settings-scroll-progress-switch"
                value={settings.showScrollProgressBar !== false}
                onValueChange={(value) => onChange({ showScrollProgressBar: value })}
                trackColor={{ false: palette.border, true: palette.accent }}
                thumbColor={palette.surfaceElevated}
              />
            </View>
          ) : null}

          {/* F33 — «تركيز القراءة»: إيقاف / تركيز الفقرة / مسطرة التتبع. */}
          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              تركيز القراءة
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {READING_FOCUS_OPTIONS.map((opt) => {
                const active = (settings.readingFocus ?? 'off') === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-reading-focus-${opt.value}`}
                    onPress={() => onChange({ readingFocus: opt.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/*
            F33 — what the engine really focused, bridged from the WebView. Seeing «الفقرة المضيئة
            ٢ من ١١» (and it moving on the next page) is the difference between a saved toggle and
            an effect that is actually working.
          */}
          {(settings.readingFocus ?? 'off') !== 'off' && readingFocusStatus?.currentIndex ? (
            <Text
              testID="reading-focus-engine-status"
              style={[styles.focusStatus, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              {readingFocusStatus.mode === 'ruler'
                ? `خط التتبع · الفقرة ${toArabicDigits(String(readingFocusStatus.currentIndex))} من ${toArabicDigits(String(readingFocusStatus.blockCount))}`
                : `الفقرة المضيئة ${toArabicDigits(String(readingFocusStatus.currentIndex))} من ${toArabicDigits(String(readingFocusStatus.blockCount))}`}
            </Text>
          ) : null}

          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              المحاذاة
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {ALIGN_OPTIONS.map((opt) => {
                const active = settings.textAlign === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-align-${opt.value}`}
                    onPress={() => onChange({ textAlign: opt.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              الفقرات
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {INDENT_OPTIONS.map((opt) => {
                const active = settings.indentMode === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-indent-${opt.value}`}
                    onPress={() => onChange({ indentMode: opt.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <StepperControl
            label="الهامش الأفقي"
            valueText={`${settings.marginHorizontal} نقطة`}
            testIdPrefix="settings-margin-h"
            canDecrement={settings.marginHorizontal > 8}
            canIncrement={settings.marginHorizontal < 48}
            onDecrement={() =>
              onChange({ marginHorizontal: Math.max(8, settings.marginHorizontal - 4) })
            }
            onIncrement={() =>
              onChange({ marginHorizontal: Math.min(48, settings.marginHorizontal + 4) })
            }
            palette={palette}
          />

          <StepperControl
            label="الهامش العمودي"
            valueText={`${settings.marginVertical} نقطة`}
            testIdPrefix="settings-margin-v"
            canDecrement={settings.marginVertical > 16}
            canIncrement={settings.marginVertical < 48}
            onDecrement={() =>
              onChange({ marginVertical: Math.max(16, settings.marginVertical - 4) })
            }
            onIncrement={() =>
              onChange({ marginVertical: Math.min(48, settings.marginVertical + 4) })
            }
            palette={palette}
          />

          <StepperControl
            label="عرض السطر"
            valueText={`${settings.maxReadingWidth} حرف`}
            testIdPrefix="settings-max-width"
            canDecrement={settings.maxReadingWidth > 45}
            canIncrement={settings.maxReadingWidth < 85}
            onDecrement={() =>
              onChange({ maxReadingWidth: Math.max(45, settings.maxReadingWidth - 5) })
            }
            onIncrement={() =>
              onChange({ maxReadingWidth: Math.min(85, settings.maxReadingWidth + 5) })
            }
            palette={palette}
          />

          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              اتجاه النص
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {DIR_OPTIONS.map((opt) => {
                const active = (settings.dirOverride ?? 'auto') === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-dir-${opt.value}`}
                    onPress={() => onChange({ dirOverride: opt.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={[styles.switchRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.switchLabel, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
              تقليب بلا حركة (حبر إلكتروني)
            </Text>
            <Switch
              testID="settings-disable-animation-switch"
              value={settings.disableAnimation}
              onValueChange={(value) => onChange({ disableAnimation: value })}
              trackColor={{ false: palette.border, true: palette.accent }}
              thumbColor={palette.surfaceElevated}
            />
          </View>
        </View>
        ) : null}
        {/* Section 3: Theme (F31 — core 4 + «موسوعة الثيمات» + الإضاءة وراحة العين) */}
        {activeTab === 'theme' ? (
        <View
          style={styles.section}
          onLayout={(e) => {
            sectionOffsets.current.theme = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            المظهر
          </Text>
          <View style={isSidePanel ? styles.themeGridSide : styles.themeGrid}>
            {THEME_OPTIONS.map((t) => {
              const active = settings.theme === t.id && !customColorsActive;
              return (
                <Pressable
                  key={t.id}
                  testID={`theme-option-${t.id}`}
                  // F32: picking a preset always wins immediately — a lingering custom pair would
                  // otherwise keep painting over the swatch the reader just tapped. With no custom
                  // pair live, the partial stays exactly `{ theme }` as before.
                  onPress={() =>
                    onChange(
                      customColorsActive
                        ? { theme: t.id, customColors: { ...customColors, enabled: false } }
                        : { theme: t.id },
                    )
                  }
                  hitSlop={4}
                  style={({ pressed }) => [
                    isSidePanel ? styles.themeSwatchSide : styles.themeSwatch,
                    {
                      backgroundColor: palette.surface,
                      borderColor: active ? palette.accent : palette.border,
                      borderWidth: active ? 1.5 : 1,
                    },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View
                    style={[
                      styles.swatchPreview,
                      {
                        backgroundColor: t.bg,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.swatchPreviewText,
                        { color: t.text, fontFamily: TYPOGRAPHY.displayFont },
                      ]}
                    >
                      ض
                    </Text>
                  </View>
                  <View style={isSidePanel ? styles.swatchMetaSide : styles.swatchMeta}>
                    <Text
                      style={[
                        styles.swatchName,
                        {
                          color: active ? palette.accent : palette.text,
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                    >
                      {t.labelAr}
                    </Text>
                    {isSidePanel ? (
                      <Text
                        style={[
                          styles.swatchContrast,
                          { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                        ]}
                      >
                        {t.contrastLabel}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* F32 — ألوان مخصّصة: المدخل بيفتح الـ picker اللي فيه المعاينة الحيّة وعدّاد التباين. */}
          <Pressable
            testID="open-custom-colors-btn"
            onPress={onOpenCustomColors}
            hitSlop={4}
            style={({ pressed }) => [
              styles.customColorsBtn,
              {
                backgroundColor: palette.surface,
                borderColor: customColorsActive ? palette.accent : palette.border,
                borderWidth: customColorsActive ? 1.5 : 1,
              },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="ألوان مخصّصة للصفحة والنص"
          >
            <View
              testID="open-custom-colors-preview"
              style={[styles.customColorsChip, { backgroundColor: customColors.bg, borderColor: palette.border }]}
            >
              <Text
                numberOfLines={1}
                style={[styles.customColorsChipText, { color: customColors.text, fontFamily: TYPOGRAPHY.displayFont }]}
              >
                أ
              </Text>
            </View>
            <View style={styles.customColorsMeta}>
              <Text
                style={[
                  styles.customColorsTitle,
                  { color: customColorsActive ? palette.accent : palette.text, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                ألوان مخصّصة
              </Text>
              <Text style={[styles.customColorsHint, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                {customColorsActive ? `${customColors.bg} · ${customColors.text}` : 'اختار لون الورق والحبر'}
              </Text>
            </View>
            <Text style={[styles.customColorsState, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {customColorsActive ? 'مفعّلة' : 'تخصيص'}
            </Text>
          </Pressable>

          {/* F31 — «موسوعة الثيمات» above the registry: 13 themes, browsable by mood. */}
          <Pressable
            testID="open-theme-encyclopedia-btn"
            onPress={() => setEncyclopediaVisible(true)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.encyclopediaBtn,
              { backgroundColor: palette.accentSoft, borderColor: palette.border },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="فتح موسوعة الثيمات"
          >
            <Text
              style={[styles.encyclopediaIcon, { color: palette.accent }]}
              accessibilityElementsHidden
            >
              ✦
            </Text>
            <View style={styles.encyclopediaTitles}>
              <Text
                style={[styles.encyclopediaTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                numberOfLines={1}
              >
                موسوعة الثيمات
              </Text>
              <Text
                style={[styles.encyclopediaSub, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                numberOfLines={1}
              >
                ١٣ ثيمًا · حِبْر اللَّيْل أولها
              </Text>
            </View>
            <Text style={[styles.encyclopediaChevron, { color: palette.muted }]}>‹</Text>
          </Pressable>

          {/* F31 — auto theme: النظام | بالوقت | يدوي */}
          <View style={stackControlRow ? styles.ctrlRowStacked : styles.ctrlRow}>
            <Text
              style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              الثيم تلقائيًا
            </Text>
            <View
              style={[
                styles.segGroup,
                stackControlRow && styles.segGroupStacked,
                { borderColor: palette.border, backgroundColor: palette.surface },
              ]}
            >
              {AUTO_THEME_OPTIONS.map((opt) => {
                const active = (settings.autoThemeMode ?? 'system') === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-auto-theme-${opt.value}`}
                    onPress={() => onChange({ autoThemeMode: opt.value })}
                    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      style={[
                        styles.segBtnText,
                        {
                          color: active ? palette.ctaText : palette.muted,
                          fontWeight: active ? '600' : '500',
                          fontFamily: TYPOGRAPHY.uiFont,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {(settings.autoThemeMode ?? 'system') === 'schedule' ? (
            <Text
              testID="settings-auto-theme-info"
              style={[styles.hintText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              {`نهارًا ${themeLabel(settings.dayTheme ?? DEFAULT_SETTINGS.dayTheme!)} من ${formatHourArabic(
                settings.nightEndHour ?? DEFAULT_SETTINGS.nightEndHour!,
              )} · ليلًا ${themeLabel(settings.nightTheme ?? DEFAULT_SETTINGS.nightTheme!)} من ${formatHourArabic(
                settings.nightStartHour ?? DEFAULT_SETTINGS.nightStartHour!,
              )}`}
            </Text>
          ) : null}

          {/* F31 — التعتيم: black veil over the page, no CSS filter. */}
          <StepperControl
            label="التعتيم"
            valueText={percentText(settings.dimmer ?? 0)}
            testIdPrefix="settings-dimmer"
            canDecrement={(settings.dimmer ?? 0) > 0}
            canIncrement={(settings.dimmer ?? 0) < 0.7 - 1e-9}
            onDecrement={() =>
              onChange({ dimmer: Math.max(0, Number(((settings.dimmer ?? 0) - 0.1).toFixed(2))) })
            }
            onIncrement={() =>
              onChange({ dimmer: Math.min(0.7, Number(((settings.dimmer ?? 0) + 0.1).toFixed(2))) })
            }
            palette={palette}
          />

          {/* F31 — دفء الشاشة: amber blue-light filter. */}
          <StepperControl
            label="دفء الشاشة"
            valueText={percentText(settings.warmth ?? 0)}
            testIdPrefix="settings-warmth"
            canDecrement={(settings.warmth ?? 0) > 0}
            canIncrement={(settings.warmth ?? 0) < 0.6 - 1e-9}
            onDecrement={() =>
              onChange({ warmth: Math.max(0, Number(((settings.warmth ?? 0) - 0.1).toFixed(2))) })
            }
            onIncrement={() =>
              onChange({ warmth: Math.min(0.6, Number(((settings.warmth ?? 0) + 0.1).toFixed(2))) })
            }
            palette={palette}
          />

          {/* F31 — real screen brightness (expo-brightness). */}
          <StepperControl
            label="السطوع"
            valueText={percentText(settings.brightness ?? 0.8)}
            testIdPrefix="settings-brightness"
            canDecrement={(settings.brightness ?? 0.8) > 0.05 + 1e-9}
            canIncrement={(settings.brightness ?? 0.8) < 1 - 1e-9}
            onDecrement={() =>
              onChange({
                brightness: Math.max(0.05, Number(((settings.brightness ?? 0.8) - 0.05).toFixed(2))),
                brightnessMode: 'custom',
              })
            }
            onIncrement={() =>
              onChange({
                brightness: Math.min(1, Number(((settings.brightness ?? 0.8) + 0.05).toFixed(2))),
                brightnessMode: 'custom',
              })
            }
            palette={palette}
          />

          <View style={[styles.switchRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.switchLabel, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
              سطوع تلقائي (سطوع الجهاز)
            </Text>
            <Switch
              testID="settings-brightness-auto-switch"
              value={(settings.brightnessMode ?? 'system') === 'system'}
              onValueChange={(auto) =>
                onChange({ brightnessMode: auto ? 'system' : 'custom' })
              }
              trackColor={{ false: palette.border, true: palette.accent }}
              thumbColor={palette.surfaceElevated}
            />
          </View>

          <View style={[styles.switchRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.switchLabel, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
              سحب الحافة للسطوع
            </Text>
            <Switch
              testID="settings-edge-swipe-switch"
              value={settings.edgeBrightnessSwipe ?? true}
              onValueChange={(value) => onChange({ edgeBrightnessSwipe: value })}
              trackColor={{ false: palette.border, true: palette.accent }}
              thumbColor={palette.surfaceElevated}
            />
          </View>

          <View style={[styles.switchRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.switchLabel, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
              {`تذكير راحة العين (${toArabicDigits(String(settings.eyeRestIntervalMinutes ?? 45))} د)`}
            </Text>
            <Switch
              testID="settings-eye-rest-switch"
              value={settings.eyeRestReminder ?? true}
              onValueChange={(value) => onChange({ eyeRestReminder: value })}
              trackColor={{ false: palette.border, true: palette.accent }}
              thumbColor={palette.surfaceElevated}
            />
          </View>

          <ThemeEncyclopediaModal
            visible={encyclopediaVisible}
            activeTheme={settings.theme}
            onSelect={(theme) => {
              // Same rule as a preset swatch (F32): choosing a preset ends a live custom pair, so
              // the theme the reader just picked is what actually paints.
              onChange(
                customColorsActive
                  ? { theme, customColors: { ...customColors, enabled: false } }
                  : { theme },
              );
              setEncyclopediaVisible(false);
            }}
            onClose={() => setEncyclopediaVisible(false)}
          />
        </View>
        ) : null}
      </View>
    </ScrollContainer>
  );
}

export function ReaderSettingsSheet({
  visible,
  settings,
  onChange,
  onReset,
  onOpenCustomColors,
  readingFocusStatus,
  onClose,
}: ReaderSettingsSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const basePalette = getAppThemeTokens(settings.theme);
  // F32: with a custom pair live, the sheet itself wears it — the settings should look like the page.
  const palette = settings.customColors?.enabled
    ? buildCustomAppTheme(basePalette, settings.customColors.bg, settings.customColors.text)
    : basePalette;
  const maxSheetHeight = Math.round(layout.height * 0.6);
  const isSidePanel = layout.settingsMode === 'side-panel';

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  useEffect(() => {
    if (isSidePanel) return;
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible, isSidePanel]);

  if (!visible) {
    return null;
  }

  if (isSidePanel) {
    return (
      <View style={styles.host} pointerEvents="box-none" testID="reader-settings-sheet-host">
        <Pressable
          testID="settings-dismiss-backdrop"
          style={styles.sideDismissBackdrop}
          onPress={onClose}
          accessibilityLabel="إغلاق لوحة الإعدادات"
        />
        <View
          testID="reader-settings-side-panel"
          style={[
            styles.sidePanel,
            {
              top: Math.max(insets.top, 16) + 64,
              left: 28,
              width: layout.settingsPanelWidth,
              // Clear the navigation bar as well: the panel hangs from the top and can grow to
              // almost the full window height on tablets.
              maxHeight: Math.max(
                320,
                layout.height - (Math.max(insets.top, 16) + 64) - Math.max(insets.bottom, 16) - 12,
              ),
              backgroundColor: palette.sheetBg,
              borderColor: palette.border,
            },
          ]}
        >
          <SettingsContent
            settings={settings}
            palette={palette}
            isSidePanel
            onChange={onChange}
            onReset={onReset}
            onOpenCustomColors={onOpenCustomColors}
            readingFocusStatus={readingFocusStatus}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host} pointerEvents="box-none" testID="reader-settings-sheet-host">
      <Pressable
        testID="settings-dismiss-backdrop"
        style={styles.sideDismissBackdrop}
        onPress={onClose}
        accessibilityLabel="إغلاق الإعدادات"
      />
      <BottomSheet
        ref={sheetRef}
        index={0}
        // Android 3-button navigation sits on top of an edge-to-edge window: without this the
        // sheet's scroll viewport reaches the screen bottom, so the last rows (دفء الشاشة،
        // السطوع) render under the nav bar and a tap at their centre hits the system buttons.
        // `bottomInset` shortens the sheet's hosting container by exactly the safe-area inset,
        // so the whole scroll area ends above the bar.
        bottomInset={Math.max(insets.bottom, 0)}
        enableDynamicSizing
        maxDynamicContentSize={maxSheetHeight}
        enablePanDownToClose
        onChange={(idx) => {
          if (idx === -1) {
            onClose();
          }
        }}
        backgroundStyle={[
          styles.sheetBackground,
          {
            backgroundColor: palette.sheetBg,
            borderTopColor: palette.border,
          },
        ]}
        handleIndicatorStyle={{ backgroundColor: palette.muted }}
      >
        <SettingsContent
          settings={settings}
          palette={palette}
          isSidePanel={false}
          onChange={onChange}
          onReset={onReset}
          onOpenCustomColors={onOpenCustomColors}
          readingFocusStatus={readingFocusStatus}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 35,
  },
  sideDismissBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  sidePanel: {
    position: 'absolute',
    borderRadius: RADIUS.sheet,
    borderWidth: 1,
    overflow: 'hidden',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.24)',
  },
  sheetBackground: {
    borderTopWidth: 1,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
  },
  innerWrap: {
    flex: 1,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 6,
    borderBottomWidth: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 18,
  },
  sheetTab: {
    minHeight: 36,
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    justifyContent: 'center',
  },
  sheetTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  headActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 6,
  },
  resetBtn: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBody: {
    paddingHorizontal: 18,
    paddingTop: 14,
    gap: 14,
  },
  section: {
    gap: 11,
  },
  sectionDivider: {
    paddingTop: 14,
    borderTopWidth: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: RTL_START_ALIGN,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  fontChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fontChipText: {
    fontSize: 13.5,
  },
  ctrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  ctrlRowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
  },
  ctrlLabel: {
    fontSize: 12,
    minWidth: 74,
    flexShrink: 1,
    textAlign: RTL_START_ALIGN,
  },
  /** F33 — what the engine is focusing right now, under the focus control. */
  focusStatus: {
    fontSize: 11.5,
    textAlign: RTL_START_ALIGN,
    marginTop: -4,
    marginBottom: 6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADIUS.button,
    overflow: 'hidden',
  },
  stepBtn: {
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  stepReadout: {
    minWidth: 58,
    paddingHorizontal: 6,
    textAlign: 'center',
    fontSize: 12.5,
    fontWeight: '600',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    lineHeight: 32,
    fontVariant: ['tabular-nums'],
  },
  stepDisabled: {
    opacity: 0.35,
  },
  segGroup: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: RADIUS.button,
    overflow: 'hidden',
  },
  segGroupStacked: {
    flex: 0,
    width: '100%',
  },
  segBtn: {
    flex: 1,
    minHeight: 32,
    paddingVertical: 7,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnText: {
    fontSize: 12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  switchLabel: {
    flex: 1,
    flexShrink: 1,
    fontSize: 12.5,
    fontWeight: '500',
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeSwatch: {
    width: '48%',
    borderRadius: RADIUS.button,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  themeGridSide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeSwatchSide: {
    width: '48%',
    borderRadius: RADIUS.card,
    padding: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatchPreview: {
    width: 32,
    height: 26,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchPreviewText: {
    fontSize: 13,
    fontWeight: '700',
  },
  swatchMeta: {
    flex: 1,
  },
  swatchMetaSide: {
    flex: 1,
    gap: 1,
  },
  swatchName: {
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: RTL_START_ALIGN,
  },
  swatchContrast: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    textAlign: RTL_START_ALIGN,
  },
  customColorsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: RADIUS.button,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  customColorsChip: {
    width: 34,
    height: 30,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customColorsChipText: {
    fontSize: 14,
    fontWeight: '700',
  },
  customColorsMeta: {
    flex: 1,
    gap: 1,
  },
  customColorsTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  customColorsHint: {
    fontSize: 10.5,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  customColorsState: {
    fontSize: 11,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
  encyclopediaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.button,
    borderWidth: 1,
  },
  encyclopediaIcon: {
    fontSize: 14,
  },
  encyclopediaTitles: {
    flex: 1,
    gap: 1,
  },
  encyclopediaTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  encyclopediaSub: {
    fontSize: 10.5,
    textAlign: 'right',
  },
  encyclopediaChevron: {
    fontSize: 18,
    fontWeight: '600',
  },
  hintText: {
    fontSize: 10.5,
    lineHeight: 16,
    textAlign: 'right',
  },
});
