import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ARABIC_MONTHS,
  buildReadingCalendar,
  computeStreak,
  formatDurationArabic,
  formatExpectedFinishArabic,
  toArabicDigits,
  toLocalDateKey,
  type ReadingSnapshot,
  type ReadingStats,
} from '@/storage/reading-stats';
import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export type ReadingStatsPanelProps = {
  stats: ReadingStats;
  snapshot?: ReadingSnapshot | null;
  theme?: ThemeId;
  dir?: 'rtl' | 'ltr';
  now?: number;
};

const WEEKDAY_LABELS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'] as const;

function formatDaysArabic(count: number): string {
  if (count === 1) return 'يوم واحد';
  if (count === 2) return 'يومان';
  if (count >= 3 && count <= 10) return `${toArabicDigits(count)} أيام`;
  return `${toArabicDigits(count)} يوم`;
}

export function ReadingStatsPanel({
  stats,
  snapshot,
  theme,
  dir = 'rtl',
  now = Date.now(),
}: ReadingStatsPanelProps) {
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';
  const todayKey = toLocalDateKey(now);
  const streak = computeStreak(stats.days, todayKey);

  const today = new Date(now);
  const calendar = buildReadingCalendar(stats.days, today.getFullYear(), today.getMonth() + 1, now);
  const leadingBlanks = calendar[0]?.weekday ?? 0;
  const monthTitle = `${ARABIC_MONTHS[today.getMonth()] ?? ''} ${toArabicDigits(today.getFullYear())}`;

  const wpm = snapshot?.effectiveWpm ?? stats.effectiveWpm;

  return (
    <ScrollView
      testID="reading-stats-panel"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <Text
          style={[
            styles.sectionTitle,
            { color: palette.text, fontFamily: TYPOGRAPHY.displayFont, writingDirection: isRtl ? 'rtl' : 'ltr' },
          ]}
        >
          سرعة القراءة
        </Text>
        <Text
          testID="stats-wpm"
          style={[styles.metric, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
        >
          {`${toArabicDigits(Math.round(wpm))} كلمة/دقيقة`}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.metricRow}>
          <Text style={[styles.metricLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            المتبقي في الفصل
          </Text>
          <Text
            testID="stats-chapter-remaining"
            style={[styles.metricValue, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {formatDurationArabic(snapshot?.chapterRemainingMinutes ?? 0)}
          </Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={[styles.metricLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            المتبقي في الكتاب
          </Text>
          <Text
            testID="stats-book-remaining"
            style={[styles.metricValue, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {formatDurationArabic(snapshot?.bookRemainingMinutes ?? 0)}
          </Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={[styles.metricLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            متوقع إنهاء الرواية
          </Text>
          <Text
            testID="stats-finish-date"
            style={[styles.metricValue, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {formatExpectedFinishArabic(snapshot?.estimatedFinishDate ?? null, now)}
          </Text>
        </View>
      </View>

      <View style={[styles.section, styles.divider, { borderTopColor: palette.border }]}>
        <View style={styles.metricRow}>
          <Text style={[styles.metricLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            السلسلة الحالية
          </Text>
          <Text
            testID="stats-streak-current"
            style={[styles.metricValue, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {streak.currentStreak > 0 ? formatDaysArabic(streak.currentStreak) : 'لا توجد بعد'}
          </Text>
        </View>
        <View style={styles.metricRow}>
          <Text style={[styles.metricLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            أطول سلسلة
          </Text>
          <Text
            testID="stats-streak-longest"
            style={[styles.metricValue, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {streak.longestStreak > 0 ? formatDaysArabic(streak.longestStreak) : 'لا توجد بعد'}
          </Text>
        </View>
      </View>

      <View style={[styles.section, styles.divider, { borderTopColor: palette.border }]}>
        <Text
          style={[
            styles.calendarTitle,
            { color: palette.text, fontFamily: TYPOGRAPHY.displayFont },
          ]}
        >
          {monthTitle}
        </Text>
        <View style={styles.calendarGrid} testID="stats-calendar">
          {WEEKDAY_LABELS.map((label) => (
            <View key={label} style={styles.calendarCell}>
              <Text
                style={[styles.weekdayLabel, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {label}
              </Text>
            </View>
          ))}
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <View key={`blank-${index}`} style={styles.calendarCell} />
          ))}
          {calendar.map((day) => (
            <View key={day.dateKey} style={styles.calendarCell}>
              <View
                testID={`stats-day-${day.dateKey}`}
                accessibilityLabel={
                  day.isReadingDay
                    ? `${toArabicDigits(day.day)} — ${formatDurationArabic(day.minutes)} قراية`
                    : `${toArabicDigits(day.day)} — مفيش قراية`
                }
                style={[
                  styles.dayBubble,
                  {
                    backgroundColor: day.isReadingDay ? palette.accent : 'transparent',
                    borderColor: day.isToday ? palette.accent : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    {
                      color: day.isReadingDay ? palette.onAccent : palette.muted,
                      fontFamily: TYPOGRAPHY.uiFont,
                    },
                  ]}
                >
                  {toArabicDigits(day.day)}
                </Text>
              </View>
            </View>
          ))}
        </View>
        {streak.readToday ? (
          <Text style={[styles.todayNote, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            قرأت النهاردة — كمّل كده.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 18,
    paddingBottom: 28,
  },
  section: {
    gap: 10,
    paddingTop: 2,
  },
  divider: {
    borderTopWidth: 1,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  metric: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  metricLabel: {
    fontSize: 13,
    flexShrink: 1,
  },
  metricValue: {
    fontSize: 13.5,
    fontWeight: '600',
    flexShrink: 0,
    textAlign: 'left',
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '14.28%',
    alignItems: 'center',
    paddingVertical: 3,
  },
  weekdayLabel: {
    fontSize: 10,
    opacity: 0.8,
    textAlign: 'center',
  },
  dayBubble: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  todayNote: {
    fontSize: 11.5,
    textAlign: 'right',
    opacity: 0.8,
  },
});
