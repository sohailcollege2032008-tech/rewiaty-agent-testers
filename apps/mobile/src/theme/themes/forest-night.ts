import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «ليل الغابة»: deep pine-green night with a moss accent. */
export const forestNightTheme = buildAppTheme({
  id: 'forest-night',
  labelAr: 'ليل الغابة',
  category: 'dark',
  isDark: true,
  tokens: THEMES['forest-night'],
  deskBg: '#080F0B',
  boardRim: '#22322A',
  surface: '#16231C',
  surfaceElevated: '#1B2922',
  hudBg: 'rgba(16, 26, 21, 0.95)',
  sheetBg: 'rgba(20, 31, 25, 1)',
  border: '#26382E',
  accentSoft: 'rgba(130, 179, 146, 0.14)',
  ctaBg: '#3F6B4F',
  ctaText: '#F1F8F3',
  ribbon: '#4E7D5F',
  ribbonDeep: '#375A45',
  pageEdge: 'rgba(214, 228, 218, 0.16)',
  pageEdgeBg: '#0C1511',
  spineCrease: 'rgba(2, 8, 5, 0.7)',
  spineShadowInner: 'rgba(2, 8, 5, 0.38)',
  paperGrainOpacity: 0.015,
});
