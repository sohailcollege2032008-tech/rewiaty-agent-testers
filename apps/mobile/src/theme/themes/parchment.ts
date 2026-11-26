import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «رَقّ مخطوط»: a warm vellum page, lighter and cooler than sepia. */
export const parchmentTheme = buildAppTheme({
  id: 'parchment',
  labelAr: 'رَقّ مخطوط',
  category: 'light',
  isDark: false,
  tokens: THEMES.parchment,
  deskBg: '#EDE4D0',
  boardRim: '#D9CCB0',
  surface: '#F1E9D8',
  surfaceElevated: '#FFFCF3',
  hudBg: 'rgba(246, 240, 226, 0.95)',
  sheetBg: 'rgba(249, 243, 231, 1)',
  border: '#E3D9C4',
  accentSoft: 'rgba(138, 106, 60, 0.12)',
  ctaBg: '#7A5C33',
  ctaText: '#FFFBF2',
  ribbon: '#8A6A3C',
  ribbonDeep: '#684D2A',
  pageEdge: 'rgba(126, 108, 76, 0.24)',
  pageEdgeBg: '#F3EBD9',
  spineCrease: 'rgba(66, 52, 30, 0.22)',
  spineShadowInner: 'rgba(66, 52, 30, 0.1)',
  paperGrainOpacity: 0.03,
});
