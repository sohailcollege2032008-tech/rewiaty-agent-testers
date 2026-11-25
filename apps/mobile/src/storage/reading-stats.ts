import { getKv, setKv, type DatabaseAdapter } from './database';

export const READING_STATS_KV_KEY = 'reading_stats_v1';
/** A gap longer than this is idleness: it is not reading time and never feeds WPM. */
export const INACTIVITY_GATE_MS = 3 * 60 * 1000;
export const DEFAULT_WPM = 180;
export const DEFAULT_DAILY_MINUTES = 30;
/** A day counts as a reading day at >= 60 seconds or >= 50 words. */
export const MIN_READING_DAY_MS = 60_000;
export const MIN_READING_DAY_WORDS = 50;
export const MIN_VALID_WPM = 60;
export const MAX_VALID_WPM = 600;

const EWMA_ALPHA = 0.35;
const FIRST_SAMPLE_ALPHA = 0.5;
const MIN_PAGE_TURN_MS = 3000;
const LONG_JUMP_PAGE_COUNT = 3;
const LONG_JUMP_MS = 10_000;

export const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export type ReadingDayStats = {
  dateKey: string;
  activeMs: number;
  words: number;
};

export type ReadingDays = Record<string, ReadingDayStats>;

export type ReadingStats = {
  version: 1;
  days: ReadingDays;
  effectiveWpm: number;
  updatedAt?: number;
};

export type ReadingCalendarDay = {
  dateKey: string;
  day: number;
  /** 0 = Sunday … 6 = Saturday, in local time. */
  weekday: number;
  isReadingDay: boolean;
  isToday: boolean;
  minutes: number;
};

export type ReadingStreak = {
  currentStreak: number;
  longestStreak: number;
  readToday: boolean;
};

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toLocalDateKey(ts: number): string {
  const date = new Date(Number.isFinite(ts) ? ts : Date.now());
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function addDaysToKey(key: string, delta: number): string {
  const date = parseDateKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + delta);
  return toLocalDateKey(date.getTime());
}

export function isReadingDay(day: ReadingDayStats | null | undefined): boolean {
  if (!day) return false;
  return day.activeMs >= MIN_READING_DAY_MS || day.words >= MIN_READING_DAY_WORDS;
}

export function emptyReadingStats(): ReadingStats {
  return { version: 1, days: {}, effectiveWpm: DEFAULT_WPM };
}

export function normalizeReadingStats(raw: unknown): ReadingStats {
  if (!raw || typeof raw !== 'object') return emptyReadingStats();
  const source = raw as Record<string, unknown>;

  const days: ReadingDays = {};
  if (source.days && typeof source.days === 'object') {
    for (const [key, value] of Object.entries(source.days as Record<string, unknown>)) {
      if (!parseDateKey(key)) continue;
      if (!value || typeof value !== 'object') continue;
      const day = value as Record<string, unknown>;
      const activeMs =
        typeof day.activeMs === 'number' && Number.isFinite(day.activeMs)
          ? Math.max(0, day.activeMs)
          : 0;
      const words =
        typeof day.words === 'number' && Number.isFinite(day.words)
          ? Math.max(0, day.words)
          : 0;
      days[key] = { dateKey: key, activeMs, words };
    }
  }

  const rawWpm = source.effectiveWpm;
  const effectiveWpm =
    typeof rawWpm === 'number' && Number.isFinite(rawWpm) && rawWpm >= MIN_VALID_WPM && rawWpm <= MAX_VALID_WPM
      ? rawWpm
      : DEFAULT_WPM;

  return {
    version: 1,
    days,
    effectiveWpm,
    ...(typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
      ? { updatedAt: source.updatedAt }
      : {}),
  };
}

export async function loadReadingStats(db?: DatabaseAdapter): Promise<ReadingStats> {
  const raw = await getKv<unknown>(READING_STATS_KV_KEY, null, db);
  return normalizeReadingStats(raw);
}

export async function saveReadingStats(stats: ReadingStats, db?: DatabaseAdapter): Promise<void> {
  await setKv(READING_STATS_KV_KEY, stats, db);
}

