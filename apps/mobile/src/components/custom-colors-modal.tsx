import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { buildCustomThemeTokens } from '@/theme/custom-theme';
import { getAppThemeTokens } from '@/theme/reader-theme';
import { DEFAULT_CUSTOM_COLORS } from '@/types/reader';
import type { ThemeId } from '@/types/reader';
import {
  WCAG_AA_MIN_RATIO,
  contrastRatio,
  formatContrastRatio,
  normalizeHexColor,
  wcagGrade,
} from '@/theme/wcag';

/** What the picker hands back when the reader taps «تطبيق». Both values are canonical `#RRGGBB`. */
export type CustomColorsSelection = { bg: string; text: string };

export type CustomColorsModalProps = {
  visible: boolean;
  /** The pair the page is painted with right now (enabled or not) — the picker opens on it. */
  initialBg?: string;
  initialText?: string;
  /** The preset theme the picker's own chrome is drawn with, so the dialog stays readable. */
  theme?: ThemeId;
  onApply: (selection: CustomColorsSelection) => void;
  onDisable: () => void;
  onClose: () => void;
};

type Swatch = { hex: string; labelAr: string };

/** Papers and darks — the 12 a reader actually reaches for when setting a reading surface. */
const BG_SWATCHES: readonly Swatch[] = [
  { hex: '#FAF7F0', labelAr: 'ورق دافئ' },
  { hex: '#F3EBD6', labelAr: 'سيبيا' },
  { hex: '#FFFFFF', labelAr: 'أبيض' },
  { hex: '#F4F1E8', labelAr: 'عاجي' },
  { hex: '#EFE9DC', labelAr: 'كتان' },
  { hex: '#E7EDF3', labelAr: 'أزرق فاتح' },
  { hex: '#181310', labelAr: 'ورق محروق' },
  { hex: '#101820', labelAr: 'ليل' },
  { hex: '#12100E', labelAr: 'فحم' },
  { hex: '#1B2420', labelAr: 'أخضر داكن' },
  { hex: '#201A26', labelAr: 'بنفسجي داكن' },
  { hex: '#0B0B0C', labelAr: 'أسود' },
];

/** Inks and pressed charcoals — anything that reads as text on the papers above. */
const TEXT_SWATCHES: readonly Swatch[] = [
  { hex: '#231F1A', labelAr: 'حبر دافئ' },
  { hex: '#382B1E', labelAr: 'سيبيا' },
  { hex: '#0F0F0F', labelAr: 'أسود' },
  { hex: '#3A3A3A', labelAr: 'رمادي غامق' },
  { hex: '#5B4A32', labelAr: 'بني' },
  { hex: '#1F3A5F', labelAr: 'كحلي' },
  { hex: '#2F4B3A', labelAr: 'أخضر' },
  { hex: '#4A2C3A', labelAr: 'نبيتي' },
  { hex: '#C9BFAE', labelAr: 'رمادي فاتح' },
  { hex: '#DECFC0', labelAr: 'عاجي داكن' },
  { hex: '#E6DED3', labelAr: 'رملي' },
  { hex: '#F5F0E6', labelAr: 'أبيض ورق' },
];

/** The live preview sentence: full tashkeel, so the pair is judged on real Arabic type. */
export const CUSTOM_PREVIEW_TEXT = 'كَانَ الْبَحْرُ هَادِئًا تَحْتَ ضَوْءِ الْقَمَرِ، وَالْمَرَاكِبُ تَنَامُ عَلَى مَوْجٍ خَفِيفٍ.';

function swatchTestId(prefix: string, hex: string): string {
  return `${prefix}-${hex.replace('#', '').toLowerCase()}`;
}

