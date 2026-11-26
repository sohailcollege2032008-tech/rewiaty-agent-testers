import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import {
  DEGRADED_BANNER_MESSAGE_AR,
  JOB_KIND_LABELS_AR,
  JOB_STATUS_LABELS_AR,
  formatMonthKeyAr,
  getMonthKey,
  useMissionControl,
  type BookUsageSummary,
  type MissionControlStore,
  type MissionJob,
  type MissionJobStatus,
  type UsageBreakdown,
} from '@/storage/mission-control-store';
import { toArabicDigits } from '@/storage/reading-stats';
import { RADIUS, SPACING, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens, resolveSystemTheme } from '@/theme/reader-theme';
import type { AppThemeTokens } from '@/theme/types';

export type MissionControlScreenProps = {
  /** Injectable for tests / a future remote-backed store. */
  store?: MissionControlStore;
  now?: () => number;
};

const AMBER_TONES = {
  light: {
    surface: 'rgba(196, 146, 78, 0.14)',
    border: 'rgba(176, 128, 62, 0.38)',
    text: '#7A5A2E',
  },
  dark: {
    surface: 'rgba(214, 168, 98, 0.16)',
    border: 'rgba(214, 168, 98, 0.38)',
    text: '#E3C08A',
  },
} as const;

type StatusTone = { surface: string; border: string; text: string };

