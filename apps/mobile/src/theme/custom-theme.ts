/**
 * F32 — ألوان مخصّصة: from two colours the reader picked to a full, harmonious theme.
 *
 * A custom pair is not just "paint the page bg and the text": footnotes, quotes, popovers, the
 * HUD, the settings sheet and the open-book spine all need a token too, or the page looks like a
 * colour swatch with a book inside it. Everything here is derived from `bg` + `text` alone:
 *
 * - `muted`  — the ink walked a little towards the paper (still ≥ AA on the page),
 * - `quote*` — a faint wash of the ink plus an accent taken from the ink's own hue,
 * - popover — the paper lifted towards white (light) or a touch lighter (dark),
 * - spine   — a neutral shade of the paper so the spread crease reads on any background.
 *
 * This is the React Native twin of `packages/reader-engine/src/spread.ts` (the WebView cannot
 * import from here and vice versa). The two must stay numerically identical; the mobile and
 * engine test suites pin the same contrast invariants.
 */
import type { ThemeTokens } from '../../../../packages/reader-engine/src/types';
import type { AppThemeTokens } from './types';
import {
  DARK_BG_LUMINANCE_THRESHOLD,
  contrastRatio,
  formatContrastRatio,
  hexToRgb,
  normalizeHexColor,
  readableTextOn,
  relativeLuminance,
  type Rgb,
} from './wcag';

/** The stored shape of a custom pair (mirrors `CustomReaderColors` in the reader engine). */
export type CustomColors = {
  bg: string;
  text: string;
  enabled: boolean;
};