function SwatchRow({
  prefix,
  swatches,
  selected,
  onSelect,
  palette,
}: {
  prefix: 'custom-bg' | 'custom-text';
  swatches: readonly Swatch[];
  selected: string;
  onSelect: (hex: string) => void;
  palette: ReturnType<typeof getAppThemeTokens>;
}) {
  return (
    <View style={styles.swatchWrap}>
      {swatches.map((swatch) => {
        const active = normalizeHexColor(selected) === swatch.hex;
        return (
          <Pressable
            key={swatch.hex}
            testID={swatchTestId(prefix, swatch.hex)}
            onPress={() => onSelect(swatch.hex)}
            hitSlop={4}
            style={({ pressed }) => [
              styles.swatch,
              {
                backgroundColor: swatch.hex,
                borderColor: active ? palette.accent : palette.border,
                borderWidth: active ? 2 : 1,
              },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={swatch.labelAr}
            accessibilityState={{ selected: active }}
          >
            {active ? (
              <View
                style={[
                  styles.swatchDot,
                  { backgroundColor: palette.accent, borderColor: palette.surfaceElevated },
                ]}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function HexField({
  testID,
  label,
  value,
  draft,
  onChangeDraft,
  onBlur,
  palette,
}: {
  testID: string;
  label: string;
  value: string;
  draft: string;
  onChangeDraft: (text: string) => void;
  onBlur: () => void;
  palette: ReturnType<typeof getAppThemeTokens>;
}) {
  const valid = normalizeHexColor(draft) !== null;
  return (
    <View style={styles.hexRow}>
      <Text style={[styles.hexLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        {label}
      </Text>
      <TextInput
        testID={testID}
        value={draft}
        onChangeText={onChangeDraft}
        onBlur={onBlur}
        onSubmitEditing={onBlur}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={7}
        placeholder={value}
        placeholderTextColor={palette.muted}
        style={[
          styles.hexInput,
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: valid ? palette.border : palette.danger,
            fontFamily: TYPOGRAPHY.uiFont,
          },
        ]}
        accessibilityLabel={`${label} بصيغة HEX`}
      />
    </View>
  );
}

export function CustomColorsModal({
  visible,
  initialBg = DEFAULT_CUSTOM_COLORS.bg,
  initialText = DEFAULT_CUSTOM_COLORS.text,
  theme,
  onApply,
  onDisable,
  onClose,
}: CustomColorsModalProps) {
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(theme);

  const [bg, setBg] = useState(() => normalizeHexColor(initialBg) ?? DEFAULT_CUSTOM_COLORS.bg);
  const [text, setText] = useState(() => normalizeHexColor(initialText) ?? DEFAULT_CUSTOM_COLORS.text);
  const [bgDraft, setBgDraft] = useState(bg);
  const [textDraft, setTextDraft] = useState(text);

  // Every open starts from the colours the page is actually using — a cancelled edit is dropped.
  useEffect(() => {
    if (!visible) return;
    const nextBg = normalizeHexColor(initialBg) ?? DEFAULT_CUSTOM_COLORS.bg;
    const nextText = normalizeHexColor(initialText) ?? DEFAULT_CUSTOM_COLORS.text;
    setBg(nextBg);
    setText(nextText);
    setBgDraft(nextBg);
    setTextDraft(nextText);
  }, [visible, initialBg, initialText]);

  const tokens = useMemo(() => buildCustomThemeTokens(bg, text), [bg, text]);
  const ratio = useMemo(() => contrastRatio(text, bg), [text, bg]);
  const grade = useMemo(() => wcagGrade(ratio), [ratio]);
  const lowContrast = ratio < WCAG_AA_MIN_RATIO;

  // A gentle warning, not an error: the reader is still allowed to apply a soft pair.
  const badgeAccent = lowContrast ? '#B4761F' : palette.accent;
  const badgeBg = lowContrast ? 'rgba(180, 118, 31, 0.14)' : palette.accentSoft;

  const changeBgDraft = (raw: string) => {
    setBgDraft(raw);
    const normalized = normalizeHexColor(raw);
    if (normalized) setBg(normalized);
  };

  const changeTextDraft = (raw: string) => {
    setTextDraft(raw);
    const normalized = normalizeHexColor(raw);
    if (normalized) setText(normalized);
  };

  const applySwatch = (setter: (hex: string) => void, draftSetter: (hex: string) => void) => (
    hex: string,
  ) => {
    setter(hex);
    draftSetter(hex);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable
          testID="custom-colors-backdrop"
          style={[styles.backdrop, { backgroundColor: palette.scrim }]}
          onPress={onClose}
          accessibilityLabel="إغلاق نافذة الألوان المخصّصة"
        />
        <View
          testID="custom-colors-modal"
          style={[
            styles.card,
            {
              backgroundColor: palette.sheetBg,
              borderColor: palette.border,
              marginBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.head}>
            <Text
              style={[
                styles.title,
                { color: palette.heading ?? palette.text, fontFamily: TYPOGRAPHY.displayFont },
              ]}
            >
              ألوان مخصّصة
            </Text>
            <Text style={[styles.subtitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              اختار لون الورق والحبر — والمعاينة بتتحدّث مع كل لمسة.
            </Text>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {/* Live preview: real Arabic with tashkeel, the derived quote + footnote included. */}
            <View
              testID="custom-preview-card"
              style={[
                styles.previewCard,
                { backgroundColor: tokens.bg, borderColor: tokens.popoverBorder },
              ]}
            >
              <Text
                testID="custom-preview-text"
                style={[styles.previewText, { color: tokens.text, fontFamily: TYPOGRAPHY.displayFont }]}
              >
                {CUSTOM_PREVIEW_TEXT}
              </Text>
              <View
                testID="custom-preview-quote"
                style={[
                  styles.previewQuote,
                  { backgroundColor: tokens.quoteBg, borderRightColor: tokens.quoteBorder },
                ]}
              >
                <Text style={[styles.previewQuoteText, { color: tokens.text, fontFamily: TYPOGRAPHY.displayFont }]}>
                  «وَمَا الْحَيَاةُ إِلَّا حِكَايَةٌ نَرْوِيهَا عَلَى مَهَلٍ.»
                </Text>
              </View>
              <Text
                testID="custom-preview-muted"
                style={[styles.previewFootnote, { color: tokens.muted, fontFamily: TYPOGRAPHY.displayFont }]}
              >
                ١ — حاشية توضيحية بتبان بنفس ألوان الصفحة.
              </Text>
            </View>

            <View
              testID="wcag-contrast-badge"
              style={[styles.badge, { backgroundColor: badgeBg, borderColor: badgeAccent }]}
              accessibilityRole="text"
              accessibilityLabel={`نسبة التباين ${formatContrastRatio(ratio)}، ${grade.labelAr}`}
            >
              <Text style={[styles.badgeRatio, { color: badgeAccent, fontFamily: TYPOGRAPHY.uiFont }]}>
                {formatContrastRatio(ratio)}
              </Text>
              <Text style={[styles.badgeLabel, { color: badgeAccent, fontFamily: TYPOGRAPHY.uiFont }]}>
                {grade.labelAr}
              </Text>
            </View>
            {lowContrast ? (
              <Text
                testID="wcag-contrast-warning"
                style={[styles.warning, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                التباين أقل من ٤.٥:١ — جرّب حبر أغمق على ورق أفتح، أو العكس.
              </Text>
            ) : null}

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                لون الخلفية
              </Text>
              <SwatchRow
                prefix="custom-bg"
                swatches={BG_SWATCHES}
                selected={bg}
                onSelect={applySwatch(setBg, setBgDraft)}
                palette={palette}
              />
              <HexField
                testID="custom-bg-hex-input"
                label="كود اللون"
                value={bg}
                draft={bgDraft}
                onChangeDraft={changeBgDraft}
                onBlur={() => setBgDraft(bg)}
                palette={palette}
              />
            </View>

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                لون النص
              </Text>
              <SwatchRow
                prefix="custom-text"
                swatches={TEXT_SWATCHES}
                selected={text}
                onSelect={applySwatch(setText, setTextDraft)}
                palette={palette}
              />
              <HexField
                testID="custom-text-hex-input"
                label="كود اللون"
                value={text}
                draft={textDraft}
                onChangeDraft={changeTextDraft}
                onBlur={() => setTextDraft(text)}
                palette={palette}
              />
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              testID="custom-colors-disable-btn"
              onPress={onDisable}
              style={({ pressed }) => [
                styles.btn,
                styles.disableBtn,
                { borderColor: palette.border, backgroundColor: palette.surface },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="إلغاء التخصيص والرجوع للمظهر المختار"
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={[styles.btnText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                إلغاء التخصيص
              </Text>
            </Pressable>
            <Pressable
              testID="custom-colors-apply-btn"
              onPress={() => onApply({ bg, text })}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: palette.ctaBg },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="تطبيق الألوان المخصّصة"
            >
              <Text style={[styles.btnText, { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont }]}>
                تطبيق
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    borderRadius: RADIUS.sheet,
    borderWidth: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
    maxWidth: 480,
    width: '100%',
    maxHeight: '92%',
    alignSelf: 'center',
    boxShadow: '0 18px 42px rgba(0, 0, 0, 0.3)',
  },
  head: {
    gap: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    gap: 12,
    paddingBottom: 4,
  },
  previewCard: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  previewText: {
    fontSize: 17,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  previewQuote: {
    borderRadius: 6,
    borderRightWidth: 3,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  previewQuoteText: {
    fontSize: 14.5,
    lineHeight: 26,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  previewFootnote: {
    fontSize: 11.5,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  badge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
    alignSelf: 'center',
  },
  badgeRatio: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  badgeLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  warning: {
    fontSize: 11.5,
    lineHeight: 17,
    textAlign: 'center',
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  swatchWrap: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDot: {
    width: 10,
    height: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
  },
  hexRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  hexLabel: {
    fontSize: 12,
  },
  hexInput: {
    minWidth: 118,
    height: 38,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    paddingHorizontal: 10,
    fontSize: 13.5,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    writingDirection: 'ltr',
  },
  actions: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  btn: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disableBtn: {
    borderWidth: 1,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
