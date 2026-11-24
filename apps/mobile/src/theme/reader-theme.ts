import { THEMES, type ThemeId, type ThemeTokens } from '../../../../packages/reader-engine/src/types';

export type AppThemeTokens = ThemeTokens & {
  id: ThemeId;
  labelAr: string;
  isDark: boolean;
  hudBg: string;
  sheetBg: string;
  border: string;
  chipBg: string;
  chipActiveBg: string;
  chipBorder: string;
  scrubberTrack: string;
  danger: string;
  onAccent: string;
};

export type ThemeOption = {
  id: ThemeId;
  labelAr: string;
  bg: string;
  text: string;
  accent: string;
};

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: 'warm-paper',
    labelAr: 'ورق دافئ',
    bg: THEMES['warm-paper'].bg,
    text: THEMES['warm-paper'].text,
    accent: THEMES['warm-paper'].accent,
  },
  {
    id: 'sepia',
    labelAr: 'سيبيا',
    bg: THEMES.sepia.bg,
    text: THEMES.sepia.text,
    accent: THEMES.sepia.accent,
  },
  {
    id: 'charcoal',
    labelAr: 'فحمي',
    bg: THEMES.charcoal.bg,
    text: THEMES.charcoal.text,
    accent: THEMES.charcoal.accent,
  },
  {
    id: 'oled',
    labelAr: 'ليلي OLED',
    bg: THEMES.oled.bg,
    text: THEMES.oled.text,
    accent: THEMES.oled.accent,
  },
];

const APP_THEMES: Record<ThemeId, AppThemeTokens> = {
  'warm-paper': {
    ...THEMES['warm-paper'],
    id: 'warm-paper',
    labelAr: 'ورق دافئ',
    isDark: false,
    hudBg: 'rgba(250, 248, 245, 0.96)',
    sheetBg: 'rgba(250, 248, 245, 0.92)',
    border: '#E5DDD0',
    chipBg: 'rgba(36, 33, 29, 0.05)',
    chipActiveBg: 'rgba(139, 90, 43, 0.14)',
    chipBorder: '#DED4C4',
    scrubberTrack: '#E5DDD0',
    danger: '#991B1B',
    onAccent: '#FFFDF9',
  },
  sepia: {
    ...THEMES.sepia,
    id: 'sepia',
    labelAr: 'سيبيا',
    isDark: false,
    hudBg: 'rgba(244, 236, 216, 0.96)',
    sheetBg: 'rgba(244, 236, 216, 0.92)',
    border: '#DECFAF',
    chipBg: 'rgba(62, 48, 36, 0.06)',
    chipActiveBg: 'rgba(122, 78, 34, 0.16)',
    chipBorder: '#D5C39F',
    scrubberTrack: '#DECFAF',
    danger: '#991B1B',
    onAccent: '#FAF3E3',
  },
  charcoal: {
    ...THEMES.charcoal,
    id: 'charcoal',
    labelAr: 'فحمي',
    isDark: true,
    hudBg: 'rgba(24, 24, 27, 0.96)',
    sheetBg: 'rgba(24, 24, 27, 0.92)',
    border: '#3F3F46',
    chipBg: 'rgba(255, 255, 255, 0.06)',
    chipActiveBg: 'rgba(212, 163, 115, 0.18)',
    chipBorder: '#3F3F46',
    scrubberTrack: '#3F3F46',
    danger: '#FCA5A5',
    onAccent: '#18181B',
  },
  oled: {
    ...THEMES.oled,
    id: 'oled',
    labelAr: 'ليلي OLED',
    isDark: true,
    hudBg: 'rgba(0, 0, 0, 0.96)',
    sheetBg: 'rgba(10, 10, 12, 0.92)',
    border: '#27272A',
    chipBg: 'rgba(255, 255, 255, 0.07)',
    chipActiveBg: 'rgba(196, 154, 108, 0.2)',
    chipBorder: '#27272A',
    scrubberTrack: '#27272A',
    danger: '#FCA5A5',
    onAccent: '#000000',
  },
};

export function getAppThemeTokens(themeId?: ThemeId | null): AppThemeTokens {
  if (themeId && themeId in APP_THEMES) {
    return APP_THEMES[themeId];
  }
  return APP_THEMES['warm-paper'];
}
