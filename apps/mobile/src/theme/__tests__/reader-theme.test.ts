import { resolveCoverPalette } from '@/storage/cover';
import { computeResponsiveLayout } from '@/theme/layout';
import {
  CORE_THEME_IDS,
  THEME_REGISTRY,
  getAppThemeTokens,
  migrateThemeId,
  resolveAppTheme,
  resolveSystemTheme,
  THEME_OPTIONS,
} from '@/theme/reader-theme';

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('reader-theme registry, migration & responsive layout', () => {
  it('provides all 4 Warraq themes from the data-driven registry', () => {
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([
      'warraq',
      'sepia',
      'burnt-paper',
      'oled-crimson',
    ]);

    const warraq = getAppThemeTokens('warraq');
    expect(warraq.bg).toBe('#FAF7F0');
    expect(warraq.text).toBe('#231F1A');
    expect(warraq.accent).toBe('#9E3E2F');
    expect(warraq.ctaBg).toBe('#9E3E2F');
    expect(warraq.isDark).toBe(false);
    expect(warraq.sheetBg).toContain('rgba(');

    const sepia = getAppThemeTokens('sepia');
    expect(sepia.bg).toBe('#F3EBD6');
    expect(sepia.text).toBe('#382B1E');
    expect(sepia.accent).toBe('#8C3A2B');
    expect(sepia.isDark).toBe(false);

    const burntPaper = getAppThemeTokens('burnt-paper');
    expect(burntPaper.bg).toBe('#181310');
    expect(burntPaper.text).toBe('#DECFC0');
    expect(burntPaper.accent).toBe('#DF7863');
    expect(burntPaper.ctaBg).toBe('#A34131');
    expect(burntPaper.isDark).toBe(true);

    const oledCrimson = getAppThemeTokens('oled-crimson');
    expect(oledCrimson.bg).toBe('#000000');
    expect(oledCrimson.text).toBe('#E6DED3');
    expect(oledCrimson.heading).toBe('#FAF5EE');
    expect(oledCrimson.accent).toBe('#D46A5A');
    expect(oledCrimson.ctaBg).toBe('#9B3A2C');
    expect(oledCrimson.isDark).toBe(true);
    expect(contrastRatio(oledCrimson.text, oledCrimson.bg)).toBeGreaterThanOrEqual(12);
    expect(relativeLuminance(oledCrimson.heading!)).toBeGreaterThan(
      relativeLuminance(oledCrimson.text),
    );
    expect(contrastRatio(oledCrimson.heading!, oledCrimson.bg)).toBeGreaterThanOrEqual(12);
  });

  it('migrates legacy theme IDs and falls back based on colorScheme', () => {
    expect(migrateThemeId('warm-paper')).toBe('warraq');
    expect(migrateThemeId('charcoal')).toBe('burnt-paper');
    expect(migrateThemeId('oled')).toBe('oled-crimson');
    expect(migrateThemeId('sepia')).toBe('sepia');
    expect(migrateThemeId('unknown')).toBeNull();

    expect(getAppThemeTokens(null, 'light').id).toBe('warraq');
    expect(getAppThemeTokens(undefined, 'dark').id).toBe('burnt-paper');
    expect(getAppThemeTokens('charcoal').id).toBe('burnt-paper');
  });

  it('resolves system theme unless user manually selected a theme', () => {
    expect(resolveSystemTheme('light')).toBe('warraq');
    expect(resolveSystemTheme('dark')).toBe('burnt-paper');
    expect(resolveSystemTheme(null)).toBe('warraq');

    expect(resolveAppTheme('oled-crimson', false, 'light')).toBe('warraq');
    expect(resolveAppTheme('warraq', false, 'dark')).toBe('burnt-paper');

    expect(resolveAppTheme('oled-crimson', true, 'light')).toBe('oled-crimson');
    expect(resolveAppTheme('sepia', true, 'dark')).toBe('sepia');
    expect(resolveAppTheme('oled', true, 'light')).toBe('oled-crimson');
  });

  it('derives deterministic cover palette and SVG pattern from title hash', () => {
    const first = resolveCoverPalette('حَجَرُ الْمَاءِ');
    const second = resolveCoverPalette('حَجَرُ الْمَاءِ');
    expect(first).toEqual(second);
    expect(['diamonds', 'octagon', 'arch', 'lattice']).toContain(first.pattern);

    const customLight = resolveCoverPalette('قصة', '#F5EDE0');
    expect(customLight.bg).toBe('#F5EDE0');
    expect(customLight.text).toBe('#1F1B18');

    const customDark = resolveCoverPalette('قصة', '#1E293B');
    expect(customDark.bg).toBe('#1E293B');
    expect(customDark.text).toBe('#FFFFFF');
  });

  it('computes phone and tablet responsive layouts at 600dp shortest-side threshold', () => {
    const phone = computeResponsiveLayout(390, 844);
    expect(phone.isTablet).toBe(false);
    expect(phone.libraryColumns).toBe(2);
    expect(phone.settingsMode).toBe('bottom-sheet');
    expect(phone.readerMaxReadingWidthCh).toBeNull();

    const tabletPortrait = computeResponsiveLayout(1024, 1366);
    expect(tabletPortrait.isTablet).toBe(true);
    expect(tabletPortrait.isTabletPortrait).toBe(true);
    expect(tabletPortrait.libraryColumns).toBe(3);
    expect(tabletPortrait.settingsMode).toBe('bottom-sheet');
    expect(tabletPortrait.readerMaxReadingWidthCh).toBe(62);

    const tabletLandscape = computeResponsiveLayout(1366, 1024);
    expect(tabletLandscape.isTablet).toBe(true);
    expect(tabletLandscape.isTabletLandscape).toBe(true);
    expect(tabletLandscape.libraryColumns).toBe(4);
    expect(tabletLandscape.settingsMode).toBe('side-panel');
    expect(tabletLandscape.settingsPanelWidth).toBe(348);
    expect(tabletLandscape.readerMaxReadingWidthCh).toBe(54);
  });

  it('maps every legacy id and rejects prototype-like or unknown ids', () => {
    expect(migrateThemeId('warm-paper')).toBe('warraq');
    expect(migrateThemeId('charcoal')).toBe('burnt-paper');
    expect(migrateThemeId('oled')).toBe('oled-crimson');
    expect(migrateThemeId('sepia')).toBe('sepia');
    for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'nope', '', 42, null, undefined]) {
      expect(migrateThemeId(bad)).toBeNull();
    }
    expect(getAppThemeTokens('toString', 'dark').id).toBe('burnt-paper');
  });

  it('registers all 13 F31 themes while the quick-select row stays the 4 core ones', () => {
    expect(Object.keys(THEME_REGISTRY)).toHaveLength(13);
    expect(THEME_OPTIONS).toHaveLength(4);
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([...CORE_THEME_IDS]);

    for (const [id, theme] of Object.entries(THEME_REGISTRY)) {
      expect(theme.id).toBe(id);
      expect(getAppThemeTokens(id).id).toBe(id);
      expect(['light', 'warm', 'dark', 'oled']).toContain(theme.category);
    }

    // A theme from the encyclopedia is addressable through the same registry lookup the reader uses.
    expect(getAppThemeTokens('night-ink').labelAr).toBe('حِبْر اللَّيْل');
    expect(migrateThemeId('night-ink')).toBe('night-ink');
  });

  it('keeps every theme’s text on its own paper at WCAG AAA (≥ 7:1)', () => {
    for (const theme of Object.values(THEME_REGISTRY)) {
      expect(contrastRatio(theme.text, theme.bg)).toBeGreaterThanOrEqual(7);
    }
  });

  it('uses fully opaque sheetBg tokens for every theme (no text bleed-through)', () => {
    for (const opt of THEME_OPTIONS) {
      const tokens = getAppThemeTokens(opt.id);
      const match = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/i.exec(tokens.sheetBg);
      if (match) {
        expect(Number(match[1])).toBe(1);
      } else {
        expect(tokens.sheetBg).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
