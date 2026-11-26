import type { ThemeId, ThemeTokens } from './types.js';

/**
 * Two-page open-book spread (R2).
 *
 * The values below come from the design source of truth:
 * `.factory/design/warraq/tablet/tokens.json` →
 *   viewports.landscape = { width: 1366, height: 1024, columns: 2,
 *                           spreadGutterPx: 108, maxLineMeasureCh: 54 }
 * and the matching spine tokens of each theme (light / dark-burnt / dark-ink / dark-oled).
 *
 * They are mirrored here as CSS custom properties by the paginator so the stylesheet
 * never hard-codes a design number.
 */

/** Minimum viewport width for a readable spread (below this the columns get too narrow). */
export const SPREAD_MIN_VIEWPORT_PX = 900;

/** Width of the centre gutter (the "spine crease") in px — tokens.landscape.spreadGutterPx. */
export const SPREAD_GUTTER_PX = 108;

/** Max characters per column on a spread — tokens.landscape.maxLineMeasureCh. */
export const SPREAD_MAX_MEASURE_CH = 54;

export type SpineTokens = {
  /** darkest line exactly at the fold */
  crease: string;
  /** shadow bleeding onto the paper */
  inner: string;
  /** the far, softer falloff */
  mid: string;
  /** highlight / light catching the paper next to the fold */
  sheen: string;
  /** the paper edge of the whole book */
  pageEdge: string;
};

/**
 * Warraq theme → spine tokens. `warraq` and `sepia` are paper-light,
 * `burnt-paper` is the warm dark and `oled-crimson` the true-black OLED family.
 */
const SPINE_BY_THEME: Record<ThemeId, SpineTokens> = {
  warraq: {
    crease: 'rgba(54, 42, 28, 0.24)',
    inner: 'rgba(54, 42, 28, 0.11)',
    mid: 'rgba(54, 42, 28, 0.045)',
    sheen: 'rgba(255, 253, 248, 0.52)',
    pageEdge: 'rgba(110, 96, 78, 0.3)',
  },
  sepia: {
    crease: 'rgba(62, 44, 24, 0.26)',
    inner: 'rgba(62, 44, 24, 0.12)',
    mid: 'rgba(62, 44, 24, 0.05)',
    sheen: 'rgba(255, 248, 232, 0.46)',
    pageEdge: 'rgba(115, 95, 75, 0.3)',
  },
  'burnt-paper': {
    crease: 'rgba(0, 0, 0, 0.72)',
    inner: 'rgba(0, 0, 0, 0.42)',
    mid: 'rgba(0, 0, 0, 0.16)',
    sheen: 'rgba(255, 238, 220, 0.035)',
    pageEdge: 'rgba(222, 207, 192, 0.2)',
  },
  'oled-crimson': {
    crease: 'rgba(210, 198, 185, 0.16)',
    inner: 'rgba(210, 198, 185, 0.035)',
    mid: 'rgba(0, 0, 0, 0)',
    sheen: 'rgba(255, 255, 255, 0.02)',
    pageEdge: 'rgba(185, 178, 167, 0.15)',
  },
};

export function spineTokensFor(theme: ThemeId): SpineTokens {
  return Object.hasOwn(SPINE_BY_THEME, theme) ? SPINE_BY_THEME[theme] : SPINE_BY_THEME.warraq;
}

/**
 * `ch` is roughly half an em for the Arabic book faces, so a measure of N characters
 * is about N * 0.5 * fontSize px. Used only to cap how wide the open book may grow.
 */
export function measureChToPx(ch: number, fontSize: number): number {
  return Math.round(Math.max(24, Math.min(SPREAD_MAX_MEASURE_CH, ch)) * fontSize * 0.5);
}

/* ------------------------------------------------------------------------------------------
 * F32 — ألوان مخصّصة: colour maths for the reading surface.
 *
 * The reader must be able to paint a page in a pair of colours the reader picked, and still
 * look like a book: muted running text, a quiet quote tint, a popover that lifts off the page
 * and a spine that reads correctly on both a paper-light and an ink-dark background. Every
 * token below is derived from just the two colours the user chose, so there is no theme to
 * hand-tune and no combination that produces an invisible footnote.
 *
 * `apps/mobile/src/theme/custom-theme.ts` carries the same derivation for React Native (the two
 * runtimes cannot share a module): any change here has to be mirrored there, and the two test
 * suites pin the same contrast invariants so they cannot drift apart silently.
 * ------------------------------------------------------------------------------------------ */

