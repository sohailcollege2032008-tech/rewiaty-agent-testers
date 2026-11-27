/**
 * F32 — WCAG 2.1 contrast maths for the custom-colours picker.
 *
 * Pure functions only: no React, no theme objects, no side effects. The picker shows a live
 * ratio under the preview, so the same numbers have to come out every time the user drags a
 * slider or edits a hex string, and they have to agree with the reader engine's own derivation
 * (`packages/reader-engine/src/spread.ts`) — hence the exact WCAG sRGB linearisation below,
 * not an approximation of it.
 *
 * Reference: WCAG 2.1 §1.4.3 (contrast minimum), §1.4.6 (enhanced), relative-luminance and
 * contrast-ratio definitions.
 */

export type WcagLevel = 'AAA' | 'AA' | 'AA-large' | 'fail';

export type WcagGrade = {
  level: WcagLevel;
  labelAr: string;
  /** true at «AA» and above — the threshold the picker warns below. */
  pass: boolean;
};

/** WCAG's own split between "light" and "dark" backgrounds (relative luminance). */
export const DARK_BG_LUMINANCE_THRESHOLD = 0.179;

/** Minimum ratio a normal-size text pair needs to pass WCAG AA. */
export const WCAG_AA_MIN_RATIO = 4.5;

const HEX_SHORT = /^[0-9a-fA-F]{3}$/;
const HEX_LONG = /^[0-9a-fA-F]{6}$/;

export type Rgb = { r: number; g: number; b: number };

/**
 * Validates `#RGB` / `#RRGGBB` (the `#` is optional and case is ignored) and returns the
 * canonical uppercase `#RRGGBB` form, or `null` when the string is not a colour at all.
 *
 * Normalising here — instead of at every call site — is what keeps a half-typed hex string from
 * ever reaching the stylesheet: callers store only what this function returned.
 */
export function normalizeHexColor(input: string): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().replace(/^#/, '');
  if (HEX_SHORT.test(raw)) {
    return `#${raw[0]!}${raw[0]!}${raw[1]!}${raw[1]!}${raw[2]!}${raw[2]!}`.toUpperCase();
  }
  if (HEX_LONG.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }
  return null;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

/** sRGB channel (0..255) → linear-light value, exactly as WCAG 2.1 defines it. */
function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Relative luminance (0 = black, 1 = white). An invalid colour reads as black so callers can
 * still render something instead of `NaN` leaking into a style.
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

/** Contrast ratio between two colours, 1..21. Order does not matter. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const a = relativeLuminance(fgHex);
  const b = relativeLuminance(bgHex);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The badge's verdict for a ratio:
 *   ≥ 7      → AAA
 *   ≥ 4.5    → AA
 *   ≥ 3      → AA-large (large text only)
 *   < 3      → fail
 */
export function wcagGrade(ratio: number): WcagGrade {
  if (!Number.isFinite(ratio)) {
    return { level: 'fail', labelAr: 'تباين ضعيف — متعب للعين', pass: false };
  }
  if (ratio >= 7) return { level: 'AAA', labelAr: 'ممتاز AAA', pass: true };
  if (ratio >= WCAG_AA_MIN_RATIO) return { level: 'AA', labelAr: 'جيد AA', pass: true };
  if (ratio >= 3) return { level: 'AA-large', labelAr: 'للخط الكبير فقط', pass: false };
  return { level: 'fail', labelAr: 'تباين ضعيف — متعب للعين', pass: false };
}

/** true for a background that WCAG itself treats as dark. */
export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) < DARK_BG_LUMINANCE_THRESHOLD;
}

/**
 * `21` → `"21.0:1"` — one decimal, the way contrast is quoted everywhere else in the app.
 *
 * The tenth is *floored*, never rounded up: `#777777` on `#FFFFFF` is 4.478:1, and showing it as
 * «4.5:1» would sit next to a «less than 4.5:1» warning — the badge must never contradict itself.
 * The `1e-9` absorbs binary floating-point noise so an exact `4.5` still reads «4.5:1».
 */
export function formatContrastRatio(ratio: number): string {
  const safe = Number.isFinite(ratio) ? Math.max(1, Math.min(21, ratio)) : 1;
  return `${(Math.floor(safe * 10 + 1e-9) / 10).toFixed(1)}:1`;
}

/** Black or white — whichever is actually readable on `hex` (used for CTA text on a custom accent). */
export function readableTextOn(hex: string): string {
  const onWhite = contrastRatio(hex, '#FFFFFF');
  const onBlack = contrastRatio(hex, '#0B0B0C');
  return onWhite >= onBlack ? '#FFFBF7' : '#0B0B0C';
}
