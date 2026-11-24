import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { READER_FONT_FAMILIES } from '@/storage/settings-store';
import { FONT_LABELS_AR, RADIUS, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens, THEME_OPTIONS, type AppThemeTokens } from '@/theme/reader-theme';
import type { IndentMode, ReaderSettings, TextAlignMode } from '@/types/reader';

export type ReaderSettingsSheetProps = {
  visible: boolean;
  settings: ReaderSettings;
  onChange: (partial: Partial<ReaderSettings>) => void;
  onReset?: () => void;
  onClose: () => void;
};

type SettingsTabId = 'font' | 'layout' | 'theme';

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

const DIR_OPTIONS: ReadonlyArray<{ value: 'auto' | 'rtl' | 'ltr'; label: string }> = [
  { value: 'auto', label: 'تلقائي' },
  { value: 'rtl', label: 'RTL' },
  { value: 'ltr', label: 'LTR' },
];

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
      <Text style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
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
          hitSlop={6}
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
          hitSlop={6}
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
  onClose,
}: {
  settings: ReaderSettings;
  palette: AppThemeTokens;
  isSidePanel: boolean;
  onChange: (partial: Partial<ReaderSettings>) => void;
  onReset?: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('font');
  const sectionOffsets = useRef<Record<SettingsTabId, number>>({
    font: 0,
    layout: 0,
    theme: 0,
  });
  const scrollRef = useRef<{ scrollTo: (opts: { y?: number; animated?: boolean }) => void } | null>(
    null,
  );

  const jumpToSection = (tab: SettingsTabId) => {
    setActiveTab(tab);
    const y = sectionOffsets.current[tab] ?? 0;
    scrollRef.current?.scrollTo({ y, animated: true });
  };

  const ScrollContainer = isSidePanel ? ScrollView : BottomSheetScrollView;

  return (
    <View style={styles.innerWrap}>
      {/* Header with Warraq section tabs + Reset + Close */}
      <View style={[styles.sheetHead, { borderBottomColor: palette.border }]}>
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
                style={[
                  styles.sheetTab,
                  active && { borderBottomColor: palette.accent },
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
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
              onPress={onReset}
              hitSlop={8}
              style={({ pressed }) => [
                styles.resetBtn,
                { backgroundColor: palette.chipBg, borderColor: palette.border },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.resetBtnText,
                  { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                افتراضي
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            testID="settings-close-button"
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [
              styles.closeBtn,
              pressed && { backgroundColor: palette.surface },
            ]}
            accessibilityRole="button"
            accessibilityLabel="إغلاق الإعدادات"
          >
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
              <Path
                d="M18 6L6 18M6 6l12 12"
                stroke={palette.muted}
                strokeWidth={1.9}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
        </View>
      </View>

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
        contentContainerStyle={[
          styles.sheetBody,
          { paddingBottom: (isSidePanel ? 18 : Math.max(insets.bottom, 16)) + 12 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1: Font */}
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

          <View style={styles.ctrlRow}>
            <Text style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              وزن الخط
            </Text>
            <View
              style={[
                styles.segGroup,
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
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
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
            valueText={`${settings.wordSpacing}px`}
            testIdPrefix="settings-word-spacing"
            canDecrement={settings.wordSpacing > -2}
            canIncrement={settings.wordSpacing < 16}
            onDecrement={() => onChange({ wordSpacing: Math.max(-2, settings.wordSpacing - 1) })}
            onIncrement={() => onChange({ wordSpacing: Math.min(16, settings.wordSpacing + 1) })}
            palette={palette}
          />

          <StepperControl
            label="تباعد الفقرات"
            valueText={`${settings.paragraphSpacing}px`}
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
        </View>

        {/* Section 2: Layout */}
        <View
          style={[styles.section, styles.sectionDivider, { borderTopColor: palette.border }]}
          onLayout={(e) => {
            sectionOffsets.current.layout = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            تنسيق الصفحة
          </Text>

          <View style={styles.ctrlRow}>
            <Text style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              المحاذاة
            </Text>
            <View
              style={[
                styles.segGroup,
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
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
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

          <View style={styles.ctrlRow}>
            <Text style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              الفقرات
            </Text>
            <View
              style={[
                styles.segGroup,
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
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
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
            valueText={`${settings.marginHorizontal}px`}
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
            valueText={`${settings.marginVertical}px`}
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
            valueText={`${settings.maxReadingWidth}ch`}
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

          <View style={styles.ctrlRow}>
            <Text style={[styles.ctrlLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              اتجاه النص
            </Text>
            <View
              style={[
                styles.segGroup,
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
                    style={({ pressed }) => [
                      styles.segBtn,
                      active && { backgroundColor: palette.ctaBg },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
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

        {/* Section 3: Theme (Data-driven from THEME_OPTIONS) */}
        <View
          style={[styles.section, styles.sectionDivider, { borderTopColor: palette.border }]}
          onLayout={(e) => {
            sectionOffsets.current.theme = e.nativeEvent.layout.y;
          }}
        >
          <Text style={[styles.sectionTitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            المظهر
          </Text>
          <View style={isSidePanel ? styles.themeGridSide : styles.themeGrid}>
            {THEME_OPTIONS.map((t) => {
              const active = settings.theme === t.id;
              return (
                <Pressable
                  key={t.id}
                  testID={`theme-option-${t.id}`}
                  onPress={() => onChange({ theme: t.id })}
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
        </View>
      </ScrollContainer>
    </View>
  );
}

export function ReaderSettingsSheet({
  visible,
  settings,
  onChange,
  onReset,
  onClose,
}: ReaderSettingsSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const palette = getAppThemeTokens(settings.theme);
  const snapPoints = useMemo(() => ['35%', '65%'], []);
  const isSidePanel = layout.settingsMode === 'side-panel';

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
              maxHeight: Math.max(320, layout.height - 120),
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
            onClose={onClose}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host} pointerEvents="box-none" testID="reader-settings-sheet-host">
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
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
          onClose={onClose}
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
    paddingVertical: 10,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  sheetTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  headActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
    textAlign: 'right',
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
  ctrlLabel: {
    fontSize: 12,
    minWidth: 74,
    textAlign: 'right',
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
    minWidth: 46,
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
  segBtn: {
    flex: 1,
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
    paddingTop: 10,
    borderTopWidth: 1,
  },
  switchLabel: {
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
    textAlign: 'right',
  },
  swatchContrast: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.72,
  },
});
