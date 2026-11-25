import {
  addDaysToKey,
  applyPendingDailyReading,
  buildReadingCalendar,
  computeStreak,
  DEFAULT_WPM,
  emptyReadingStats,
  formatDurationArabic,
  formatExpectedFinishArabic,
  INACTIVITY_GATE_MS,
  loadReadingStats,
  normalizeReadingStats,
  ReadingSessionTracker,
  recordDailyReading,
  saveReadingStats,
  toArabicDigits,
  toLocalDateKey,
  type ReadingDays,
  type ReadingStats,
} from '@/storage/reading-stats';

const BASE = new Date(2026, 2, 10, 12, 0, 0).getTime(); // 10 March 2026, local noon

function turn(
  tracker: ReadingSessionTracker,
  page: number,
  timestamp: number,
  extra: Partial<{ chapterId: string; pageCount: number; wordsPerPageEstimate: number }> = {},
) {
  tracker.recordProgress({
    chapterId: extra.chapterId ?? 'ch01',
    page,
    pageCount: extra.pageCount ?? 10,
    wordsPerPageEstimate: extra.wordsPerPageEstimate ?? 300,
    timestamp,
  });
}

function readingDays(keys: string[], activeMs = 120_000): ReadingDays {
  const days: ReadingDays = {};
  for (const key of keys) {
    days[key] = { dateKey: key, activeMs, words: 600 };
  }
  return days;
}

describe('reading stats: WPM from real page turns', () => {
  it('converges to the measured speed and never below the default', () => {
    const tracker = new ReadingSessionTracker({ now: () => BASE });
    let timestamp = BASE;
    for (let page = 1; page <= 6; page += 1) {
      turn(tracker, page, timestamp);
      timestamp += 60_000; // one page (300 words) per minute => 300 wpm
    }

    const wpm = tracker.getEffectiveWpm();
    expect(wpm).toBeGreaterThan(DEFAULT_WPM);
    expect(wpm).toBeLessThanOrEqual(300);
    expect(Math.round(wpm)).toBeGreaterThanOrEqual(280);
    expect(tracker.getWordsRead()).toBe(1500);
    expect(tracker.getActiveMs()).toBe(5 * 60_000);
  });
});

describe('reading stats: 3-minute inactivity gate', () => {
  it('drops a 4-minute gap entirely: no time, no words, no WPM drop', () => {
    const tracker = new ReadingSessionTracker({ now: () => BASE });
    turn(tracker, 1, BASE);
    const wpmBefore = tracker.getEffectiveWpm();

    turn(tracker, 2, BASE + 4 * 60_000);

    expect(INACTIVITY_GATE_MS).toBe(180_000);
    expect(tracker.getActiveMs()).toBe(0);
    expect(tracker.getWordsRead()).toBe(0);
    expect(tracker.getEffectiveWpm()).toBe(wpmBefore);
  });

  it('still counts a gap exactly at the gate', () => {
    const tracker = new ReadingSessionTracker({ now: () => BASE });
    turn(tracker, 1, BASE);
    turn(tracker, 2, BASE + INACTIVITY_GATE_MS);
    expect(tracker.getActiveMs()).toBe(INACTIVITY_GATE_MS);
  });
});

describe('reading stats: unrealistic jumps are ignored for WPM', () => {
  it('rejects a 100ms page turn', () => {
    const tracker = new ReadingSessionTracker({ now: () => BASE });
    turn(tracker, 1, BASE);
    turn(tracker, 2, BASE + 100);
    expect(tracker.getActiveMs()).toBe(100);
    expect(tracker.getWordsRead()).toBe(0);
    expect(tracker.getEffectiveWpm()).toBe(DEFAULT_WPM);
  });

  it('rejects a TOC/scrubber jump across many pages', () => {
    const tracker = new ReadingSessionTracker({ now: () => BASE });
    turn(tracker, 1, BASE);
    turn(tracker, 50, BASE + 5_000);
    expect(tracker.getWordsRead()).toBe(0);
    expect(tracker.getEffectiveWpm()).toBe(DEFAULT_WPM);
  });

  it('rejects an implausible WPM sample (outside 60..600)', () => {
    const tracker = new ReadingSessionTracker({ now: () => BASE });
    turn(tracker, 1, BASE);
    turn(tracker, 2, BASE + 10_000); // 300 words / 10s = 1800 wpm
    expect(tracker.getWordsRead()).toBe(0);
    expect(tracker.getEffectiveWpm()).toBe(DEFAULT_WPM);
  });
});

