import { contrastRatio } from '../../../../../packages/reader-engine/src/types';
import { isNightHour, resolveAutoTheme } from '@/theme/auto-theme';
import {
  ALL_THEME_IDS,
  ENCYCLOPEDIA_THEME_IDS,
  THEME_SAMPLE_TEXT,
  THEME_TAGLINES,
  countThemesByCategory,
  listThemesForFilter,
  themeContrastRatio,
} from '@/theme/encyclopedia';
import { CORE_THEME_IDS, THEME_REGISTRY, getAppThemeTokens } from '@/theme/reader-theme';

describe('F31 — موسوعة الثيمات (theme encyclopedia)', () => {
  it('ships 13 distinct themes, with حِبْر اللَّيْل leading the encyclopedia', () => {
    expect(ALL_THEME_IDS).toHaveLength(13);
    expect(new Set(ALL_THEME_IDS).size).toBe(13);
    expect(ENCYCLOPEDIA_THEME_IDS).toHaveLength(9);
    expect(ENCYCLOPEDIA_THEME_IDS[0]).toBe('night-ink');
    expect(ALL_THEME_IDS.slice(0, 9)).toEqual([...ENCYCLOPEDIA_THEME_IDS]);
    expect(ALL_THEME_IDS.slice(9)).toEqual([...CORE_THEME_IDS]);
    for (const id of ALL_THEME_IDS) {
      expect(THEME_REGISTRY[id].id).toBe(id);
      expect(THEME_TAGLINES[id]).toBeTruthy();
    }
  });

  it('uses the exact night-ink palette contract from the design tokens', () => {
    const nightInk = getAppThemeTokens('night-ink');
    expect(nightInk.bg).toBe('#10151E');
    expect(nightInk.text).toBe('#D4D8DF');
    expect(nightInk.accent).toBe('#DB7B7C');
    expect(nightInk.ctaBg).toBe('#993D45');
    expect(nightInk.ctaText).toBe('#FAF3F4');
    expect(nightInk.isDark).toBe(true);
    expect(nightInk.category).toBe('dark');
  });

  it('guarantees WCAG AAA (≥ 7:1) text contrast on every theme', () => {
    for (const id of ALL_THEME_IDS) {
      const theme = THEME_REGISTRY[id];
      const ratio = themeContrastRatio(theme);
      expect(ratio).toBeGreaterThanOrEqual(7);
      // The engine helper and the app helper must agree — otherwise a badge lies.
      expect(Math.round(ratio * 100) / 100).toBe(
        Math.round(contrastRatio(theme.text, theme.bg) * 100) / 100,
      );
      expect(theme.contrastLabel).toMatch(/^[٠-٩.]+:١ AAA$/);
      expect(theme.sheetBg).toMatch(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*1\s*\)$/);
    }
  });

  it('counts and filters themes by mood (light 4 / warm 3 / dark 4 / OLED 2)', () => {
    expect(countThemesByCategory()).toEqual({ light: 4, warm: 3, dark: 4, oled: 2 });

    const dark = listThemesForFilter('dark');
    expect(dark).toHaveLength(4);
    expect(dark.every((theme) => theme.category === 'dark')).toBe(true);
    expect(dark.map((theme) => theme.id)).toContain('night-ink');

    expect(listThemesForFilter('oled').map((theme) => theme.id)).toEqual([
      'oled-amber',
      'oled-crimson',
    ]);
    expect(listThemesForFilter('all').map((theme) => theme.id)).toEqual([...ALL_THEME_IDS]);
  });

  it('keeps the sample line fully voweled Arabic so the reader judges real text', () => {
    expect(THEME_SAMPLE_TEXT).toMatch(/[\u064B-\u0652]/);
    expect(THEME_SAMPLE_TEXT).toMatch(/[\u0600-\u06FF]/);
  });
});

describe('F31 — resolveAutoTheme (system / schedule / manual)', () => {
  const base = {
    manualTheme: 'night-ink' as const,
    dayTheme: 'warraq' as const,
    nightTheme: 'night-ink' as const,
    nightStartHour: 19,
    nightEndHour: 6,
  };

  it('manual mode always returns the reader’s own choice', () => {
    expect(
      resolveAutoTheme({
        ...base,
        mode: 'manual',
        systemColorScheme: 'dark',
        now: new Date(2026, 0, 1, 12, 0),
      }),
    ).toBe('night-ink');
  });

  it('system mode follows the phone scheme', () => {
    expect(resolveAutoTheme({ ...base, mode: 'system', systemColorScheme: 'dark' })).toBe(
      'night-ink',
    );
    expect(resolveAutoTheme({ ...base, mode: 'system', systemColorScheme: 'light' })).toBe(
      'warraq',
    );
    expect(resolveAutoTheme({ ...base, mode: 'system', systemColorScheme: null })).toBe('warraq');
  });

  it('schedule mode handles the overnight window (19 → 6)', () => {
    const at = (hour: number, minute = 0) =>
      resolveAutoTheme({
        ...base,
        mode: 'schedule',
        systemColorScheme: 'light',
        now: new Date(2026, 0, 1, hour, minute),
      });
    expect(at(18, 59)).toBe('warraq');
    expect(at(19, 0)).toBe('night-ink');
    expect(at(23, 30)).toBe('night-ink');
    expect(at(0, 0)).toBe('night-ink');
    expect(at(5, 59)).toBe('night-ink');
    expect(at(6, 0)).toBe('warraq');
    expect(at(12, 0)).toBe('warraq');
  });

  it('schedule mode handles a same-day window (13 → 15)', () => {
    const params = {
      ...base,
      mode: 'schedule' as const,
      nightStartHour: 13,
      nightEndHour: 15,
      systemColorScheme: 'light' as const,
    };
    const at = (hour: number, minute = 0) =>
      resolveAutoTheme({ ...params, now: new Date(2026, 0, 1, hour, minute) });
    expect(at(12, 59)).toBe('warraq');
    expect(at(13, 0)).toBe('night-ink');
    expect(at(14, 59)).toBe('night-ink');
    expect(at(15, 0)).toBe('warraq');
    expect(at(20, 0)).toBe('warraq');
  });

  it('treats a zero-length window as “never night” and clamps bad hours', () => {
    expect(isNightHour(19, 19, 19)).toBe(false);
    expect(isNightHour(0, 19, 19)).toBe(false);
    // Out-of-range hours must not crash or invert the window.
    expect(isNightHour(23, 99, -5)).toBe(true);
    expect(isNightHour(12, 99, -5)).toBe(false);
    expect(isNightHour(Number.NaN, 19, 6)).toBe(false);
  });
});
