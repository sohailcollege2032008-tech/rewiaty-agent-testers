import { contrastRatio } from '../../../../../packages/reader-engine/src/types';
import type { ThemeId, ThemeTokens } from '../../../../../packages/reader-engine/src/types';
import type { AppThemeTokens, CoverSwatchPalette, ThemeCategory } from '../types';

/**
 * F31 — theme factory.
 *
 * The nine «موسوعة الثيمات» themes share one shape: a reading palette plus the ~30 chrome tokens
 * the app needs (HUD, sheet, chips, ribbon, spine). Writing those by hand nine times invites drift
 * in tokens nobody looks at (chipBg, scrim, ribbonStitch), so the seed only carries what actually
 * differs and the factory derives the rest from it.
 */
export type ThemeSeed = {
  id: ThemeId;
  labelAr: string;
  category: ThemeCategory;
  isDark: boolean;
  /** The reading surface: bg/text/muted/quote/accent/popover. */
  tokens: ThemeTokens;
  deskBg: string;
  boardRim: string;
  surface: string;
  surfaceElevated: string;
  hudBg: string;
  /** Fully opaque: text must never bleed through the sheet. */
  sheetBg: string;
  border: string;
  accentSoft: string;
  ctaBg: string;
  ctaText: string;
  ribbon: string;
  ribbonDeep: string;
  pageEdge: string;
  pageEdgeBg: string;
  spineCrease: string;
  spineShadowInner: string;
  paperGrainOpacity: number;
  coverPalettes?: readonly CoverSwatchPalette[];
};

/** The Warraq cover palette set — shared by every F31 theme so covers stay a house style. */
export const DEFAULT_COVER_PALETTES: readonly CoverSwatchPalette[] = [
  { bg: '#2F5356', ink: '#F5EFE4', line: '#D9C5A3', spine: '#1F3A3C' },
  { bg: '#733329', ink: '#FAF3E8', line: '#E5C6A2', spine: '#512119' },
  { bg: '#3B4A3A', ink: '#F4F1E8', line: '#CFD0B8', spine: '#263125' },
  { bg: '#5B422E', ink: '#FAF3E6', line: '#E2CBA8', spine: '#3D2B1D' },
  { bg: '#2B3B52', ink: '#F2F0EA', line: '#BCC8DB', spine: '#1B2738' },
  { bg: '#5A3847', ink: '#FAF2F5', line: '#E3C2CE', spine: '#3D242F' },
  { bg: '#6C542B', ink: '#FCF7EC', line: '#EAD7B0', spine: '#4A391C' },
];

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

export function toArabicDigits(value: string): string {
  return value.replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)]!);
}

/**
 * `12.79` → `١٢.٨:١ AAA`. One decimal, Arabic-Indic digits, matching the hand-written labels the
 * four core themes already ship.
 */
export function formatContrastLabel(ratio: number): string {
  const rounded = Math.round(ratio * 10) / 10;
  return `${toArabicDigits(rounded.toFixed(1))}:١ AAA`;
}

/** Convert `#rrggbb` + alpha into an `rgba()` string (drops the `#`). */
function hexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildAppTheme(seed: ThemeSeed): AppThemeTokens {
  const { tokens } = seed;
  const textOnBg = contrastRatio(tokens.text, tokens.bg);
  const chromeAlpha = seed.isDark ? 0.05 : 0.045;

  return {
    ...tokens,
    id: seed.id,
    labelAr: seed.labelAr,
    contrastLabel: formatContrastLabel(textOnBg),
    isDark: seed.isDark,
    category: seed.category,
    deskBg: seed.deskBg,
    boardRim: seed.boardRim,
    surface: seed.surface,
    surfaceElevated: seed.surfaceElevated,
    hudBg: seed.hudBg,
    sheetBg: seed.sheetBg,
    border: seed.border,
    accentSoft: seed.accentSoft,
    ctaBg: seed.ctaBg,
    ctaText: seed.ctaText,
    onAccent: seed.ctaText,
    ribbon: seed.ribbon,
    ribbonDeep: seed.ribbonDeep,
    ribbonStitch: hexAlpha(seed.ctaText, seed.isDark ? 0.26 : 0.28),
    pageEdge: seed.pageEdge,
    pageEdgeBg: seed.pageEdgeBg,
    spineCrease: seed.spineCrease,
    spineShadowInner: seed.spineShadowInner,
    coverRim: hexAlpha(tokens.text, seed.isDark ? 0.14 : 0.1),
    coverPalettes: seed.coverPalettes ?? DEFAULT_COVER_PALETTES,
    chipBg: hexAlpha(tokens.text, chromeAlpha),
    chipActiveBg: seed.accentSoft,
    chipBorder: seed.border,
    scrubberTrack: seed.border,
    scrim: seed.isDark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(20, 17, 14, 0.42)',
    danger: tokens.accent,
    paperGrainOpacity: seed.paperGrainOpacity,
  };
}
