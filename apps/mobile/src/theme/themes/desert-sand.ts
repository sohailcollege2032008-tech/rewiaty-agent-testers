import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «رمل الصحراء»: a sun-warmed sand page with an ochre thread. */
export const desertSandTheme = buildAppTheme({
  id: 'desert-sand',
  labelAr: 'رمل الصحراء',
  category: 'warm',
  isDark: false,
  tokens: THEMES['desert-sand'],
  deskBg: '#E6D5B8',
  boardRim: '#D2BF9C',
  surface: '#EBDCC2',
  surfaceElevated: '#F8EEDB',
  hudBg: 'rgba(240, 227, 205, 0.95)',
  sheetBg: 'rgba(243, 231, 211, 1)',
  border: '#DDCBAE',
  accentSoft: 'rgba(150, 96, 42, 0.13)',
  ctaBg: '#855425',
  ctaText: '#FFF8ED',
  ribbon: '#96602A',
  ribbonDeep: '#74481E',
  pageEdge: 'rgba(140, 108, 66, 0.26)',
  pageEdgeBg: '#EEDFC4',
  spineCrease: 'rgba(76, 54, 28, 0.24)',
  spineShadowInner: 'rgba(76, 54, 28, 0.11)',
  paperGrainOpacity: 0.034,
});
