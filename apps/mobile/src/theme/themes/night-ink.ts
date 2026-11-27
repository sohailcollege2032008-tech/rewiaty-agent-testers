import { THEMES } from '../../../../../packages/reader-engine/src/types';
import { buildAppTheme } from './build-theme';

/**
 * F31 — «حِبْر اللَّيْل» (Night Ink), the first theme of «موسوعة الثيمات».
 *
 * Palette copied 1:1 from `.factory/design/warraq/dark-2-night-ink/tokens.json`:
 * bg `#10151E`, text `#D4D8DF` (12.79:1), accent `#DB7B7C`, ctaBg `#993D45`, ctaText `#FAF3F4`.
 * Do not "improve" these numbers without updating the design tokens file too.
 */
export const nightInkTheme = buildAppTheme({
  id: 'night-ink',
  labelAr: 'حِبْر اللَّيْل',
  category: 'dark',
  isDark: true,
  tokens: THEMES['night-ink'],
  deskBg: '#0A0E15',
  boardRim: '#1F2838',
  surface: '#171E2B',
  surfaceElevated: '#1F2838',
  hudBg: 'rgba(16, 21, 30, 0.95)',
  sheetBg: 'rgba(21, 28, 40, 1)',
  border: '#283347',
  accentSoft: 'rgba(219, 123, 124, 0.14)',
  ctaBg: '#993D45',
  ctaText: '#FAF3F4',
  ribbon: '#A8454E',
  ribbonDeep: '#7F2F37',
  pageEdge: 'rgba(212, 216, 223, 0.16)',
  pageEdgeBg: '#0C1119',
  spineCrease: 'rgba(4, 7, 13, 0.62)',
  spineShadowInner: 'rgba(4, 7, 13, 0.35)',
  paperGrainOpacity: 0.01,
  coverPalettes: [
    { bg: '#25464D', ink: '#EDF0F2', line: '#C2D2D4', spine: '#172E33' },
    { bg: '#632D35', ink: '#F6ECEE', line: '#DFB8BE', spine: '#441C22' },
    { bg: '#2D4039', ink: '#ECF1EE', line: '#BACCC2', spine: '#1C2A25' },
    { bg: '#48392D', ink: '#F2ECE5', line: '#D3C0AE', spine: '#2F241C' },
    { bg: '#24354F', ink: '#EDF0F5', line: '#B5C5DF', spine: '#162134' },
    { bg: '#493148', ink: '#F3EDF3', line: '#D5B9D4', spine: '#2E1E2D' },
  ],
});