function statusTone(palette: AppThemeTokens, status: MissionJobStatus): StatusTone {
  const amber = palette.isDark ? AMBER_TONES.dark : AMBER_TONES.light;
  switch (status) {
    case 'running':
      return { surface: palette.accentSoft, border: palette.accent, text: palette.accent };
    case 'degraded':
      return { surface: amber.surface, border: amber.border, text: amber.text };
    case 'paused':
    case 'queued':
    case 'completed':
      return { surface: palette.chipBg, border: palette.chipBorder, text: palette.muted };
  }
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/** Money is always USD and always two decimals — no locale surprises in RTL. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  // Raw sums can legitimately be a fraction of a cent; never round them into $0.00.
  if (value < 0.01) return 'أقل من $0.01';
  return `$${value.toFixed(2)}`;
}

export function formatUnitsAr(units: number): string {
  const safe = Math.max(0, Math.round(units));
  if (safe === 1) return 'وحدة واحدة';
  if (safe === 2) return 'وحدتان';
  if (safe >= 3 && safe <= 10) return `${toArabicDigits(safe)} وحدات`;
  return `${toArabicDigits(safe)} وحدة`;
}

function UsageSplitBar({ usage, palette }: { usage: UsageBreakdown; palette: AppThemeTokens }) {
  const total = usage.totalCostUsd;
  const textFlex = total > 0 ? usage.textCostUsd / total : 0.5;
  const imageFlex = total > 0 ? usage.imageCostUsd / total : 0.5;

  return (
    <View
      style={[styles.usageBar, { backgroundColor: palette.scrubberTrack }]}
      accessibilityLabel={`النص ${formatUsd(usage.textCostUsd)} والصور ${formatUsd(usage.imageCostUsd)}`}
    >
      <View
        testID="usage-bar-text"
        style={[styles.usageBarSegment, { flexGrow: textFlex, backgroundColor: palette.accent }]}
      />
      <View
        testID="usage-bar-image"
        style={[
          styles.usageBarSegment,
          {
            flexGrow: imageFlex,
            backgroundColor: palette.isDark ? AMBER_TONES.dark.border : AMBER_TONES.light.border,
          },
        ]}
      />
    </View>
  );
}

function JobCard({
  job,
  palette,
  onPause,
  onResume,
}: {
  job: MissionJob;
  palette: AppThemeTokens;
  onPause: (jobId: string) => void;
  onResume: (jobId: string) => void;
}) {
  const tone = statusTone(palette, job.status);
  const percent = Math.round(clampProgress(job.progress) * 100);
  const canPause = job.status === 'running' || job.status === 'queued';
  const canResume = job.status === 'paused' || job.status === 'degraded';
  const fillColor =
    job.status === 'degraded' ? tone.border : job.status === 'running' ? palette.accent : palette.muted;

  return (
    <View
      testID={`job-card-${job.id}`}
      style={[styles.jobCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <View style={styles.jobTopRow}>
        <Text
          style={[styles.jobBookTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          numberOfLines={1}
        >
          {job.bookTitle}
        </Text>
        <View
          testID={`job-status-${job.id}`}
          style={[
            styles.statusPill,
            { backgroundColor: tone.surface, borderColor: tone.border },
          ]}
        >
          <Text
            style={[styles.statusPillText, { color: tone.text, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {JOB_STATUS_LABELS_AR[job.status]}
          </Text>
        </View>
      </View>

      <Text style={[styles.jobMeta, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        {`${JOB_KIND_LABELS_AR[job.kind]} · ${job.detailAr}`}
      </Text>

      <View style={styles.progressRow}>
        <View style={[styles.progressTrack, { backgroundColor: palette.scrubberTrack }]}>
          <View
            testID={`job-progress-${job.id}`}
            style={[styles.progressFill, { width: `${percent}%`, backgroundColor: fillColor }]}
          />
        </View>
        <Text
          style={[styles.progressText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
        >
          {`${toArabicDigits(percent)}٪`}
        </Text>
      </View>

      {canPause ? (
        <Pressable
          testID={`job-pause-${job.id}`}
          onPress={() => onPause(job.id)}
          accessibilityRole="button"
          accessibilityLabel={`إيقاف مؤقت — ${job.bookTitle}`}
          style={({ pressed }) => [
            styles.actionButton,
            {
              borderColor: palette.chipBorder,
              backgroundColor: pressed ? palette.accentSoft : 'transparent',
            },
          ]}
        >
          <Text style={[styles.actionText, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}>
            إيقاف مؤقت
          </Text>
        </Pressable>
      ) : null}

      {canResume ? (
        <Pressable
          testID={`job-resume-${job.id}`}
          onPress={() => onResume(job.id)}
          accessibilityRole="button"
          accessibilityLabel={`استئناف — ${job.bookTitle}`}
          style={({ pressed }) => [
            styles.actionButton,
            {
              borderColor: palette.accent,
              backgroundColor: pressed ? palette.accentSoft : 'transparent',
            },
          ]}
        >
          <Text style={[styles.actionText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}>
            استئناف
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BookUsageRow({
  summary,
  palette,
  isLast,
}: {
  summary: BookUsageSummary;
  palette: AppThemeTokens;
  isLast: boolean;
}) {
  return (
    <View
      testID={`usage-book-${summary.bookId}`}
      style={[
        styles.bookUsageRow,
        { borderBottomColor: palette.border },
        isLast && styles.lastBookUsageRow,
      ]}
    >
      <View style={styles.bookUsageTop}>
        <Text
          style={[styles.bookUsageTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          numberOfLines={1}
        >
          {summary.bookTitle}
        </Text>
        <Text
          style={[styles.bookUsageTotal, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
        >
          {formatUsd(summary.totalCostUsd)}
        </Text>
      </View>
      <Text style={[styles.bookUsageMeta, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        {`النص ${formatUsd(summary.textCostUsd)} · ${formatUnitsAr(summary.textUnits)}`}
      </Text>
      <Text style={[styles.bookUsageMeta, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
        {`الصور ${formatUsd(summary.imageCostUsd)} · ${formatUnitsAr(summary.imageUnits)}`}
      </Text>
    </View>
  );
}

export function MissionControlScreen({ store, now = Date.now }: MissionControlScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const colorScheme = useColorScheme();
  const palette = getAppThemeTokens(resolveSystemTheme(colorScheme), colorScheme);

  const monthKey = useMemo(() => getMonthKey(now()), [now]);
  const control = useMissionControl(store, { monthKey });

  const handlePause = useCallback(
    (jobId: string) => {
      void control.pauseJob(jobId);
    },
    [control],
  );
  const handleResume = useCallback(
    (jobId: string) => {
      void control.resumeJob(jobId);
    },
    [control],
  );

  const horizontalPadding = layout.isTablet ? (layout.isTabletLandscape ? 48 : 36) : 20;
  const monthLabel = formatMonthKeyAr(monthKey);
  const hasDegradedJobs = control.degradedJobs.length > 0;
  const usage = control.monthlyUsage;
  const hasUsage = usage.totalCostUsd > 0 || usage.textUnits > 0 || usage.imageUnits > 0;

  return (
    <View
      testID="mission-control-screen"
      style={[styles.container, { backgroundColor: palette.bg, paddingTop: insets.top }]}
    >
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />

      <View
        style={[
          styles.header,
          {
            paddingHorizontal: horizontalPadding,
            borderBottomColor: palette.border,
            backgroundColor: palette.bg,
          },
        ]}
      >
        <Pressable
          testID="mission-control-back-button"
          onPress={() => router.back()}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={({ pressed }) => [
            styles.iconButton,
            pressed && { backgroundColor: palette.accentSoft },
          ]}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path
              d="M9 18l6-6-6-6"
              stroke={palette.text}
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>

        <Text
          style={[styles.title, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
        >
          مركز المهام
        </Text>

        <View
          testID="mission-control-active-pill"
          style={[
            styles.activePill,
            { backgroundColor: palette.accentSoft, borderColor: palette.accent },
          ]}
        >
          <Text
            style={[styles.activePillText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {`${toArabicDigits(control.activeCount)} جارية`}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: horizontalPadding,
            paddingBottom: Math.max(insets.bottom, 24) + 16,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {hasDegradedJobs ? (
          <View
            testID="mission-control-degraded-banner"
            accessibilityLiveRegion="polite"
            style={[
              styles.degradedBanner,
              {
                backgroundColor: palette.isDark ? AMBER_TONES.dark.surface : AMBER_TONES.light.surface,
                borderColor: palette.isDark ? AMBER_TONES.dark.border : AMBER_TONES.light.border,
              },
            ]}
          >
            <Text
              style={[
                styles.degradedBannerText,
                {
                  color: palette.isDark ? AMBER_TONES.dark.text : AMBER_TONES.light.text,
                  fontFamily: TYPOGRAPHY.uiFont,
                },
              ]}
            >
              {DEGRADED_BANNER_MESSAGE_AR}
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
          >
            المهام
          </Text>

          {control.visibleJobs.length === 0 ? (
            <View
              testID="mission-control-empty-state"
              style={[
                styles.emptyCard,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.emptyOrnament, { color: palette.muted }]}>✦</Text>
              <Text
                style={[styles.emptyTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                مفيش مهام جارية دلوقتي
              </Text>
              <Text
                style={[styles.emptyHint, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                أول ما تبدأ مهمة هتلاقيها هنا، ولو حصل أي تعطيل هتستنى في قائمة الانتظار لوحدها.
              </Text>
            </View>
          ) : (
            control.visibleJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                palette={palette}
                onPause={handlePause}
                onResume={handleResume}
              />
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
          >
            الاستهلاك
          </Text>

          <View
            testID="usage-summary-card"
            style={[styles.usageCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <View style={styles.usageHeaderRow}>
              <View style={styles.usageHeaderInfo}>
                <Text
                  style={[styles.usageMonth, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {monthLabel}
                </Text>
                <Text
                  style={[styles.usageTotalLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  الإجمالي
                </Text>
              </View>
              <Text
                testID="usage-total"
                style={[styles.usageTotal, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                {formatUsd(usage.totalCostUsd)}
              </Text>
            </View>

            <UsageSplitBar usage={usage} palette={palette} />

            <View style={styles.usageSplitRow}>
              <View style={styles.usageSplitColumn}>
                <Text
                  style={[styles.usageSplitLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  النص
                </Text>
                <Text
                  style={[styles.usageSplitValue, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {formatUsd(usage.textCostUsd)}
                </Text>
                <Text
                  style={[styles.usageSplitUnits, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {formatUnitsAr(usage.textUnits)}
                </Text>
              </View>
              <View style={styles.usageSplitColumn}>
                <Text
                  style={[styles.usageSplitLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  الصور
                </Text>
                <Text
                  style={[styles.usageSplitValue, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {formatUsd(usage.imageCostUsd)}
                </Text>
                <Text
                  style={[styles.usageSplitUnits, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {formatUnitsAr(usage.imageUnits)}
                </Text>
              </View>
            </View>
          </View>

          {hasUsage && control.bookSummaries.length > 0 ? (
            <View
              style={[
                styles.bookUsageList,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}
            >
              {control.bookSummaries.map((summary, index) => (
                <BookUsageRow
                  key={summary.bookId}
                  summary={summary}
                  palette={palette}
                  isLast={index === control.bookSummaries.length - 1}
                />
              ))}
            </View>
          ) : (
            <View
              testID="usage-empty-state"
              style={[styles.emptyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <Text style={[styles.emptyOrnament, { color: palette.muted }]}>✦</Text>
              <Text
                style={[styles.emptyTitle, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                لسه مفيش استهلاك الشهر ده
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  iconButton: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'right',
  },
  activePill: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePillText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  content: {
    paddingTop: SPACING.md,
    gap: SPACING.lg,
  },
  degradedBanner: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  degradedBannerText: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  jobCard: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  jobTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  jobBookTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  statusPill: {
    minHeight: 24,
    paddingHorizontal: 9,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  jobMeta: {
    fontSize: 12.5,
    textAlign: 'right',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
  },
  progressText: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
    minWidth: 34,
    textAlign: 'left',
  },
  actionButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  emptyCard: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyOrnament: {
    fontSize: 18,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'center',
    opacity: 0.85,
  },
  usageCard: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  usageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  usageHeaderInfo: {
    flex: 1,
    gap: 2,
  },
  usageMonth: {
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'right',
  },
  usageTotalLabel: {
    fontSize: 11,
    textAlign: 'right',
    opacity: 0.85,
  },
  usageTotal: {
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  usageBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  usageBarSegment: {
    height: '100%',
    minWidth: 2,
  },
  usageSplitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  usageSplitColumn: {
    flex: 1,
    gap: 2,
  },
  usageSplitLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  usageSplitValue: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  usageSplitUnits: {
    fontSize: 11.5,
    textAlign: 'right',
  },
  bookUsageList: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  bookUsageRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 3,
  },
  lastBookUsageRow: {
    borderBottomWidth: 0,
  },
  bookUsageTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bookUsageTitle: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  bookUsageTotal: {
    fontSize: 13.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  bookUsageMeta: {
    fontSize: 11.5,
    textAlign: 'right',
  },
});
