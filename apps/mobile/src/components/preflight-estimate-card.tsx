import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RADIUS, SPACING, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { AppThemeTokens } from '@/theme/types';
import type { ThemeId } from '@/types/reader';
import type { AiLevel, CostEstimateResponse, RoutingMode } from '@/types/upload-contract';

export type PreflightEstimateCardProps = {
  estimate: CostEstimateResponse;
  /** Defaults to `essential` so the card can be previewed on its own. */
  aiLevel?: AiLevel;
  onSelectAiLevel?: (level: AiLevel) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** F42: optional shortcut into the smart theme / Style DNA sample. */
  onPreviewOnboarding?: () => void;
  /** A re-estimate is in flight: keep the card readable, disable the actions. */
  busy?: boolean;
  theme?: ThemeId;
};

export const AI_LEVEL_ORDER: readonly AiLevel[] = [
  'purist',
  'essential',
  'curated',
  'directors_cut',
];

export const AI_LEVEL_LABELS_AR: Record<AiLevel, string> = {
  purist: 'نقي',
  essential: 'أساسي',
  curated: 'مختار',
  directors_cut: 'نسخة المخرج',
};

export const AI_LEVEL_HINTS_AR: Record<AiLevel, string> = {
  purist: 'النص بس، من غير صور',
  essential: 'صور قليلة ومؤثرة',
  curated: 'صور لكل مشهد مهم',
  directors_cut: 'أقصى إثراء للكتاب',
};

export const ROUTING_MODE_LABELS_AR: Record<RoutingMode, string> = {
  text_only: 'نص رقمي نظيف',
  vision_ocr: 'مسح ضوئي ذكي (OCR)',
  hybrid: 'هجين (نص + OCR)',
};

/** Money is always USD with two decimals — no locale surprises in an RTL layout. */
export function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `$${safe.toFixed(2)}`;
}

/** «45 ثانية» · «دقيقة واحدة» · «دقيقتين» · «5 دقائق» · «12 دقيقة». */
export function formatDurationAr(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) {
    if (rest === 1) return 'ثانية واحدة';
    if (rest === 2) return 'ثانيتين';
    if (rest >= 3 && rest <= 10) return `${rest} ثواني`;
    return `${rest} ثانية`;
  }
  const minuteText =
    minutes === 1 ? 'دقيقة' : minutes === 2 ? 'دقيقتين' : minutes <= 10 ? `${minutes} دقائق` : `${minutes} دقيقة`;
  if (rest === 0) return minuteText;
  return `${minuteText} و${rest} ثانية`;
}

/** «320 صفحة، حوالي $0.45، ابدأ؟» — the calm F42 pre-flight headline. */
export function formatEstimateHeadline(estimate: CostEstimateResponse): string {
  return `${estimate.page_count} صفحة، حوالي ${formatUsd(estimate.estimated_cost_usd.total_usd)}، ابدأ؟`;
}

function amberTone(palette: AppThemeTokens): { surface: string; border: string; text: string } {
  if (palette.isDark) {
    return {
      surface: 'rgba(214, 168, 98, 0.16)',
      border: 'rgba(214, 168, 98, 0.38)',
      text: '#E3C08A',
    };
  }
  return {
    surface: 'rgba(196, 146, 78, 0.14)',
    border: 'rgba(176, 128, 62, 0.38)',
    text: '#7A5A2E',
  };
}

