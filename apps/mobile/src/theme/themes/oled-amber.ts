import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/** F31 — «عتمة كهرمانية»: true-black OLED with a warm amber thread (no blue at all). */
export const oledAmberTheme = buildAppTheme({
  id: 'oled-amber',
  labelAr: 'عتمة كهرمانية',
  category: 'oled',
  isDark: true,
  tokens: THEMES['oled-amber'],
  deskBg: '#000000',
  boardRim: '#241F1B',
  surface: '#0E0C0B',
  surfaceElevated: '#141110',
  hudBg: 'rgba(0, 0, 0, 0.96)',
  sheetBg: 'rgba(12, 11, 10, 1)',
  border: '#241F1B',
  accentSoft: 'rgba(224, 166, 64, 0.14)',
  ctaBg: '#8A641F',
  ctaText: '#FFF6E4',
  ribbon: '#A67A2A',
  ribbonDeep: '#7C5A1D',
  pageEdge: 'rgba(216, 205, 187, 0.14)',
  pageEdgeBg: '#080706',
  spineCrease: 'rgba(216, 205, 187, 0.14)',
  spineShadowInner: 'rgba(216, 205, 187, 0.03)',
  paperGrainOpacity: 0,
});
