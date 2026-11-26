import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «ورق المريمية»: a soft herbal green paper, calm without going cold. */
export const sagePaperTheme = buildAppTheme({
  id: 'sage-paper',
  labelAr: 'ورق المريمية',
  category: 'light',
  isDark: false,
  tokens: THEMES['sage-paper'],
  deskBg: '#E2E9D9',
  boardRim: '#CBD6C0',
  surface: '#E9EFE1',
  surfaceElevated: '#F7FAF2',
  hudBg: 'rgba(237, 241, 230, 0.95)',
  sheetBg: 'rgba(240, 245, 234, 1)',
  border: '#D6DFCA',
  accentSoft: 'rgba(79, 107, 69, 0.12)',
  ctaBg: '#436039',
  ctaText: '#FBFFF7',
  ribbon: '#4F6B45',
  ribbonDeep: '#3A4F33',
  pageEdge: 'rgba(96, 112, 88, 0.24)',
  pageEdgeBg: '#EBF0E4',
  spineCrease: 'rgba(40, 54, 34, 0.22)',
  spineShadowInner: 'rgba(40, 54, 34, 0.1)',
  paperGrainOpacity: 0.028,
});
