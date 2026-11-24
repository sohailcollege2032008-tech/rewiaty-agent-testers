import { resolveCoverPalette } from '@/storage/cover';
import { getAppThemeTokens, THEME_OPTIONS } from '@/theme/reader-theme';

describe('reader-theme & generated cover', () => {
  it('provides all 4 required themes with exact PRD color tokens', () => {
    expect(THEME_OPTIONS.map((t) => t.id)).toEqual([
      'warm-paper',
      'sepia',
      'charcoal',
      'oled',
    ]);

    const warmPaper = getAppThemeTokens('warm-paper');
    expect(warmPaper.bg).toBe('#FAF8F5');
    expect(warmPaper.text).toBe('#24211D');
    expect(warmPaper.isDark).toBe(false);
    expect(warmPaper.sheetBg).toContain('rgba(');

    const sepia = getAppThemeTokens('sepia');
    expect(sepia.bg).toBe('#F4ECD8');
    expect(sepia.text).toBe('#3E3024');
    expect(sepia.isDark).toBe(false);

    const charcoal = getAppThemeTokens('charcoal');
    expect(charcoal.bg).toBe('#18181B');
    expect(charcoal.text).toBe('#D4D4D8');
    expect(charcoal.isDark).toBe(true);

    const oled = getAppThemeTokens('oled');
    expect(oled.bg).toBe('#000000');
    expect(oled.text).toBe('#A1A1AA');
    expect(oled.isDark).toBe(true);
  });

  it('falls back to warm-paper for unknown or null theme IDs', () => {
    expect(getAppThemeTokens(null).id).toBe('warm-paper');
    expect(getAppThemeTokens(undefined).id).toBe('warm-paper');
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
});
