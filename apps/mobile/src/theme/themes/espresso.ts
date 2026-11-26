import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «قهوة داكنة»: a warm espresso night paper, brown instead of black. */
export const espressoTheme = buildAppTheme({
  id: 'espresso',
  labelAr: 'قهوة داكنة',
  category: 'warm',
  isDark: true,
  tokens: THEMES.espresso,
  deskBg: '#150E0A',
  boardRim: '#33251B',
  surface: '#2A1E17',
  surfaceElevated: '#2E211A',
  hudBg: 'rgba(34, 24, 18, 0.95)',
  sheetBg: 'rgba(38, 27, 20, 1)',
  border: '#3B2C22',
  accentSoft: 'rgba(214, 154, 106, 0.15)',
  ctaBg: '#7A4C2A',
  ctaText: '#FBF2E8',
  ribbon: '#8E5730',
  ribbonDeep: '#683D20',
  pageEdge: 'rgba(228, 211, 195, 0.18)',
  pageEdgeBg: '#1B120D',
  spineCrease: 'rgba(8, 4, 2, 0.72)',
  spineShadowInner: 'rgba(8, 4, 2, 0.4)',
  paperGrainOpacity: 0.02,
});