function BreakdownRow({
  label,
  value,
  testID,
  palette,
}: {
  label: string;
  value: string;
  testID: string;
  palette: AppThemeTokens;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        {label}
      </Text>
      <Text
        testID={testID}
        style={[styles.rowValue, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
      >
        {value}
      </Text>
    </View>
  );
}

export function PreflightEstimateCard({
  estimate,
  aiLevel = 'essential',
  onSelectAiLevel,
  onConfirm,
  onCancel,
  onPreviewOnboarding,
  busy = false,
  theme,
}: PreflightEstimateCardProps) {
  const palette = getAppThemeTokens(theme);
  const amber = amberTone(palette);
  const warnings = estimate.warnings.filter((warning) => warning.trim().length > 0);

  return (
    <View
      testID="preflight-estimate-card"
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <Text
        testID="preflight-headline"
        style={[styles.headline, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
      >
        {formatEstimateHeadline(estimate)}
      </Text>

      <View style={styles.badgeRow}>
        <View
          testID="preflight-routing-badge"
          style={[styles.badge, { backgroundColor: palette.accentSoft, borderColor: palette.accent }]}
        >
          <Text style={[styles.badgeText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
            {ROUTING_MODE_LABELS_AR[estimate.routing_mode]}
          </Text>
        </View>
        {estimate.is_digital_text_clean ? (
          <View style={[styles.badge, { backgroundColor: palette.chipBg, borderColor: palette.chipBorder }]}>
            <Text
              style={[styles.badgeText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              فيه طبقة نص
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.breakdown, { borderColor: palette.border }]}>
        <BreakdownRow
          label="تكلفة النص"
          value={formatUsd(estimate.estimated_cost_usd.text_usd)}
          testID="preflight-text-cost"
          palette={palette}
        />
        <BreakdownRow
          label="تكلفة الصور"
          value={formatUsd(estimate.estimated_cost_usd.image_usd)}
          testID="preflight-image-cost"
          palette={palette}
        />
        <BreakdownRow
          label="صور متوقعة"
          value={`${estimate.estimated_image_count} صورة`}
          testID="preflight-image-count"
          palette={palette}
        />
        <BreakdownRow
          label="الوقت المتوقع"
          value={formatDurationAr(estimate.estimated_duration_sec)}
          testID="preflight-duration"
          palette={palette}
        />
      </View>

      <View style={styles.levelSection}>
        <Text style={[styles.sectionTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
          قوة الـ AI
        </Text>
        <View style={styles.levelRow}>
          {AI_LEVEL_ORDER.map((level) => {
            const selected = level === aiLevel;
            return (
              <Pressable
                key={level}
                testID={`preflight-ai-level-${level}`}
                onPress={() => onSelectAiLevel?.(level)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={AI_LEVEL_LABELS_AR[level]}
                accessibilityState={{ selected }}
                style={[
                  styles.levelChip,
                  {
                    backgroundColor: selected ? palette.chipActiveBg : palette.chipBg,
                    borderColor: selected ? palette.accent : palette.chipBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.levelChipText,
                    {
                      color: selected ? palette.accent : palette.muted,
                      fontFamily: TYPOGRAPHY.uiFont,
                    },
                  ]}
                >
                  {AI_LEVEL_LABELS_AR[level]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.levelHint, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
          {AI_LEVEL_HINTS_AR[aiLevel]}
        </Text>
      </View>

      {warnings.length > 0 ? (
        <View
          testID="preflight-warnings"
          style={[styles.warnings, { backgroundColor: amber.surface, borderColor: amber.border }]}
        >
          {warnings.map((warning, index) => (
            <Text
              key={`${index}-${warning}`}
              style={[styles.warningText, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              {`• ${warning}`}
            </Text>
          ))}
        </View>
      ) : null}

      <Pressable
        testID="preflight-confirm-btn"
        onPress={onConfirm}
        disabled={busy}
        style={({ pressed }) => [
          styles.primaryBtn,
          { backgroundColor: palette.ctaBg, opacity: busy ? 0.55 : 1 },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="ابدأ التحويل"
      >
        <Text style={[styles.primaryBtnText, { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont }]}>
          ابدأ التحويل
        </Text>
      </Pressable>

      {onPreviewOnboarding ? (
        <Pressable
          testID="preflight-preview-onboarding-btn"
          onPress={onPreviewOnboarding}
          disabled={busy}
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="جرّب عيّنة الثيمات والأسلوب"
        >
          <Text
            style={[styles.secondaryBtnText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            جرّب عيّنة الثيمات والأسلوب
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        testID="preflight-cancel-btn"
        onPress={onCancel}
        disabled={busy}
        style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="تراجع"
      >
        <Text style={[styles.cancelBtnText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
          تراجع
        </Text>
      </Pressable>
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
  headline: {
    fontSize: 21,
    lineHeight: 34,
    fontWeight: '700',
    textAlign: 'right',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    justifyContent: 'flex-end',
  },
  badge: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  breakdown: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: SPACING.sm,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  rowLabel: {
    fontSize: 12.5,
    textAlign: 'right',
  },
  rowValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  levelSection: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  levelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
  },
  levelChip: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  levelChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  levelHint: {
    fontSize: 11.5,
    textAlign: 'right',
  },
  warnings: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  warningText: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
  },
  primaryBtn: {
    minHeight: 48,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 2,
  },
  primaryBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  secondaryBtn: {
    minHeight: 42,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  cancelBtn: {
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.78,
  },
});