export type RgbColor = { r: number; g: number; b: number };

/** WCAG 2.1 puts the light/dark split for "light background" text at 0.179 relative luminance. */
export const DARK_BG_LUMINANCE_THRESHOLD = 0.179;

/** `#RGB`/`#RRGGBB` (the leading `#` is optional) → `#RRGGBB` uppercase, or null when invalid. */
export function normalizeHexColor(input: string): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[0]!}${raw[0]!}${raw[1]!}${raw[1]!}${raw[2]!}${raw[2]!}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }
  return null;
}

export function hexToRgb(hex: string): RgbColor | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Exact WCAG 2.1 relative luminance of an sRGB hex colour (0 = black, 1 = white). */
export function relativeLuminanceHex(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

/** WCAG 2.1 contrast ratio between two hex colours (1..21); 1 for an invalid colour. */
export function contrastRatioHex(aHex: string, bHex: string): number {
  const a = relativeLuminanceHex(aHex);
  const b = relativeLuminanceHex(bHex);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function isDarkHexColor(hex: string): boolean {
  return relativeLuminanceHex(hex) < DARK_BG_LUMINANCE_THRESHOLD;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toHexChannel(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

function rgbToHex(rgb: RgbColor): string {
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

/** `#RRGGBB` + alpha → the `rgba(...)` form the stylesheet already uses for quote/highlight tints. */
export function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const a = Math.round(clamp01(alpha) * 1000) / 1000;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

function rgbToHsl(rgb: RgbColor): { h: number; s: number; l: number } {
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

function hslToRgb(h: number, s: number, l: number): RgbColor {
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
 * An accent that belongs to the reader's own ink: the text hue, pushed to a lightness that
 * can carry a quote border / CTA on this background. A neutral ink (no hue to inherit) falls
 * back to the Warraq brand red family so the page still has a warm accent.
 */
export function accentForTextOnBg(textHex: string, bgHex: string): string {
  const rgb = hexToRgb(textHex);
  if (!rgb) return isDarkHexColor(bgHex) ? '#DF7863' : '#9E3E2F';
  const hsl = rgbToHsl(rgb);
  const dark = isDarkHexColor(bgHex);
  if (hsl.s < 0.08) return dark ? '#DF7863' : '#9E3E2F';
  const lightness = dark ? 0.72 : 0.38;
  const saturation = Math.max(0.22, Math.min(0.9, hsl.s + 0.08));
  return rgbToHex(hslToRgb(hsl.h, saturation, lightness));
}

/**
 * Build a full set of reading tokens from just `bg` + `text`.
 *
 * Everything is derived, never invented: `muted` is the ink walked towards the paper, `quote*`
 * is a faint wash of the ink, the popover lifts by mixing the paper towards white, and the
 * spine is a neutral shade of the paper itself (so the open-book spread reads on any pair).
 */
export function buildCustomThemeTokens(bgHex: string, textHex: string): ThemeTokens {
  const bg = normalizeHexColor(bgHex) ?? '#FAF7F0';
  const text = normalizeHexColor(textHex) ?? '#231F1A';
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
 * Spine (open-book fold) tokens derived from the page colour instead of a theme id: the fold is
 * a darker shade of a light paper and a lighter one of a dark paper, so the crease is visible on
 * a custom background the same way it is on Warraq / Burnt Paper.
 */
export function spineTokensForColors(bgHex: string): SpineTokens {
  const bg = normalizeHexColor(bgHex) ?? '#FAF7F0';
  const dark = isDarkHexColor(bg);
  const shade = dark ? mixHexColors(bg, '#FFFFFF', 0.4) : mixHexColors(bg, '#000000', 0.4);
  const light = mixHexColors(bg, '#FFFFFF', 0.6);
  return {
    crease: rgbaFromHex(shade, dark ? 0.22 : 0.24),
    inner: rgbaFromHex(shade, dark ? 0.1 : 0.11),
    mid: rgbaFromHex(shade, dark ? 0.035 : 0.045),
    sheen: rgbaFromHex(light, dark ? 0.04 : 0.5),
    pageEdge: rgbaFromHex(shade, dark ? 0.2 : 0.3),
  };
}