/** Warraq's own paper + ink, so the picker opens on something that already looks like a book. */
export const DEFAULT_CUSTOM_COLORS: CustomColors = {
  bg: '#FAF7F0',
  text: '#231F1A',
  enabled: false,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toHexChannel(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

function rgbToHex(rgb: Rgb): string {
  return `#${toHexChannel(rgb.r / 255)}${toHexChannel(rgb.g / 255)}${toHexChannel(rgb.b / 255)}`;
}

/** Blend `from` towards `to`; `weight` is the share of `to` (0..1). */
export function mixHexColors(from: string, to: string, weight: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return normalizeHexColor(from) ?? '#000000';
  const w = clamp01(weight);
  return rgbToHex({
    r: a.r + (b.r - a.r) * w,
    g: a.g + (b.g - a.g) * w,
    b: a.b + (b.b - a.b) * w,
  });
}

/** `#RRGGBB` + alpha → the `rgba(...)` form used for wash tints. */
export function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const a = Math.round(clamp01(alpha) * 1000) / 1000;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

export function isDarkHexColor(hex: string): boolean {
  return relativeLuminance(hex) < DARK_BG_LUMINANCE_THRESHOLD;
}

function rgbToHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/**
 * An accent that belongs to the reader's own ink: the text hue pushed to a lightness that can
 * carry a quote border / CTA on this background. A neutral ink inherits the Warraq red family so
 * the page keeps a warm accent instead of turning grey.
 */
export function accentForTextOnBg(textHex: string, bgHex: string): string {
  const rgb = hexToRgb(textHex);
  const dark = isDarkHexColor(bgHex);
  if (!rgb) return dark ? '#DF7863' : '#9E3E2F';
  const hsl = rgbToHsl(rgb);
  if (hsl.s < 0.08) return dark ? '#DF7863' : '#9E3E2F';
  const lightness = dark ? 0.72 : 0.38;
  const saturation = Math.max(0.22, Math.min(0.9, hsl.s + 0.08));
  return rgbToHex(hslToRgb(hsl.h, saturation, lightness));
}

/** Reading tokens (engine side) derived from a `bg` / `text` pair. */
export function buildCustomThemeTokens(bgHex: string, textHex: string): ThemeTokens {
  const bg = normalizeHexColor(bgHex) ?? DEFAULT_CUSTOM_COLORS.bg;
  const text = normalizeHexColor(textHex) ?? DEFAULT_CUSTOM_COLORS.text;
  const dark = isDarkHexColor(bg);
  const accent = accentForTextOnBg(text, bg);

  return {
    bg,
    text,
    heading: dark ? mixHexColors(text, '#FFFFFF', 0.12) : text,
    muted: mixHexColors(text, bg, dark ? 0.4 : 0.32),
    quoteBg: rgbaFromHex(text, dark ? 0.06 : 0.045),
    quoteBorder: accent,
    accent,
    popoverBg: dark ? mixHexColors(bg, '#FFFFFF', 0.07) : mixHexColors(bg, '#FFFFFF', 0.7),
    popoverBorder: mixHexColors(bg, text, dark ? 0.24 : 0.16),
  };
}

/**
 * App chrome (HUD, sheets, covers) for a custom pair: the same reading tokens, plus the surfaces
 * the rest of the app draws with. `id`/`coverPalettes` stay the base theme's — the app still has
 * to know which preset a custom pair was built on top of.
 */
export function buildCustomAppTheme(
  baseTheme: AppThemeTokens,
  bgHex: string,
  textHex: string,
): AppThemeTokens {
  const tokens = buildCustomThemeTokens(bgHex, textHex);
  const dark = isDarkHexColor(tokens.bg);
  const shade = dark
    ? mixHexColors(tokens.bg, '#FFFFFF', 0.4)
    : mixHexColors(tokens.bg, '#000000', 0.4);
  const ctaText = readableTextOn(tokens.accent);
  const panelBg = dark
    ? mixHexColors(tokens.bg, '#FFFFFF', 0.06)
    : mixHexColors(tokens.bg, '#FFFFFF', 0.55);

  return {
    ...baseTheme,
    ...tokens,
    id: baseTheme.id,
    labelAr: 'ألوان مخصّصة',
    // The number the picker showed: the page's own ink on its own paper.
    contrastLabel: formatContrastRatio(contrastRatio(tokens.text, tokens.bg)),
    isDark: dark,
    deskBg: mixHexColors(tokens.bg, '#000000', dark ? 0.18 : 0.1),
    boardRim: mixHexColors(tokens.bg, tokens.text, 0.18),
    surface: dark ? mixHexColors(tokens.bg, '#FFFFFF', 0.05) : mixHexColors(tokens.bg, '#FFFFFF', 0.45),
    surfaceElevated: tokens.popoverBg,
    hudBg: rgbaFromHex(tokens.bg, 0.94),
    sheetBg: panelBg,
    border: tokens.popoverBorder,
    accentSoft: rgbaFromHex(tokens.accent, dark ? 0.2 : 0.12),
    ctaBg: tokens.accent,
    ctaText,
    onAccent: ctaText,
    ribbon: tokens.accent,
    ribbonDeep: mixHexColors(tokens.accent, '#000000', 0.28),
    ribbonStitch: rgbaFromHex(ctaText, 0.28),
    pageEdge: rgbaFromHex(shade, dark ? 0.2 : 0.3),
    pageEdgeBg: dark ? mixHexColors(tokens.bg, '#FFFFFF', 0.04) : mixHexColors(tokens.bg, '#000000', 0.06),
    spineCrease: rgbaFromHex(shade, dark ? 0.22 : 0.24),
    spineShadowInner: rgbaFromHex(shade, dark ? 0.1 : 0.11),
    coverRim: rgbaFromHex(tokens.text, 0.12),
    chipBg: rgbaFromHex(tokens.text, dark ? 0.06 : 0.045),
    chipActiveBg: rgbaFromHex(tokens.accent, dark ? 0.2 : 0.12),
    chipBorder: tokens.popoverBorder,
    scrubberTrack: tokens.popoverBorder,
    scrim: rgbaFromHex(mixHexColors(tokens.bg, '#000000', 0.6), dark ? 0.52 : 0.42),
    danger: dark ? '#EF8A76' : '#9E3E2F',
    paperGrainOpacity: dark ? 0.018 : 0.032,
    coverPalettes: baseTheme.coverPalettes,
  };
}
