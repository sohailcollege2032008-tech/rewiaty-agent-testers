import { Platform, useWindowDimensions } from 'react-native';

export const TABLET_SHORTEST_SIDE_DP = 600;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pageMarginH: 26,
  pageMarginV: 26,
} as const;

export const RADIUS = {
  cover: 4,
  button: 6,
  card: 8,
  sheet: 14,
  pill: 999,
} as const;

export const TYPOGRAPHY = {
  displayFont: Platform.select({
    web: "'Amiri', Georgia, serif",
    ios: 'Georgia',
    android: 'serif',
    default: 'serif',
  }),
  uiFont: Platform.select({
    web: "'IBM Plex Sans Arabic', system-ui, -apple-system, sans-serif",
    default: undefined,
  }),
  scale: {
    libraryBrand: { fontSize: 26, lineHeight: 35, fontWeight: '700' as const },
    libraryBrandTablet: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const },
    heroTitle: { fontSize: 23, lineHeight: 34, fontWeight: '700' as const },
    heroTitleTablet: { fontSize: 34, lineHeight: 46, fontWeight: '700' as const },
    tileTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' as const },
    tileTitleTablet: { fontSize: 19, lineHeight: 26, fontWeight: '700' as const },
    shelfTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
    shelfTitleTablet: { fontSize: 25, lineHeight: 34, fontWeight: '700' as const },
    uiLabel: { fontSize: 13, lineHeight: 19, fontWeight: '600' as const },
    meta: { fontSize: 11.5, lineHeight: 17, fontWeight: '500' as const },
  },
} as const;

export const TABLET_TOKENS = {
  portraitColumns: 3,
  landscapeColumns: 4,
  heroCoverPortrait: { width: 152, height: 220 },
  heroCoverLandscape: { width: 162, height: 236 },
  portraitMaxLineWidthCh: 62,
  landscapeMaxLineWidthCh: 54,
  portraitReadingSize: 22,
  landscapeReadingSize: 20.5,
  lineHeightDefault: 1.98,
  settingsPanelWidth: 348,
  tocDrawerWidth: 360,
} as const;

export const PHONE_TOKENS = {
  portraitColumns: 2,
  landscapeColumns: 3,
  heroCover: { width: 108, height: 158 },
} as const;

export const FONT_LABELS_AR: Record<string, string> = {
  Amiri: 'أميري',
  'Noto Naskh Arabic': 'نوتو نسخ',
  'Scheherazade New': 'شهرزاد',
  'IBM Plex Sans Arabic': 'بلكس عربي',
  'Readex Pro': 'ريدكس برو',
  Literata: 'Literata',
  Merriweather: 'Merriweather',
  Inter: 'Inter',
};

export type ResponsiveLayout = {
  width: number;
  height: number;
  shortestSide: number;
  isTablet: boolean;
  isLandscape: boolean;
  isTabletLandscape: boolean;
  isTabletPortrait: boolean;
  libraryColumns: number;
  heroCoverSize: { width: number; height: number };
  readerMaxReadingWidthCh: number | null;
  settingsMode: 'side-panel' | 'bottom-sheet';
  settingsPanelWidth: number;
  tocDrawerWidth: number | `${number}%`;
};

export function computeResponsiveLayout(width: number, height: number): ResponsiveLayout {
  const safeW = Math.max(320, width || 390);
  const safeH = Math.max(320, height || 844);
  const shortestSide = Math.min(safeW, safeH);
  const isTablet = shortestSide >= TABLET_SHORTEST_SIDE_DP;
  const isLandscape = safeW > safeH;
  const isTabletLandscape = isTablet && isLandscape;
  const isTabletPortrait = isTablet && !isLandscape;

  const libraryColumns = isTablet
    ? isLandscape
      ? TABLET_TOKENS.landscapeColumns
      : TABLET_TOKENS.portraitColumns
    : isLandscape
      ? PHONE_TOKENS.landscapeColumns
      : PHONE_TOKENS.portraitColumns;

  const heroCoverSize = isTablet
    ? isLandscape
      ? TABLET_TOKENS.heroCoverLandscape
      : TABLET_TOKENS.heroCoverPortrait
    : PHONE_TOKENS.heroCover;

  const readerMaxReadingWidthCh = isTablet
    ? isLandscape
      ? TABLET_TOKENS.landscapeMaxLineWidthCh
      : TABLET_TOKENS.portraitMaxLineWidthCh
    : null;

  return {
    width: safeW,
    height: safeH,
    shortestSide,
    isTablet,
    isLandscape,
    isTabletLandscape,
    isTabletPortrait,
    libraryColumns,
    heroCoverSize,
    readerMaxReadingWidthCh,
    settingsMode: isTabletLandscape ? 'side-panel' : 'bottom-sheet',
    settingsPanelWidth: TABLET_TOKENS.settingsPanelWidth,
    tocDrawerWidth: isTablet ? TABLET_TOKENS.tocDrawerWidth : '82%',
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return computeResponsiveLayout(width, height);
}