describe('reading stats: remaining time and finish date', () => {
  it('computes chapter and whole-book remaining minutes', () => {
    const tracker = new ReadingSessionTracker({
      chapters: [
        { id: 'ch01', wordCount: 1000 },
        { id: 'ch02', wordCount: 2000 },
      ],
      totalWords: 3000,
      now: () => BASE,
    });
    turn(tracker, 1, BASE, { wordsPerPageEstimate: 100 });

    const snapshot = tracker.snapshot(BASE);
    expect(snapshot.effectiveWpm).toBe(DEFAULT_WPM);
    expect(snapshot.chapterRemainingMinutes).toBeCloseTo(1000 / DEFAULT_WPM, 5);
    expect(snapshot.bookRemainingMinutes).toBeCloseTo(3000 / DEFAULT_WPM, 5);
    expect(formatExpectedFinishArabic(snapshot.estimatedFinishDate, BASE)).toBe('غداً');
  });

  it('uses the 30-minutes-a-day fallback and honours an explicit daily average', () => {
    const tracker = new ReadingSessionTracker({
      chapters: [{ id: 'ch01', wordCount: 1000 }],
      now: () => BASE,
      dailyMinutes: 1,
    });
    turn(tracker, 1, BASE, { wordsPerPageEstimate: 100 });

    const snapshot = tracker.snapshot(BASE);
    const daysNeeded = Math.ceil(1000 / DEFAULT_WPM / 1);
    expect(snapshot.estimatedFinishDate).toBe(
      new Date(2026, 2, 10 + daysNeeded, 0, 0, 0, 0).getTime(),
    );
  });

  it('derives the daily average from recent reading days when stats exist', () => {
    const stats: ReadingStats = {
      version: 1,
      effectiveWpm: 200,
      days: readingDays(['2026-03-08', '2026-03-09'], 120 * 60_000),
    };
    const tracker = new ReadingSessionTracker({
      chapters: [{ id: 'ch01', wordCount: 500 }],
      now: () => BASE,
      stats,
    });
    turn(tracker, 1, BASE, { wordsPerPageEstimate: 100 });

    // 500 words at 200 wpm = 2.5 minutes; 120 minutes/day => tomorrow is enough.
    const snapshot = tracker.snapshot(BASE);
    expect(snapshot.effectiveWpm).toBe(200);
    expect(formatExpectedFinishArabic(snapshot.estimatedFinishDate, BASE)).toBe('غداً');
  });

  it('takes a five-minute break out of the active time when the app pauses', () => {
    const tracker = new ReadingSessionTracker({ now: () => BASE });
    turn(tracker, 1, BASE);
    tracker.pause();
    turn(tracker, 2, BASE + 5 * 60_000);
    expect(tracker.getActiveMs()).toBe(0);
  });
});

describe('reading stats: day keys, streaks and calendar', () => {
  it('formats local date keys', () => {
    expect(toLocalDateKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('accumulates daily reading and only counts a real reading day at the thresholds', () => {
    let stats = emptyReadingStats();
    stats = recordDailyReading(stats, '2026-03-10', 30_000, 10);
    expect(stats.days['2026-03-10']?.activeMs).toBe(30_000);

    stats = recordDailyReading(stats, '2026-03-10', 45_000, 60);
    expect(stats.days['2026-03-10']?.activeMs).toBe(75_000);
    expect(computeStreak(stats.days, '2026-03-10').readToday).toBe(true);

    // 30s / 10 words is not a reading day.
    const weak = recordDailyReading(emptyReadingStats(), '2026-03-11', 30_000, 10);
    expect(computeStreak(weak.days, '2026-03-11').readToday).toBe(false);
  });

  it('keeps a streak alive when yesterday was read and today is not over yet', () => {
    const days = readingDays(['2026-03-08', '2026-03-09']);
    const streak = computeStreak(days, '2026-03-10');
    expect(streak).toEqual({ currentStreak: 2, longestStreak: 2, readToday: false });
  });

  it('counts a consecutive streak and a broken longest run separately', () => {
    const days = readingDays(['2026-03-01', '2026-03-02', '2026-03-08', '2026-03-09', '2026-03-10']);
    expect(computeStreak(days, '2026-03-10')).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      readToday: true,
    });
  });

  it('crosses a month and a year boundary', () => {
    const days = readingDays(['2025-12-30', '2025-12-31', '2026-01-01']);
    expect(computeStreak(days, '2026-01-01')).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      readToday: true,
    });
  });

  it('builds the month calendar with reading days and today marked', () => {
    const days = readingDays(['2026-02-03', '2026-02-10']);
    const calendar = buildReadingCalendar(days, 2026, 2, new Date(2026, 1, 10, 9).getTime());

    expect(calendar).toHaveLength(28);
    const third = calendar.find((day) => day.day === 3);
    expect(third?.isReadingDay).toBe(true);
    expect(third?.minutes).toBe(2);
    expect(calendar.find((day) => day.day === 4)?.isReadingDay).toBe(false);
    expect(calendar.find((day) => day.day === 10)?.isToday).toBe(true);
    expect(calendar[0]?.weekday).toBe(new Date(2026, 1, 1).getDay());
  });

  it('handles a leap February', () => {
    expect(buildReadingCalendar({}, 2028, 2)).toHaveLength(29);
    expect(buildReadingCalendar({}, 2026, 2)).toHaveLength(28);
  });
});