export function recordDailyReading(
  stats: ReadingStats,
  dateKey: string,
  addedActiveMs: number,
  addedWords: number,
): ReadingStats {
  if (!parseDateKey(dateKey)) return stats;
  const activeMs = Number.isFinite(addedActiveMs) ? Math.max(0, addedActiveMs) : 0;
  const words = Number.isFinite(addedWords) ? Math.max(0, addedWords) : 0;
  if (activeMs === 0 && words === 0) return stats;

  const existing = stats.days[dateKey] ?? { dateKey, activeMs: 0, words: 0 };
  return {
    ...stats,
    days: {
      ...stats.days,
      [dateKey]: {
        dateKey,
        activeMs: existing.activeMs + activeMs,
        words: existing.words + words,
      },
    },
    updatedAt: Date.now(),
  };
}

export function computeStreak(days: ReadingDays, todayKey: string): ReadingStreak {
  const readingKeys = new Set(
    Object.keys(days).filter((key) => isReadingDay(days[key])),
  );

  const readToday = readingKeys.has(todayKey);
  // A streak survives until the end of today: if yesterday was read, today still counts.
  let cursor = readToday ? todayKey : addDaysToKey(todayKey, -1);
  let currentStreak = 0;
  while (readingKeys.has(cursor)) {
    currentStreak += 1;
    cursor = addDaysToKey(cursor, -1);
  }

  const sortedKeys = [...readingKeys].sort();
  let longestStreak = 0;
  let run = 0;
  let previousKey: string | null = null;
  for (const key of sortedKeys) {
    run = previousKey !== null && addDaysToKey(previousKey, 1) === key ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previousKey = key;
  }

  return { currentStreak, longestStreak, readToday };
}

