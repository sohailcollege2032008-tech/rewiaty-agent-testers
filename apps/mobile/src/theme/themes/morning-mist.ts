import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «ضباب الصباح»: a cool, slightly blue morning paper for daylight reading. */
export const morningMistTheme = buildAppTheme({
  id: 'morning-mist',
  labelAr: 'ضباب الصباح',
  category: 'light',
  isDark: false,
  tokens: THEMES['morning-mist'],
  deskBg: '#E3E9EE',
  boardRim: '#CBD5DD',
  surface: '#E9EEF2',
  surfaceElevated: '#F8FAFC',
  hudBg: 'rgba(239, 242, 245, 0.95)',
  sheetBg: 'rgba(242, 245, 248, 1)',
  border: '#D5DDE4',
  accentSoft: 'rgba(61, 110, 140, 0.12)',
  ctaBg: '#356079',
  ctaText: '#F7FBFE',
  ribbon: '#3D6E8C',
  ribbonDeep: '#2C5168',
  pageEdge: 'rgba(96, 118, 136, 0.22)',
  pageEdgeBg: '#ECF1F5',
  spineCrease: 'rgba(40, 54, 66, 0.2)',
  spineShadowInner: 'rgba(40, 54, 66, 0.09)',
  paperGrainOpacity: 0.018,
});
