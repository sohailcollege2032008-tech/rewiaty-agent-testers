import type { ThemeId } from '../../../../packages/reader-engine/src/types';

/**
 * F31 — «الثيم بيتغيّر لوحده بالنهار والليل».
 *
 * The reader has three modes:
 * - `system`  — follow the phone's light/dark scheme (the pre-F31 behaviour).
 * - `schedule` — follow the clock: `nightStartHour` → `nightEndHour` uses the night theme.
 * - `manual`  — the reader's hand wins; `manualTheme` is used as-is.
 *
 * Pure on purpose: the screen calls it on load and once a minute, and the unit test proves the
 * overnight range (19 → 6) and the same-day range (e.g. 13 → 15) with fixed dates.
 */
export type AutoThemeMode = 'system' | 'schedule' | 'manual';

export type AutoThemeParams = {
  mode: AutoThemeMode | string | null | undefined;
  manualTheme: ThemeId;
  dayTheme: ThemeId;
  nightTheme: ThemeId;
  nightStartHour: number;
  nightEndHour: number;
  systemColorScheme: 'light' | 'dark' | null | undefined;
  /** Injectable clock; defaults to `new Date()`. */
  now?: Date;
};

function normalizeHour(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  if (rounded < 0) return 0;
  if (rounded > 23) return 23;
  return rounded;
}

/**
 * Is `hour` inside the night window?
 *
 * - `start < end` (e.g. 13 → 15) is a same-day window: [start, end).
 * - `start > end` (e.g. 19 → 6) wraps midnight: [start, 24) ∪ [0, end).
 * - `start === end` is an empty window — never night, which is the least surprising reading of a
 *   zero-length schedule (the alternative would be "night all day").
 */
export function isNightHour(hour: number, nightStartHour: number, nightEndHour: number): boolean {
  const start = normalizeHour(nightStartHour, 19);
  const end = normalizeHour(nightEndHour, 6);
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function resolveAutoTheme(params: AutoThemeParams): ThemeId {
  const mode = params.mode ?? 'system';
  if (mode === 'manual') return params.manualTheme;

  if (mode === 'schedule') {
    const now = params.now ?? new Date();
    return isNightHour(now.getHours(), params.nightStartHour, params.nightEndHour)
      ? params.nightTheme
      : params.dayTheme;
  }

  // `system` (and any unknown value, which must never crash a reader mid-page):
  return params.systemColorScheme === 'dark' ? params.nightTheme : params.dayTheme;
}
