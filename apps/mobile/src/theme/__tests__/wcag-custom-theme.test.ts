import { getAppThemeTokens } from '@/theme/reader-theme';
import {
  DEFAULT_CUSTOM_COLORS,
  accentForTextOnBg,
  buildCustomAppTheme,
  buildCustomThemeTokens,
  isApplicableCustomPair,
  mixHexColors,
  rgbaFromHex,
} from '@/theme/custom-theme';
import {
  WCAG_AA_MIN_RATIO,
  contrastRatio,
  formatContrastRatio,
  isDarkColor,
  normalizeHexColor,
  readableTextOn,
  relativeLuminance,
  wcagGrade,
} from '@/theme/wcag';

/** Warraq's own paper + ink — the pair the picker opens on. */
const WARRAQ = { bg: '#FAF7F0', text: '#231F1A' };
/** A night-reading pair the reader can build from the dark swatches. */
const NIGHT = { bg: '#101820', text: '#F2E8D5' };

describe('wcag — WCAG 2.1 contrast maths', () => {
  it('normalizes #RGB / #RRGGBB (case-insensitive, # optional) and rejects everything else', () => {
    expect(normalizeHexColor('#faf7f0')).toBe('#FAF7F0');
    expect(normalizeHexColor('  #FaF7F0 ')).toBe('#FAF7F0');
    expect(normalizeHexColor('#abc')).toBe('#AABBCC');
    expect(normalizeHexColor('abc')).toBe('#AABBCC');
    expect(normalizeHexColor('FAF7F0')).toBe('#FAF7F0');

    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('#GGGGGG')).toBeNull();
    expect(normalizeHexColor('rgb(0,0,0)')).toBeNull();
    // @ts-expect-error — a stored value can be any JSON type, so the guard must survive it.
    expect(normalizeHexColor(null)).toBeNull();
  });

  it('computes the exact WCAG relative luminance of black and white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    // Ordered channels: green is weighted most, blue least.
    expect(relativeLuminance('#00FF00')).toBeGreaterThan(relativeLuminance('#FF0000'));
    expect(relativeLuminance('#FF0000')).toBeGreaterThan(relativeLuminance('#0000FF'));
  });

  it('gives 21:1 for black on white, and is symmetric', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 6);
    expect(contrastRatio('#FAF7F0', '#FAF7F0')).toBeCloseTo(1, 6);
    // The Warraq page itself is a AAA pair (the theme advertises 15.3:1).
    expect(contrastRatio(WARRAQ.text, WARRAQ.bg)).toBeGreaterThanOrEqual(14);
    expect(formatContrastRatio(contrastRatio(WARRAQ.text, WARRAQ.bg))).toBe('15.3:1');
  });

  it('grades ratios at the WCAG thresholds', () => {
    expect(wcagGrade(21)).toMatchObject({ level: 'AAA', labelAr: 'ممتاز AAA', pass: true });
    expect(wcagGrade(7)).toMatchObject({ level: 'AAA', pass: true });
    expect(wcagGrade(4.5)).toMatchObject({ level: 'AA', labelAr: 'جيد AA', pass: true });
    expect(wcagGrade(4.49)).toMatchObject({ level: 'AA-large', labelAr: 'للخط الكبير فقط', pass: false });
    expect(wcagGrade(3)).toMatchObject({ level: 'AA-large', pass: false });
    expect(wcagGrade(2.99)).toMatchObject({
      level: 'fail',
      labelAr: 'تباين ضعيف — متعب للعين',
      pass: false,
    });
    expect(wcagGrade(Number.NaN).level).toBe('fail');
  });

  it('flags a low-contrast pair as a failure that the picker must warn about', () => {
    const ratio = contrastRatio('#8E8E8E', '#A0A0A0');
    expect(ratio).toBeLessThan(WCAG_AA_MIN_RATIO);
    expect(wcagGrade(ratio).level).not.toBe('AAA');
    expect(wcagGrade(ratio).pass).toBe(false);
  });

  it('splits light and dark backgrounds at WCAG’s 0.179 luminance', () => {
    expect(isDarkColor('#000000')).toBe(true);
    expect(isDarkColor('#101820')).toBe(true);
    expect(isDarkColor('#FFFFFF')).toBe(false);
    expect(isDarkColor(WARRAQ.bg)).toBe(false);
    // The threshold itself: #757575 sits just under 0.179, #767676 just over (WCAG's own example).
    expect(isDarkColor('#757575')).toBe(true);
    expect(isDarkColor('#767676')).toBe(false);
  });

  it('formats the ratio the way the badge quotes it and picks readable CTA text', () => {
    expect(formatContrastRatio(21)).toBe('21.0:1');
    expect(formatContrastRatio(4.53)).toBe('4.5:1');
    // Floored, never rounded up: 4.478 must not display as «4.5:1» beside a «below 4.5» warning.
    expect(formatContrastRatio(4.4780894535)).toBe('4.4:1');
    expect(formatContrastRatio(contrastRatio('#777777', '#FFFFFF'))).toBe('4.4:1');
    expect(readableTextOn('#101820')).toBe('#FFFBF7');
    expect(contrastRatio(readableTextOn('#E3C58C'), '#E3C58C')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('custom-theme — tokens derived from a bg/text pair', () => {
  it('keeps the chosen pair intact and derives every supporting token from it', () => {
    const tokens = buildCustomThemeTokens(WARRAQ.bg, WARRAQ.text);

    expect(tokens.bg).toBe(WARRAQ.bg);
    expect(tokens.text).toBe(WARRAQ.text);
    expect(tokens.heading).toBe(WARRAQ.text);
    // Cross-pinned with the engine spec: the same pair gives the same tokens in both twins.
    expect(tokens.muted).toBe('#68645E');
    expect(tokens.accent).toBe('#77634B');
    expect(tokens.popoverBg).toBe('#FEFDFB');

    // Muted text is a real hex colour, still AA on the page.
    expect(normalizeHexColor(tokens.muted)).toBe(tokens.muted);
    expect(contrastRatio(tokens.muted, tokens.bg)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);

    // Quote / popover tokens are the shapes the stylesheet expects.
    expect(tokens.quoteBg).toMatch(/^rgba\(/);
    expect(tokens.quoteBorder).toBe(tokens.accent);
    expect(normalizeHexColor(tokens.accent)).toBe(tokens.accent);
    expect(normalizeHexColor(tokens.popoverBg)).toBe(tokens.popoverBg);
    expect(normalizeHexColor(tokens.popoverBorder)).toBe(tokens.popoverBorder);
    // A light page lifts its popover towards white, so a footnote reads as paper-on-paper.
    expect(relativeLuminance(tokens.popoverBg)).toBeGreaterThan(relativeLuminance(tokens.bg));
  });

  it('produces a polished dark pair without copying Warraq tokens', () => {
    const tokens = buildCustomThemeTokens(NIGHT.bg, NIGHT.text);
    const warraq = getAppThemeTokens('warraq');

    expect(tokens.bg).toBe(NIGHT.bg);
    expect(tokens.text).toBe(NIGHT.text);
    // Pinned to the exact numbers the engine derives for the same pair (see
    // `packages/reader-engine/test/custom-colors.spec.ts`): the two twins must not drift apart.
    expect(tokens.heading).toBe('#F4EBDA');
    expect(tokens.muted).toBe('#98958D');
    expect(tokens.quoteBg).toBe('rgba(242, 232, 213, 0.06)');
    expect(tokens.accent).toBe('#E3C58C');
    expect(tokens.popoverBg).toBe('#0D141B');
    expect(tokens.popoverBorder).toBe('#464A4B');

    expect(tokens.heading).not.toBe(NIGHT.text); // lifted towards white so headings pop
    expect(relativeLuminance(tokens.heading!)).toBeGreaterThan(relativeLuminance(NIGHT.text));
    expect(contrastRatio(tokens.muted, tokens.bg)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
    expect(tokens.accent).not.toBe(warraq.accent);
    // Accent carries a quote border, so it must be visible on the page (large-text minimum).
    expect(contrastRatio(tokens.accent, tokens.bg)).toBeGreaterThanOrEqual(3);
    expect(tokens.popoverBg).not.toBe(warraq.popoverBg);
  });

  it('inherits the ink hue for the accent, and falls back to the brand red for a neutral ink', () => {
    // A navy ink gives a navy family accent; a neutral ink gives Warraq's red.
    const navy = accentForTextOnBg('#1F3A5F', '#FAF7F0');
    expect(contrastRatio(navy, '#FAF7F0')).toBeGreaterThanOrEqual(4.5);
    // A colourless ink has no hue to inherit, so the Warraq red family keeps the page warm.
    expect(accentForTextOnBg('#808080', '#FAF7F0')).toBe('#9E3E2F');
    expect(accentForTextOnBg('#808080', '#101820')).toBe('#DF7863');
  });

  it('falls back to the default pair instead of emitting an invalid colour', () => {
    const tokens = buildCustomThemeTokens('not-a-colour', '#12345');
    expect(tokens.bg).toBe(DEFAULT_CUSTOM_COLORS.bg);
    expect(tokens.text).toBe(DEFAULT_CUSTOM_COLORS.text);
  });

  it('mixes and tints colours deterministically', () => {
    expect(mixHexColors('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mixHexColors('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mixHexColors('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(rgbaFromHex('#231F1A', 0.045)).toBe('rgba(35, 31, 26, 0.045)');
  });
});

describe('custom-theme — derived surfaces stay readable on borderline pairs', () => {
  /** Pairs that barely pass AA — the ones the old fixed-lightness derivation broke. */
  const BORDERLINE = [
    { name: 'white on mid grey', bg: '#757575', text: '#FFFFFF' },
    { name: 'white on lighter grey', bg: '#767676', text: '#FFFFFF' },
    { name: 'dark ink on mid-light paper', bg: '#9A948A', text: '#0F0F0F' },
    { name: 'warm ink on cream', bg: '#F3EBD6', text: '#5B4A32' },
    { name: 'night ink', bg: '#101820', text: '#F2E8D5' },
  ] as const;

  it.each(BORDERLINE)('$name: every text token clears AA on the page and the popover', ({ bg, text }) => {
    const tokens = buildCustomThemeTokens(bg, text);
    // The pair itself passes (otherwise the picker would have blocked it)…
    expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
    // …and so does every derived token, on both surfaces the reader can read them from.
    for (const surface of [tokens.bg, tokens.popoverBg]) {
      expect(contrastRatio(tokens.text, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
      expect(contrastRatio(tokens.heading!, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
      expect(contrastRatio(tokens.muted, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
      expect(contrastRatio(tokens.accent, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
    }
    // The surface moves away from the ink, so it can never wash the text out.
    expect(contrastRatio(text, tokens.popoverBg)).toBeGreaterThanOrEqual(contrastRatio(text, bg));
  });

  it('pushes a light-ink popover towards black instead of lifting it towards white', () => {
    const tokens = buildCustomThemeTokens('#757575', '#FFFFFF');
    expect(relativeLuminance(tokens.popoverBg)).toBeLessThan(relativeLuminance('#757575'));
  });

  it('keeps the footnote (muted) readable instead of fading it below AA', () => {
    const tokens = buildCustomThemeTokens('#757575', '#FFFFFF');
    // The old 40% walk produced ~2.2:1 on this paper; the guarded walk gives up on "faded" and
    // keeps the ink readable.
    expect(contrastRatio(tokens.muted, tokens.popoverBg)).toBeGreaterThanOrEqual(
      WCAG_AA_MIN_RATIO,
    );
  });
});

describe('custom-theme — what actually counts as an applicable pair', () => {
  it('accepts a real AA pair and rejects everything the engine would reject', () => {
    expect(isApplicableCustomPair('#757575', '#FFFFFF')).toBe(true);
    // 4.478:1 — under AA, so neither the page nor the chrome may paint it.
    expect(isApplicableCustomPair('#FFFFFF', '#777777')).toBe(false);
    expect(isApplicableCustomPair('#12', '#F2E8D5')).toBe(false);
    expect(isApplicableCustomPair(undefined, '#F2E8D5')).toBe(false);
    expect(isApplicableCustomPair(null, null)).toBe(false);
  });
});

describe('custom-theme — app chrome built over a base theme', () => {
  it('applies the pair over Warraq without losing the theme identity', () => {
    const base = getAppThemeTokens('warraq');
    const theme = buildCustomAppTheme(base, NIGHT.bg, NIGHT.text);

    expect(theme.id).toBe('warraq');
    expect(theme.labelAr).toBe('ألوان مخصّصة');
    expect(theme.bg).toBe(NIGHT.bg);
    expect(theme.text).toBe(NIGHT.text);
    expect(theme.heading).toBe(buildCustomThemeTokens(NIGHT.bg, NIGHT.text).heading);
    expect(theme.isDark).toBe(true);
    expect(theme.contrastLabel).toBe(formatContrastRatio(contrastRatio(NIGHT.text, NIGHT.bg)));
    // The label is the page's own pair, not Warraq's advertised 15.3:1.
    expect(theme.contrastLabel).not.toBe(base.contrastLabel);
    // Chrome surfaces follow the custom paper instead of staying Warraq cream.
    expect(theme.surface).not.toBe(base.surface);
    expect(theme.sheetBg).not.toBe(base.sheetBg);
    expect(theme.deskBg).not.toBe(base.deskBg);
    // Covers keep the base palettes; the library still looks like the app.
    expect(theme.coverPalettes).toBe(base.coverPalettes);
  });

  it('keeps the CTA readable on the derived accent, for both a light and a dark pair', () => {
    for (const pair of [WARRAQ, NIGHT]) {
      const theme = buildCustomAppTheme(getAppThemeTokens('warraq'), pair.bg, pair.text);
      expect(theme.ctaBg).toBe(buildCustomThemeTokens(pair.bg, pair.text).accent);
      expect(theme.ctaText).toBe(theme.onAccent);
      expect(contrastRatio(theme.ctaText, theme.ctaBg)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
      // The sheet/HUD text must stay legible on the custom paper.
      expect(contrastRatio(theme.text, theme.bg)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
    }
  });

  it('keeps HUD / sheet / surface text readable for a borderline pair', () => {
    for (const pair of [
      { bg: '#757575', text: '#FFFFFF' },
      { bg: '#767676', text: '#FFFFFF' },
      { bg: '#F3EBD6', text: '#5B4A32' },
      { bg: '#101820', text: '#F2E8D5' },
    ]) {
      const theme = buildCustomAppTheme(getAppThemeTokens('warraq'), pair.bg, pair.text);
      const surfaces = [theme.bg, theme.popoverBg, theme.sheetBg, theme.surface];
      for (const surface of surfaces) {
        for (const ink of [theme.text, theme.heading ?? theme.text, theme.muted, theme.accent]) {
          expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
        }
      }
      // The active settings tab draws the accent on the sheet, so that pair must pass too.
      expect(contrastRatio(theme.accent, theme.sheetBg)).toBeGreaterThanOrEqual(
        WCAG_AA_MIN_RATIO,
      );
    }
  });
});
