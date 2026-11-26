import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { RADIUS, SPACING, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { AppThemeTokens } from '@/theme/types';
import type { ThemeId } from '@/types/reader';
import type {
  BookArtDirectionInput,
  OnboardingSampleResponse,
  StyleDnaCandidate,
  SuggestedThemeCandidate,
} from '@/types/upload-contract';

export type OnboardingSampleCardProps = {
  sample: OnboardingSampleResponse;
  onConfirm: (payload: BookArtDirectionInput) => void;
  onBack?: () => void;
  busy?: boolean;
  initialThemeId?: string;
  initialStyleId?: string;
  theme?: ThemeId;
};

/** A calm, real Arabic paragraph so the theme preview reads like an actual page. */
const PREVIEW_LINE =
  'كان البيت واقف على حد السكة، والباب بيصطك مع الريح، وحكاية قديمة مستنية حد يفتحها.';

const PREVIEW_TITLE = 'الفصل الأول';

function Swatches({
  colors,
  testIDPrefix,
}: {
  colors: readonly string[];
  testIDPrefix: string;
}) {
  return (
    <View style={styles.swatchRow}>
      {colors.map((color, index) => (
        <View
          key={`${color}-${index}`}
          testID={`${testIDPrefix}-${index}`}
          style={[styles.swatch, { backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

function ThemeOption({
  candidate,
  selected,
  palette,
  onSelect,
}: {
  candidate: SuggestedThemeCandidate;
  selected: boolean;
  palette: AppThemeTokens;
  onSelect: () => void;
}) {
  return (
    <Pressable
      testID={`onboarding-theme-${candidate.theme_id}`}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={candidate.name_ar}
      accessibilityState={{ selected }}
      style={[
        styles.themeOption,
        {
          backgroundColor: candidate.background,
          borderColor: selected ? palette.accent : palette.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
    >
      <View style={[styles.themeOptionSurface, { backgroundColor: candidate.surface }]}>
        <Text
          style={[styles.themeOptionName, { color: candidate.accent, fontFamily: TYPOGRAPHY.uiFont }]}
          numberOfLines={1}
        >
          {candidate.name_ar}
        </Text>
        <View style={[styles.themeOptionRule, { backgroundColor: candidate.accent }]} />
        <Text
          style={[styles.themeOptionText, { color: candidate.text, fontFamily: TYPOGRAPHY.uiFont }]}
          numberOfLines={2}
        >
          {PREVIEW_LINE}
        </Text>
      </View>
    </Pressable>
  );
}

function StyleCard({
  candidate,
  selected,
  palette,
  onSelect,
}: {
  candidate: StyleDnaCandidate;
  selected: boolean;
  palette: AppThemeTokens;
  onSelect: () => void;
}) {
  return (
    <Pressable
      testID={`onboarding-style-${candidate.style_id}`}
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityLabel={candidate.name_ar}
      accessibilityState={{ selected }}
      style={[
        styles.styleCard,
        {
          backgroundColor: selected ? palette.chipActiveBg : palette.surfaceElevated,
          borderColor: selected ? palette.accent : palette.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
    >
      <View style={styles.styleHeader}>
        <Text
          style={[styles.styleName, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          numberOfLines={1}
        >
          {candidate.name_ar}
        </Text>
        <Swatches colors={candidate.palette} testIDPrefix={`onboarding-style-swatch-${candidate.style_id}`} />
      </View>

      <View style={styles.moodRow}>
        {candidate.mood_tags.map((tag) => (
          <View
            key={tag}
            style={[styles.moodChip, { backgroundColor: palette.chipBg, borderColor: palette.chipBorder }]}
          >
            <Text style={[styles.moodChipText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              {tag}
            </Text>
          </View>
        ))}
      </View>

      <Text
        testID={`onboarding-style-prompt-${candidate.style_id}`}
        style={[styles.stylePrompt, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
        numberOfLines={3}
      >
        {candidate.prompt_prefix}
      </Text>
    </Pressable>
  );
}

export function OnboardingSampleCard({
  sample,
  onConfirm,
  onBack,
  busy = false,
  initialThemeId,
  initialStyleId,
  theme,
}: OnboardingSampleCardProps) {
  const palette = getAppThemeTokens(theme);

  const [selectedThemeId, setSelectedThemeId] = useState<string>(() => {
    const preferred = sample.themes.find((item) => item.theme_id === initialThemeId);
    return preferred?.theme_id ?? sample.themes[0]?.theme_id ?? '';
  });
  const [selectedStyleId, setSelectedStyleId] = useState<string>(() => {
    const preferred = sample.styles.find((item) => item.style_id === initialStyleId);
    return preferred?.style_id ?? sample.styles[0]?.style_id ?? '';
  });
  const [customOpen, setCustomOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  const activeTheme =
    sample.themes.find((item) => item.theme_id === selectedThemeId) ?? sample.themes[0];
  const activeStyle =
    sample.styles.find((item) => item.style_id === selectedStyleId) ?? sample.styles[0];

  if (!activeTheme || !activeStyle) {
    return (
      <View
        testID="onboarding-sample-card"
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <Text style={[styles.sectionTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
          مفيش اقتراحات جاهزة دلوقتي. تقدر تبدأ التحويل على طول.
        </Text>
      </View>
    );
  }

  const trimmedCustom = customPrompt.trim();
  const effectivePrefix = trimmedCustom.length > 0 ? trimmedCustom : activeStyle.prompt_prefix;

  const handleConfirm = () => {
    if (busy || !activeTheme || !activeStyle) return;
    onConfirm({
      selected_theme_id: activeTheme.theme_id,
      selected_style_id: activeStyle.style_id,
      custom_prompt_prefix: trimmedCustom.length > 0 ? trimmedCustom : undefined,
    });
  };

  return (
    <View
      testID="onboarding-sample-card"
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <Text
        style={[styles.title, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
      >
        جرّب عيّنة الكتاب قبل ما نبدأ
      </Text>
      <Text style={[styles.subtitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        اختار جو القراءة والأسلوب اللي يناسب حكايتك، وإحنا بنكمّل على اختيارك.
      </Text>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
          اختر جو القراءة
        </Text>

        <View
          testID="onboarding-theme-preview"
          style={[
            styles.previewBox,
            { backgroundColor: activeTheme.background, borderColor: palette.border },
          ]}
        >
          <View
            testID="onboarding-theme-preview-surface"
            style={[styles.previewSurface, { backgroundColor: activeTheme.surface }]}
          >
            <Text
              testID="onboarding-theme-preview-name"
              style={[
                styles.previewHeading,
                { color: activeTheme.accent, fontFamily: TYPOGRAPHY.displayFont },
              ]}
            >
              {PREVIEW_TITLE}
            </Text>
            <View style={[styles.previewRule, { backgroundColor: activeTheme.accent }]} />
            <Text
              testID="onboarding-theme-preview-text"
              style={[
                styles.previewLine,
                { color: activeTheme.text, fontFamily: TYPOGRAPHY.displayFont },
              ]}
            >
              {PREVIEW_LINE}
            </Text>
          </View>
          <Text
            testID="onboarding-theme-preview-name-ar"
            style={[styles.previewName, { color: activeTheme.accent, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {activeTheme.name_ar}
          </Text>
          <Text
            testID="onboarding-theme-preview-rationale"
            style={[styles.previewRationale, { color: activeTheme.text, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {activeTheme.rationale_ar}
          </Text>
        </View>

        <View style={styles.themeRow}>
          {sample.themes.map((candidate) => (
            <ThemeOption
              key={candidate.theme_id}
              candidate={candidate}
              selected={candidate.theme_id === activeTheme.theme_id}
              palette={palette}
              onSelect={() => setSelectedThemeId(candidate.theme_id)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
          اختر أسلوب الرسم (Style DNA)
        </Text>

        <View style={styles.styleList}>
          {sample.styles.map((candidate) => (
            <StyleCard
              key={candidate.style_id}
              candidate={candidate}
              selected={candidate.style_id === activeStyle.style_id}
              palette={palette}
              onSelect={() => setSelectedStyleId(candidate.style_id)}
            />
          ))}
        </View>

        <Pressable
          testID="onboarding-custom-prompt-toggle"
          onPress={() => setCustomOpen((open) => !open)}
          style={({ pressed }) => [styles.customToggle, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="عدّل وصف الأسلوب"
          accessibilityState={{ expanded: customOpen }}
        >
          <Text
            style={[styles.customToggleText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {customOpen ? 'إخفاء التعديل' : 'تعديل وصف الأسلوب (اختياري)'}
          </Text>
        </Pressable>

        {customOpen ? (
          <View style={styles.customInputWrap}>
            <TextInput
              testID="onboarding-custom-prompt-input"
              value={customPrompt}
              onChangeText={setCustomPrompt}
              placeholder={activeStyle.prompt_prefix}
              placeholderTextColor={palette.muted}
              multiline
              textAlign="right"
              style={[
                styles.customInput,
                {
                  color: palette.text,
                  borderColor: palette.border,
                  backgroundColor: palette.surfaceElevated,
                  fontFamily: TYPOGRAPHY.uiFont,
                },
              ]}
              accessibilityLabel="وصف أسلوب الرسم"
            />
            <Text
              testID="onboarding-effective-prefix"
              style={[styles.effectivePrefix, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={3}
            >
              {effectivePrefix}
            </Text>
          </View>
        ) : null}
      </View>

      {sample.sample_cost_usd > 0 ? (
        <Text
          testID="onboarding-sample-cost"
          style={[styles.sampleCost, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
        >
          {`تكلفة العيّنة: $${sample.sample_cost_usd.toFixed(2)}`}
        </Text>
      ) : null}

      <Pressable
        testID="onboarding-confirm-btn"
        onPress={handleConfirm}
        disabled={busy}
        style={({ pressed }) => [
          styles.primaryBtn,
          { backgroundColor: palette.ctaBg, opacity: busy ? 0.55 : 1 },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="اعتماد الأسلوب وابدأ"
      >
        <Text style={[styles.primaryBtnText, { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont }]}>
          اعتماد الأسلوب وابدأ
        </Text>
      </Pressable>

      {onBack ? (
        <Pressable
          testID="onboarding-back-btn"
          onPress={onBack}
          disabled={busy}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="رجوع للتقدير"
        >
          <Text style={[styles.backBtnText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            رجوع للتقدير
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm + 2,
  },
  title: {
    fontSize: 20,
    lineHeight: 32,
    fontWeight: '700',
    textAlign: 'right',
  },
  subtitle: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
  },
  section: {
    gap: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
  },
  previewBox: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  previewSurface: {
    borderRadius: RADIUS.button,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  previewHeading: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  previewRule: {
    height: 2,
    width: 42,
    borderRadius: 1,
    alignSelf: 'flex-end',
    opacity: 0.85,
  },
  previewLine: {
    fontSize: 13.5,
    lineHeight: 24,
    textAlign: 'right',
  },
  previewName: {
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  previewRationale: {
    fontSize: 11.5,
    lineHeight: 18,
    textAlign: 'right',
    opacity: 0.92,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeOption: {
    flex: 1,
    borderRadius: RADIUS.card,
    padding: 6,
  },
  themeOptionSurface: {
    borderRadius: RADIUS.button,
    padding: 8,
    gap: 4,
    minHeight: 84,
  },
  themeOptionName: {
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  themeOptionRule: {
    height: 1.5,
    width: 24,
    borderRadius: 1,
    alignSelf: 'flex-end',
    opacity: 0.8,
  },
  themeOptionText: {
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'right',
  },
  styleList: {
    gap: 8,
  },
  styleCard: {
    borderRadius: RADIUS.card,
    padding: 10,
    gap: 6,
  },
  styleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  styleName: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  swatchRow: {
    flexDirection: 'row',
    gap: 4,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.18)',
  },
  moodRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'flex-end',
  },
  moodChip: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  moodChipText: {
    fontSize: 10.5,
  },
  stylePrompt: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
  },
  customToggle: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
  },
  customToggleText: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  customInputWrap: {
    gap: 6,
  },
  customInput: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: RADIUS.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12.5,
    textAlignVertical: 'top',
  },
  effectivePrefix: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
  },
  sampleCost: {
    fontSize: 11.5,
    textAlign: 'right',
  },
  primaryBtn: {
    minHeight: 48,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  backBtn: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.78,
  },
});
