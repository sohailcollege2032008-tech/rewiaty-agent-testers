import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «شفق أرجواني»: a dusk-violet night paper with a lilac accent. */
export const twilightPlumTheme = buildAppTheme({
  id: 'twilight-plum',
  labelAr: 'شفق أرجواني',
  category: 'dark',
  isDark: true,
  tokens: THEMES['twilight-plum'],
  deskBg: '#0D0912',
  boardRim: '#2C2038',
  surface: '#1E1628',
  surfaceElevated: '#241A2F',
  hudBg: 'rgba(23, 17, 31, 0.95)',
  sheetBg: 'rgba(28, 20, 37, 1)',
  border: '#32243F',
  accentSoft: 'rgba(183, 155, 216, 0.15)',
  ctaBg: '#5B4278',
  ctaText: '#F7F1FB',
  ribbon: '#6C4E8C',
  ribbonDeep: '#4E3767',
  pageEdge: 'rgba(221, 210, 230, 0.16)',
  pageEdgeBg: '#120D1A',
  spineCrease: 'rgba(6, 3, 10, 0.7)',
  spineShadowInner: 'rgba(6, 3, 10, 0.4)',
  paperGrainOpacity: 0.015,
});
