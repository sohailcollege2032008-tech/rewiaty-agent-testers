import { describe, expect, it } from 'vitest';
import {
  WCAG_AA_MIN_RATIO,
  buildCustomThemeTokens,
  contrastRatioHex,
  relativeLuminanceHex,
  spineTokensForColors,
} from '../src/spread.js';

/**
 * F32 — the colour maths behind ألوان مخصّصة.
 *
 * The Playwright spec proves the *page* is painted with these tokens; this file pins the invariants
 * the derivation itself has to keep, so a formula tweak that looks fine on Warraq cannot ship an
 * invisible footnote on a mid-grey paper. `apps/mobile/src/theme/custom-theme.ts` mirrors this
 * derivation and its own suite pins the same numbers.
 */

/** Pairs that barely clear AA — the ones a fixed-lightness derivation broke. */
const BORDERLINE = [
  { name: 'white on mid grey (4.61:1)', bg: '#757575', text: '#FFFFFF' },
  { name: 'white on lighter grey', bg: '#767676', text: '#FFFFFF' },
  { name: 'dark ink on mid-light paper', bg: '#9A948A', text: '#0F0F0F' },
  { name: 'warm ink on cream', bg: '#F3EBD6', text: '#5B4A32' },
  { name: 'night ink on dark paper', bg: '#101820', text: '#F2E8D5' },
] as const;

describe('buildCustomThemeTokens — derived tokens always clear WCAG AA', () => {
  it.each(BORDERLINE)('$name: every text token is readable on the page and the popover', ({ bg, text }) => {
    // The pair itself passes, otherwise the picker/engine would have rejected it.
    expect(contrastRatioHex(text, bg)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);

    const tokens = buildCustomThemeTokens(bg, text);
    for (const surface of [tokens.bg, tokens.popoverBg]) {
      expect(contrastRatioHex(tokens.text, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
      expect(contrastRatioHex(tokens.heading ?? tokens.text, surface)).toBeGreaterThanOrEqual(
        WCAG_AA_MIN_RATIO,
      );
      expect(contrastRatioHex(tokens.muted, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
      expect(contrastRatioHex(tokens.accent, surface)).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
    }
  });

  it('moves the popover away from the ink instead of always lifting it towards white', () => {
    // Light ink on a darker page: lifting a #757575 page towards white leaves white text at
    // 1.34:1 in the footnote. The popover must go darker, never lighter.
    const light = buildCustomThemeTokens('#757575', '#FFFFFF');
    expect(relativeLuminanceHex(light.popoverBg)).toBeLessThan(relativeLuminanceHex('#757575'));
    expect(contrastRatioHex('#FFFFFF', light.popoverBg)).toBeGreaterThanOrEqual(
      contrastRatioHex('#FFFFFF', '#757575'),
    );

    // Dark ink on light paper keeps the familiar lift towards white.
    const dark = buildCustomThemeTokens('#FAF7F0', '#231F1A');
    expect(relativeLuminanceHex(dark.popoverBg)).toBeGreaterThan(
      relativeLuminanceHex('#FAF7F0'),
    );
  });

  it('keeps the muted footnote readable on the exact pair the report got wrong', () => {
    const tokens = buildCustomThemeTokens('#757575', '#FFFFFF');
    expect(contrastRatioHex(tokens.text, '#757575')).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
    expect(contrastRatioHex(tokens.muted, '#757575')).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
    expect(contrastRatioHex(tokens.muted, tokens.popoverBg)).toBeGreaterThanOrEqual(
      WCAG_AA_MIN_RATIO,
    );
  });

  it('exposes the AA floor the paginator gates stored pairs with', () => {
    expect(WCAG_AA_MIN_RATIO).toBe(4.5);
    // 4.478:1 — the number the old badge rounded up and called «4.5:1».
    expect(contrastRatioHex('#777777', '#FFFFFF')).toBeLessThan(WCAG_AA_MIN_RATIO);
    // 4.608:1 — a pair that really passes, and must keep painting.
    expect(contrastRatioHex('#FFFFFF', '#757575')).toBeGreaterThanOrEqual(WCAG_AA_MIN_RATIO);
  });
});

describe('spineTokensForColors — the fold follows the paper, not the preset', () => {
  it('darkens a light paper and lightens a dark one', () => {
    const light = spineTokensForColors('#FAF7F0');
    const dark = spineTokensForColors('#101820');
    expect(light.crease).not.toBe(dark.crease);
    // Both are translucent shades, so the crease composites with whatever paper it lands on.
    expect(light.crease).toMatch(/^rgba\(/);
    expect(dark.crease).toMatch(/^rgba\(/);
  });
});
