import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { READER_FONT_FAMILIES } from '@/storage/settings-store';
import { getAppThemeTokens, THEME_OPTIONS } from '@/theme/reader-theme';
import type { IndentMode, ReaderSettings, TextAlignMode } from '@/types/reader';

export type ReaderSettingsSheetProps = {
  visible: boolean;
  settings: ReaderSettings;
  onChange: (partial: Partial<ReaderSettings>) => void;
  onReset?: () => void;
  onClose: () => void;
};

const FONT_WEIGHT_OPTIONS = [300, 400, 500, 600] as const;

const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlignMode; label: string }> = [
  { value: 'justify', label: 'ضبط' },
  { value: 'start', label: 'بداية' },
];

const INDENT_OPTIONS: ReadonlyArray<{ value: IndentMode; label: string }> = [
  { value: 'classic', label: 'كلاسيكي' },
  { value: 'block', label: 'كتلة' },
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
  palette: ReturnType<typeof getAppThemeTokens>;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.controlLabel, { color: palette.text }]}>{label}</Text>
      <View style={styles.stepperGroup}>
        <Pressable
          testID={`${testIdPrefix}-dec`}
          onPress={onDecrement}
          disabled={!canDecrement}
          hitSlop={6}
          style={({ pressed }) => [
            styles.stepBtn,
            { backgroundColor: palette.chipBg, borderColor: palette.chipBorder },
            !canDecrement && styles.stepDisabled,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`إنقاص ${label}`}
        >
          <Text style={[styles.stepBtnText, { color: palette.text }]}>−</Text>
        </Pressable>

        <Text
          testID={`${testIdPrefix}-value`}
          style={[styles.stepValue, { color: palette.text }]}
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
            { backgroundColor: palette.chipBg, borderColor: palette.chipBorder },
            !canIncrement && styles.stepDisabled,
            pressed && styles.pressed,
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

export function ReaderSettingsSheet({
  visible,
  settings,
  onChange,
  onReset,
  onClose,
}: ReaderSettingsSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(settings.theme);
  const snapPoints = useMemo(() => ['35%', '65%'], []);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  if (!visible) {
    return null;
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
        <BottomSheetScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 16) + 12 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
            <Text style={[styles.sheetTitle, { color: palette.text }]}>إعدادات القراءة</Text>
            <View style={styles.headerActions}>
              {onReset ? (
                <Pressable
                  testID="settings-reset-button"
                  onPress={onReset}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.headerBtn,
                    { backgroundColor: palette.chipBg },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.headerBtnText, { color: palette.muted }]}>افتراضي</Text>
                </Pressable>
              ) : null}
              <Pressable
                testID="settings-close-button"
                onPress={onClose}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.headerBtn,
                  { backgroundColor: palette.chipActiveBg },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="إغلاق الإعدادات"
              >
                <Text style={[styles.headerBtnText, { color: palette.accent }]}>تم</Text>
              </Pressable>
            </View>
          </View>

          {/* Theme */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.muted }]}>الثيم</Text>
            <View style={styles.chipWrap}>
              {THEME_OPTIONS.map((t) => {
                const active = settings.theme === t.id;
                return (
                  <Pressable
                    key={t.id}
                    testID={`theme-option-${t.id}`}
                    onPress={() => onChange({ theme: t.id })}
                    style={({ pressed }) => [
                      styles.themeChip,
                      {
                        backgroundColor: t.bg,
                        borderColor: active ? palette.accent : palette.chipBorder,
                        borderWidth: active ? 2 : 1,
                      },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.themeChipText, { color: t.text }]}>{t.labelAr}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Font Family */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.muted }]}>الخط</Text>
            <View style={styles.chipWrap}>
              {READER_FONT_FAMILIES.map((font) => {
                const active = settings.fontFamily === font;
                return (
                  <Pressable
                    key={font}
                    testID={`font-option-${font}`}
                    onPress={() => onChange({ fontFamily: font })}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: active ? palette.chipActiveBg : palette.chipBg,
                        borderColor: active ? palette.accent : palette.chipBorder,
                      },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? palette.accent : palette.text },
                      ]}
                    >
                      {font}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Typography Steppers */}
          <View style={styles.section}>
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

          {/* Font Weight */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.muted }]}>وزن الخط</Text>
            <View style={styles.segmentedRow}>
              {FONT_WEIGHT_OPTIONS.map((w) => {
                const active = settings.fontWeight === w;
                return (
                  <Pressable
                    key={w}
                    testID={`settings-weight-${w}`}
                    onPress={() => onChange({ fontWeight: w })}
                    style={({ pressed }) => [
                      styles.segmentBtn,
                      {
                        backgroundColor: active ? palette.chipActiveBg : palette.chipBg,
                        borderColor: active ? palette.accent : palette.chipBorder,
                      },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? palette.accent : palette.text },
                      ]}
                    >
                      {w}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Align & Indent */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.muted }]}>المحاذاة والفقرة</Text>
            <View style={styles.segmentedRow}>
              {ALIGN_OPTIONS.map((opt) => {
                const active = settings.textAlign === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-align-${opt.value}`}
                    onPress={() => onChange({ textAlign: opt.value })}
                    style={({ pressed }) => [
                      styles.segmentBtn,
                      {
                        backgroundColor: active ? palette.chipActiveBg : palette.chipBg,
                        borderColor: active ? palette.accent : palette.chipBorder,
                      },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? palette.accent : palette.text },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.segmentedRow}>
              {INDENT_OPTIONS.map((opt) => {
                const active = settings.indentMode === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-indent-${opt.value}`}
                    onPress={() => onChange({ indentMode: opt.value })}
                    style={({ pressed }) => [
                      styles.segmentBtn,
                      {
                        backgroundColor: active ? palette.chipActiveBg : palette.chipBg,
                        borderColor: active ? palette.accent : palette.chipBorder,
                      },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? palette.accent : palette.text },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Margins & Reading Width */}
          <View style={styles.section}>
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
          </View>

          {/* Direction Override */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: palette.muted }]}>اتجاه النص</Text>
            <View style={styles.segmentedRow}>
              {DIR_OPTIONS.map((opt) => {
                const active = (settings.dirOverride ?? 'auto') === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    testID={`settings-dir-${opt.value}`}
                    onPress={() => onChange({ dirOverride: opt.value })}
                    style={({ pressed }) => [
                      styles.segmentBtn,
                      {
                        backgroundColor: active ? palette.chipActiveBg : palette.chipBg,
                        borderColor: active ? palette.accent : palette.chipBorder,
                      },
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: active ? palette.accent : palette.text },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Disable Animation (E-ink) */}
          <View style={[styles.switchRow, { borderTopColor: palette.border }]}>
            <Text style={[styles.controlLabel, { color: palette.text }]}>
              تقليب من غير أنيميشن
            </Text>
            <Switch
              testID="settings-disable-animation-switch"
              value={settings.disableAnimation}
              onValueChange={(value) => onChange({ disableAnimation: value })}
              trackColor={{ false: palette.chipBorder, true: palette.accent }}
              thumbColor={palette.popoverBg}
            />
          </View>
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    zIndex: 35,
  },
  sheetBackground: {
    borderTopWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  themeChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepBtn: {
    width: 38,
    height: 36,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  stepValue: {
    minWidth: 48,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  stepDisabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.72,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
  },
});