describe('reading stats: Arabic formatting and storage', () => {
  it('formats durations in Arabic', () => {
    expect(formatDurationArabic(0)).toBe('أقل من دقيقة');
    expect(formatDurationArabic(0.4)).toBe('أقل من دقيقة');
    expect(formatDurationArabic(12)).toBe('١٢ دقيقة');
    expect(formatDurationArabic(60)).toBe('ساعة');
    expect(formatDurationArabic(80)).toBe('ساعة و٢٠ دقيقة');
    expect(formatDurationArabic(120)).toBe('ساعتان');
    expect(formatDurationArabic(185)).toBe('٣ ساعات و٥ دقيقة');
    expect(toArabicDigits(2026)).toBe('٢٠٢٦');
  });

  it('formats the expected finish date in Arabic', () => {
    expect(formatExpectedFinishArabic(null, BASE)).toBe('غير معروف');
    expect(formatExpectedFinishArabic(BASE, BASE)).toBe('اليوم');
    expect(formatExpectedFinishArabic(BASE + 24 * 60 * 60 * 1000, BASE)).toBe('غداً');
    expect(
      formatExpectedFinishArabic(new Date(2027, 2, 15, 12).getTime(), BASE),
    ).toBe('١٥ مارس ٢٠٢٧');
  });

  it('normalizes corrupt storage instead of throwing', () => {
    expect(normalizeReadingStats(null)).toEqual(emptyReadingStats());
    expect(normalizeReadingStats({ days: 'x', effectiveWpm: -5 })).toEqual(emptyReadingStats());

    const repaired = normalizeReadingStats({
      days: { '2026-03-10': { activeMs: 90_000, words: 500 }, bad: { activeMs: 1 } },
      effectiveWpm: 250,
    });
    expect(Object.keys(repaired.days)).toEqual(['2026-03-10']);
    expect(repaired.effectiveWpm).toBe(250);
  });

  it('round-trips stats through the kv store', async () => {
    const store = new Map<string, string>();
    const db = {
      async execAsync() {},
      async runAsync(_sql: string, ...params: unknown[]) {
        if (params.length >= 2) store.set(String(params[0]), String(params[1]));
        return { changes: 1 };
      },
      async getFirstAsync<T>(_sql: string, ...params: unknown[]) {
        const value = store.get(String(params[0]));
        return (value === undefined ? null : { value }) as T | null;
      },
      async getAllAsync<T>() {
        return [] as T[];
      },
    };

    const saved: ReadingStats = {
      version: 1,
      effectiveWpm: 210,
      days: readingDays(['2026-03-10']),
    };
    await saveReadingStats(saved, db);
    expect(await loadReadingStats(db)).toEqual(saved);
  });

  it('applies pending daily reading plus the measured WPM', () => {
    const next = applyPendingDailyReading(
      emptyReadingStats(),
      { '2026-03-10': { activeMs: 90_000, words: 300 } },
      240,
    );
    expect(next.days['2026-03-10']?.activeMs).toBe(90_000);
    expect(next.effectiveWpm).toBe(240);
  });
});