export function buildReadingCalendar(
  days: ReadingDays,
  year: number,
  month: number,
  now: number = Date.now(),
): ReadingCalendarDay[] {
  const safeMonth = Math.min(12, Math.max(1, Math.floor(month)));
  const daysInMonth = new Date(year, safeMonth, 0).getDate();
  const todayKey = toLocalDateKey(now);
  const calendar: ReadingCalendarDay[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${pad2(safeMonth)}-${pad2(day)}`;
    const record = days[dateKey];
    calendar.push({
      dateKey,
      day,
      weekday: new Date(year, safeMonth - 1, day).getDay(),
      isReadingDay: isReadingDay(record),
      isToday: dateKey === todayKey,
      minutes: record ? Math.round(record.activeMs / 60_000) : 0,
    });
  }

  return calendar;
}

function formatMinutesArabic(minutes: number): string {
  if (minutes <= 1) return 'دقيقة';
  if (minutes === 2) return 'دقيقتان';
  return `${toArabicDigits(minutes)} دقيقة`;
}

export function formatDurationArabic(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (total < 1) return 'أقل من دقيقة';
  if (total < 60) return formatMinutesArabic(total);

  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const hourLabel =
    hours === 1
      ? 'ساعة'
      : hours === 2
        ? 'ساعتان'
        : hours <= 10
          ? `${toArabicDigits(hours)} ساعات`
          : `${toArabicDigits(hours)} ساعة`;

  return rest > 0 ? `${hourLabel} و${formatMinutesArabic(rest)}` : hourLabel;
}

export function formatExpectedFinishArabic(
  date: number | Date | null | undefined,
  now: number = Date.now(),
): string {
  if (date === null || date === undefined) return 'غير معروف';
  const ts = date instanceof Date ? date.getTime() : date;
  if (!Number.isFinite(ts)) return 'غير معروف';

  const targetKey = toLocalDateKey(ts);
  const todayKey = toLocalDateKey(now);
  if (targetKey === todayKey) return 'اليوم';
  if (targetKey === addDaysToKey(todayKey, 1)) return 'غداً';
  if (targetKey === addDaysToKey(todayKey, -1)) return 'أمس';

  const target = new Date(ts);
  const monthName = ARABIC_MONTHS[target.getMonth()] ?? '';
  return `${toArabicDigits(target.getDate())} ${monthName} ${toArabicDigits(target.getFullYear())}`;
}

export type ReadingChapterSummary = {
  id: string;
  wordCount: number;
};

export type ReadingTrackerOptions = {
  now?: () => number;
  chapters?: ReadingChapterSummary[];
  totalWords?: number;
  stats?: ReadingStats | null;
  initialWpm?: number;
  dailyMinutes?: number;
};

export type ReadingProgressEvent = {
  chapterId: string;
  page: number;
  pageCount: number;
  wordsPerPageEstimate: number;
  timestamp: number;
};

export type ReadingSnapshot = {
  effectiveWpm: number;
  activeMs: number;
  wordsRead: number;
  chapterRemainingMinutes: number;
  bookRemainingMinutes: number;
  estimatedFinishDate: number | null;
};

export type PendingDailyReading = Record<string, { activeMs: number; words: number }>;

function clampWpm(value: number): number {
  return Math.min(MAX_VALID_WPM, Math.max(MIN_VALID_WPM, value));
}

/**
 * Tracks real reading speed and remaining time from page-turn events.
 *
 * `now` is injectable so tests (and background flush) are fully deterministic — the
 * tracker itself never schedules a timer.
 */
export class ReadingSessionTracker {
  private readonly now: () => number;
  private readonly chapters: ReadingChapterSummary[];
  private readonly totalWords: number | null;
  private readonly dailyMinutesOverride: number | null;

  private stats: ReadingStats | null;
  private effectiveWpm: number;
  private samples = 0;
  private activeMs = 0;
  private wordsRead = 0;
  private last: ReadingProgressEvent | null = null;
  private pendingDays: PendingDailyReading = {};

  constructor(options: ReadingTrackerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.chapters = options.chapters ?? [];
    this.totalWords =
      typeof options.totalWords === 'number' && Number.isFinite(options.totalWords)
        ? options.totalWords
        : null;
    this.dailyMinutesOverride =
      typeof options.dailyMinutes === 'number' && Number.isFinite(options.dailyMinutes)
        ? Math.max(1, options.dailyMinutes)
        : null;
    this.stats = options.stats ?? null;

    const seededWpm =
      typeof options.initialWpm === 'number' && Number.isFinite(options.initialWpm)
        ? options.initialWpm
        : this.stats?.effectiveWpm;
    this.effectiveWpm =
      typeof seededWpm === 'number' && Number.isFinite(seededWpm)
        ? clampWpm(seededWpm)
        : DEFAULT_WPM;
  }

  getEffectiveWpm(): number {
    return this.effectiveWpm;
  }

  getActiveMs(): number {
    return this.activeMs;
  }

  getWordsRead(): number {
    return this.wordsRead;
  }

  /** Backgrounding the app ends the current reading stretch: the gap is never counted. */
  pause(): void {
    this.last = null;
  }

  updateStats(stats: ReadingStats): void {
    this.stats = stats;
    if (this.samples === 0 && stats.effectiveWpm > 0) {
      this.effectiveWpm = clampWpm(stats.effectiveWpm);
    }
  }

  recordProgress(event: ReadingProgressEvent): void {
    const timestamp = Number.isFinite(event.timestamp) ? event.timestamp : this.now();
    const current: ReadingProgressEvent = { ...event, timestamp };
    const previous = this.last;

    if (!previous) {
      this.last = current;
      return;
    }

    const deltaMs = timestamp - previous.timestamp;
    if (deltaMs <= 0) {
      this.last = current;
      return;
    }

    // Inactivity gate: a long gap is not reading. It is dropped entirely, and the next
    // event becomes the new baseline so nothing is retroactively counted.
    if (deltaMs > INACTIVITY_GATE_MS) {
      this.last = current;
      return;
    }

    const sameChapter = previous.chapterId === event.chapterId;
    const forwardPages = sameChapter ? Math.max(0, event.page - previous.page) : 0;
    const wordsPerPage =
      Number.isFinite(event.wordsPerPageEstimate) && event.wordsPerPageEstimate > 0
        ? event.wordsPerPageEstimate
        : 0;

    const unrealistic =
      forwardPages >= 1 &&
      (deltaMs < MIN_PAGE_TURN_MS ||
        (forwardPages > LONG_JUMP_PAGE_COUNT && deltaMs < LONG_JUMP_MS));

    let wordsCounted = 0;
    let sampleWpm: number | null = null;
    if (forwardPages >= 1 && wordsPerPage > 0 && !unrealistic) {
      const candidateWpm = (forwardPages * wordsPerPage) / (deltaMs / 60_000);
      if (candidateWpm >= MIN_VALID_WPM && candidateWpm <= MAX_VALID_WPM) {
        sampleWpm = candidateWpm;
        wordsCounted = forwardPages * wordsPerPage;
      }
    }

    this.activeMs += deltaMs;
    this.wordsRead += wordsCounted;
    this.addPending(timestamp, deltaMs, wordsCounted);

    if (sampleWpm !== null) {
      const alpha = this.samples === 0 ? FIRST_SAMPLE_ALPHA : EWMA_ALPHA;
      this.effectiveWpm = this.effectiveWpm * (1 - alpha) + sampleWpm * alpha;
      this.samples += 1;
    }

    this.last = current;
  }

  getPendingDaily(): PendingDailyReading {
    const copy: PendingDailyReading = {};
    for (const [key, value] of Object.entries(this.pendingDays)) {
      copy[key] = { ...value };
    }
    return copy;
  }

  consumePendingDaily(): PendingDailyReading {
    const pending = this.getPendingDaily();
    this.pendingDays = {};
    return pending;
  }

  snapshot(now: number = this.now()): ReadingSnapshot {
    const chapterRemainingMinutes = this.computeChapterRemainingMinutes();
    const bookRemainingMinutes = this.computeBookRemainingMinutes(chapterRemainingMinutes);
    const dailyMinutes = this.resolveDailyMinutes();

    let estimatedFinishDate: number | null = null;
    if (bookRemainingMinutes > 0) {
      const daysNeeded = Math.max(1, Math.ceil(bookRemainingMinutes / dailyMinutes));
      const finish = new Date(now);
      finish.setDate(finish.getDate() + daysNeeded);
      finish.setHours(0, 0, 0, 0);
      estimatedFinishDate = finish.getTime();
    }

    return {
      effectiveWpm: this.effectiveWpm,
      activeMs: this.activeMs,
      wordsRead: this.wordsRead,
      chapterRemainingMinutes,
      bookRemainingMinutes,
      estimatedFinishDate,
    };
  }

  private addPending(timestamp: number, activeMs: number, words: number): void {
    if (activeMs <= 0 && words <= 0) return;
    const key = toLocalDateKey(timestamp);
    const existing = this.pendingDays[key] ?? { activeMs: 0, words: 0 };
    this.pendingDays[key] = {
      activeMs: existing.activeMs + activeMs,
      words: existing.words + words,
    };
  }

  private computeChapterRemainingMinutes(): number {
    const last = this.last;
    if (!last) return 0;

    const chapter = this.chapters.find((candidate) => candidate.id === last.chapterId);
    if (!chapter) return 0;

    const pageCount = Math.max(1, last.pageCount);
    const wordsPerPage =
      last.wordsPerPageEstimate > 0 ? last.wordsPerPageEstimate : chapter.wordCount / pageCount;
    const wordsReadInChapter = Math.max(
      0,
      Math.min(chapter.wordCount, (last.page - 1) * wordsPerPage),
    );
    return Math.max(0, (chapter.wordCount - wordsReadInChapter) / this.effectiveWpm);
  }

  private computeBookRemainingMinutes(chapterRemainingMinutes: number): number {
    const last = this.last;
    if (!last) return 0;

    if (this.chapters.length === 0) {
      if (this.totalWords !== null) {
        return Math.max(0, (this.totalWords - this.wordsRead) / this.effectiveWpm);
      }
      return chapterRemainingMinutes;
    }

    const index = this.chapters.findIndex((candidate) => candidate.id === last.chapterId);
    if (index < 0) return chapterRemainingMinutes;

    const wordsAfter = this.chapters
      .slice(index + 1)
      .reduce((sum, candidate) => sum + candidate.wordCount, 0);

    return chapterRemainingMinutes + wordsAfter / this.effectiveWpm;
  }

  private resolveDailyMinutes(): number {
    if (this.dailyMinutesOverride !== null) return this.dailyMinutesOverride;
    if (!this.stats) return DEFAULT_DAILY_MINUTES;

    const todayKey = toLocalDateKey(this.now());
    const windowDays: ReadingDayStats[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const day = this.stats.days[addDaysToKey(todayKey, -offset)];
      if (isReadingDay(day)) windowDays.push(day!);
    }
    if (windowDays.length === 0) return DEFAULT_DAILY_MINUTES;

    const totalMs = windowDays.reduce((sum, day) => sum + day.activeMs, 0);
    return Math.max(1, totalMs / windowDays.length / 60_000);
  }
}

export function applyPendingDailyReading(
  stats: ReadingStats,
  pending: PendingDailyReading,
  effectiveWpm?: number,
): ReadingStats {
  let next = stats;
  for (const [dateKey, value] of Object.entries(pending)) {
    next = recordDailyReading(next, dateKey, value.activeMs, value.words);
  }
  if (typeof effectiveWpm === 'number' && Number.isFinite(effectiveWpm)) {
    next = { ...next, effectiveWpm: clampWpm(effectiveWpm), updatedAt: Date.now() };
  }
  return next;
}
