import type { ThemeId, ThemeTokens } from '../../../../packages/reader-engine/src/types';

export type CoverSwatchPalette = {
  bg: string;
  ink: string;
  line: string;
  spine: string;
};

export type AppThemeTokens = ThemeTokens & {
  id: ThemeId;
  labelAr: string;
  contrastLabel: string;
  isDark: boolean;
  deskBg: string;
  boardRim: string;
  surface: string;
  surfaceElevated: string;
  hudBg: string;
  sheetBg: string;
  border: string;
  accentSoft: string;
  ctaBg: string;
  ctaText: string;
  onAccent: string;
  ribbon: string;
  ribbonDeep: string;
  ribbonStitch: string;
  pageEdge: string;
  pageEdgeBg: string;
  spineCrease: string;
  spineShadowInner: string;
  coverRim: string;
  coverPalettes: readonly CoverSwatchPalette[];
  chipBg: string;
  chipActiveBg: string;
  chipBorder: string;
  scrubberTrack: string;
  scrim: string;
  danger: string;
  paperGrainOpacity: number;
};

export type ThemeOption = {
  id: ThemeId;
  labelAr: string;
  contrastLabel: string;
  isDark: boolean;
  bg: string;
  text: string;
  accent: string;
};
