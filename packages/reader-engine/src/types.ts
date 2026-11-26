import type { Anchor, Book } from '@rewiaty/book-format';
import type { TashkeelMode } from './tashkeel.js';

export type { TashkeelMode };

/**
 * F31 — «موسوعة الثيمات». The four core themes stay the quick-select row; the nine encyclopedia
 * themes live behind the encyclopedia sheet. Every id here must have a `THEMES` entry so the
 * engine can render it without a fallback.
 */
export type ThemeId =
  | 'warraq'
  | 'sepia'
  | 'burnt-paper'
  | 'oled-crimson'
  | 'night-ink'
  | 'parchment'
  | 'sage-paper'
  | 'desert-sand'
  | 'morning-mist'
  | 'forest-night'
  | 'espresso'
  | 'twilight-plum'
  | 'oled-amber';

export type TextAlignMode = 'start' | 'justify';

export type IndentMode = 'classic' | 'block';

export type TapZone = 'prev' | 'next' | 'center';

export type HighlightColor = 'gold' | 'sage' | 'sky' | 'rose';

export type HighlightColorMeta = {
  id: HighlightColor;
  labelAr: string;
  swatchLight: string;
  swatchDark: string;
  fillLight: string;
  fillDark: string;
};

export const HIGHLIGHT_COLORS: readonly HighlightColorMeta[] = [
  {
    id: 'gold',
    labelAr: 'تظليل ذهبي',
    swatchLight: '#E5B842',
    swatchDark: '#D6A93B',
    fillLight: 'rgba(229, 184, 66, 0.36)',
    fillDark: 'rgba(214, 169, 59, 0.30)',
  },
  {
    id: 'sage',
    labelAr: 'تظليل أخضر',
    swatchLight: '#7BA87C',
    swatchDark: '#6E9C70',
    fillLight: 'rgba(123, 168, 124, 0.34)',
    fillDark: 'rgba(110, 156, 112, 0.30)',
  },
  {
    id: 'sky',
    labelAr: 'تظليل سماوي',
    swatchLight: '#6BA3C4',
    swatchDark: '#5E94B5',
    fillLight: 'rgba(107, 163, 196, 0.34)',
    fillDark: 'rgba(94, 148, 181, 0.30)',
  },
  {
    id: 'rose',
    labelAr: 'تظليل وردي',
    swatchLight: '#C97A7E',
    swatchDark: '#BE6E73',
    fillLight: 'rgba(201, 122, 126, 0.34)',
    fillDark: 'rgba(190, 110, 115, 0.30)',
  },
] as const;

export type EngineHighlight = {
  id: string;
  blockId: string;
  charOffset: number;
  length: number;
  color: HighlightColor;
  hasNote?: boolean;
};

export type SelectionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type SelectionInfo = {
  anchor: Anchor;
  length: number;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  chapterId: string;
  rect: SelectionRect;
};

export type ReaderSettings = {
  fontFamily: string;
  fontSize: number; // 14..36 px
  lineHeight: number; // 1.5..2.6
  wordSpacing: number; // px
  paragraphSpacing: number; // px
  textAlign: TextAlignMode;
  indentMode: IndentMode;
  /**
   * F18 — أوضاع التشكيل at render time.
   * - `full` (default): the text exactly as the book file has it.
   * - `none`: every haraka dropped (fatha, damma, kasra, sukun, shadda, tanween).
   * - `shadda-tanween`: only shadda (U+0651) and tanween (U+064B..U+064D) kept.
   * Applied to text nodes only; the file and the parsed HTML are never touched, and the
   * anchor stays in original-text coordinates (see `tashkeel.ts`).
   */
  tashkeel: TashkeelMode;
  marginHorizontal: number; // px
  marginVertical: number; // px (>= 16 to protect Tashkeel)
  fontWeight: number; // 300..600
  theme: ThemeId;
  disableAnimation: boolean;
  maxReadingWidth: number; // ch (45..85)
  dirOverride?: 'auto' | 'rtl' | 'ltr';
  /**
   * Two-page (open book) spread on wide landscape viewports.
   * - 'auto' (default): spread whenever the viewport is >= 900px wide and wider than tall.
   * - 'single': never spread, even on a tablet in landscape.
   */
  spread?: 'auto' | 'single';
  /**
   * F31 — الإضاءة. `dimmer` is a plain black veil over the page (0..0.7) and `warmth` an amber
   * blue-light filter (0..0.6). Both are native overlay layers, never a live CSS/SVG filter.
   */
  dimmer?: number;
  warmth?: number;
  /** F31 — real screen brightness. `system` leaves the device alone, `custom` applies `brightness`. */
  brightnessMode?: 'system' | 'custom';
  brightness?: number; // 0.05..1
  edgeBrightnessSwipe?: boolean;
  /** F31 — theme follows the clock / the system scheme / the reader's hand. */
  autoThemeMode?: 'system' | 'schedule' | 'manual';
  dayTheme?: ThemeId;
  nightTheme?: ThemeId;
  nightStartHour?: number; // 0..23
  nightEndHour?: number; // 0..23
  /** F31 — the gentle 45-minute eye-rest reminder. */
  eyeRestReminder?: boolean;
  eyeRestIntervalMinutes?: number; // 15..120
};

export type ThemeTokens = {
  bg: string;
  text: string;
  heading?: string;
  muted: string;
  quoteBg: string;
  quoteBorder: string;
  accent: string;
  popoverBg: string;
  popoverBorder: string;
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  warraq: {
    bg: '#FAF7F0',
    text: '#231F1A',
    muted: '#6E655A',
    quoteBg: 'rgba(35, 31, 26, 0.035)',
    quoteBorder: '#9E3E2F',
    accent: '#9E3E2F',
    popoverBg: '#FFFDF8',
    popoverBorder: '#E3DACB',
  },
  sepia: {
    bg: '#F3EBD6',
    text: '#382B1E',
    muted: '#725E49',
    quoteBg: 'rgba(56, 43, 30, 0.045)',
    quoteBorder: '#8C3A2B',
    accent: '#8C3A2B',
    popoverBg: '#F8F2E2',
    popoverBorder: '#D8C9AA',
  },
  'burnt-paper': {
    bg: '#181310',
    text: '#DECFC0',
    muted: '#A69686',
    quoteBg: 'rgba(222, 207, 192, 0.045)',
    quoteBorder: '#C95E4B',
    accent: '#DF7863',
    popoverBg: '#2B231D',
    popoverBorder: '#372C25',
  },
  'oled-crimson': {
    bg: '#000000',
    text: '#E6DED3',
    heading: '#FAF5EE',
    muted: '#A39B90',
    quoteBg: 'rgba(230, 222, 211, 0.055)',
    quoteBorder: '#B84D3D',
    accent: '#D46A5A',
    popoverBg: '#171414',
    popoverBorder: '#262120',
  },
  // F31 — «حِبْر اللَّيْل»: palette copied 1:1 from
  // `.factory/design/warraq/dark-2-night-ink/tokens.json` (bg/text/accent/ctaBg are the contract).
  'night-ink': {
    bg: '#10151E',
    text: '#D4D8DF',
    muted: '#939EAE',
    quoteBg: 'rgba(212, 216, 223, 0.04)',
    quoteBorder: '#C26269',
    accent: '#DB7B7C',
    popoverBg: '#1F2838',
    popoverBorder: '#283347',
  },
  parchment: {
    bg: '#F6F0E2',
    text: '#2A2418',
    muted: '#6F6552',
    quoteBg: 'rgba(42, 36, 24, 0.04)',
    quoteBorder: '#8A6A3C',
    accent: '#8A6A3C',
    popoverBg: '#FFFCF3',
    popoverBorder: '#E3D9C4',
  },
  'sage-paper': {
    bg: '#EDF1E6',
    text: '#25301F',
    muted: '#5F6E55',
    quoteBg: 'rgba(37, 48, 31, 0.04)',
    quoteBorder: '#4F6B45',
    accent: '#4F6B45',
    popoverBg: '#F7FAF2',
    popoverBorder: '#D6DFCA',
  },
  'desert-sand': {
    bg: '#F0E3CD',
    text: '#3A2D1C',
    muted: '#7A6749',
    quoteBg: 'rgba(58, 45, 28, 0.045)',
    quoteBorder: '#96602A',
    accent: '#96602A',
    popoverBg: '#F8EEDB',
    popoverBorder: '#DDCBAE',
  },
  'morning-mist': {
    bg: '#EFF2F5',
    text: '#23303A',
    muted: '#5D6E7A',
    quoteBg: 'rgba(35, 48, 58, 0.04)',
    quoteBorder: '#3D6E8C',
    accent: '#3D6E8C',
    popoverBg: '#F8FAFC',
    popoverBorder: '#D5DDE4',
  },
  'forest-night': {
    bg: '#101A15',
    text: '#D6E4DA',
    muted: '#91A697',
    quoteBg: 'rgba(214, 228, 218, 0.045)',
    quoteBorder: '#6E9C7D',
    accent: '#82B392',
    popoverBg: '#1B2922',
    popoverBorder: '#26382E',
  },
  espresso: {
    bg: '#221812',
    text: '#E4D3C3',
    muted: '#AC9784',
    quoteBg: 'rgba(228, 211, 195, 0.045)',
    quoteBorder: '#C08A5E',
    accent: '#D69A6A',
    popoverBg: '#2E211A',
    popoverBorder: '#3B2C22',
  },
  'twilight-plum': {
    bg: '#17111F',
    text: '#DDD2E6',
    muted: '#A296AF',
    quoteBg: 'rgba(221, 210, 230, 0.045)',
    quoteBorder: '#9A7FBF',
    accent: '#B79BD8',
    popoverBg: '#241A2F',
    popoverBorder: '#32243F',
  },
  'oled-amber': {
    bg: '#000000',
    text: '#D8CDBB',
    muted: '#9C927F',
    quoteBg: 'rgba(216, 205, 187, 0.05)',
    quoteBorder: '#B98A33',
    accent: '#E0A640',
    popoverBg: '#141110',
    popoverBorder: '#241F1B',
  },
};

/** Relative luminance (WCAG 2.1) of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const channel = (offset: number) => parseInt(clean.slice(offset, offset + 2), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(channel(0)) + 0.7152 * toLinear(channel(2)) + 0.0722 * toLinear(channel(4));
}

/** WCAG contrast ratio between two `#rrggbb` colours (1..21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Why (tech): the paginator used to hard-code `burnt-paper | oled-crimson` for dark-mode highlight
 * fills. With 13 themes that list rots on the next theme added, so darkness is derived from the
 * background's luminance instead: a paper with a luminance under 0.2 is a night paper.
 */
export const DARK_LUMINANCE_THRESHOLD = 0.2;

export function isDarkThemeId(themeId: ThemeId | string | null | undefined): boolean {
  if (typeof themeId !== 'string' || !Object.hasOwn(THEMES, themeId)) return false;
  return relativeLuminance(THEMES[themeId as ThemeId].bg) < DARK_LUMINANCE_THRESHOLD;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: 'Noto Naskh Arabic',
  fontSize: 20,
  lineHeight: 1.95,
  wordSpacing: 0,
  paragraphSpacing: 8,
  textAlign: 'justify',
  indentMode: 'classic',
  tashkeel: 'full',
  marginHorizontal: 24,
  marginVertical: 24,
  fontWeight: 400,
  theme: 'warraq',
  disableAnimation: false,
  maxReadingWidth: 68,
  dirOverride: 'auto',
  spread: 'auto',
  // F31 — lighting, auto theme and eye-rest defaults.
  dimmer: 0,
  warmth: 0,
  brightnessMode: 'system',
  brightness: 0.8,
  edgeBrightnessSwipe: true,
  autoThemeMode: 'system',
  dayTheme: 'warraq',
  nightTheme: 'burnt-paper',
  nightStartHour: 19,
  nightEndHour: 6,
  eyeRestReminder: true,
  eyeRestIntervalMinutes: 45,
};

export type ReaderInsets = {
  top: number;
  bottom: number;
};

export type RNToWebMessage =
  | {
      type: 'load';
      book: Book;
      anchor?: Anchor;
      settings?: Partial<ReaderSettings>;
      insets?: ReaderInsets;
      fontBaseUrl?: string;
      highlights?: EngineHighlight[];
    }
  | {
      type: 'settings';
      partial: Partial<ReaderSettings>;
      insets?: ReaderInsets;
    }
  | {
      type: 'fonts';
      fontBaseUrl: string;
    }
  | {
      type: 'goto';
      anchor?: Anchor;
      chapterId?: string;
      page?: number;
    }
  | {
      type: 'next';
    }
  | {
      type: 'prev';
    }
  | {
      type: 'suppress-taps';
      durationMs: number;
    }
  | {
      type: 'highlights';
      highlights: EngineHighlight[];
    }
  | {
      type: 'clear-selection';
    };

export type TocEntry = {
  id: string;
  title: string;
  wordCount: number;
  pageCount: number;
  startPage: number;
  /** true while `pageCount` is an estimate (that chapter has not been measured yet). */
  estimated?: boolean;
};

export type WebToRNMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'position';
      anchor: Anchor;
      chapterId: string;
      page: number;
      pageCount: number;
      chapterPage: number;
      chapterPageCount: number;
      bookProgress: number;
      /** true when the reader is showing a two-page open-book spread. */
      spread: boolean;
      /**
       * true while `pageCount` is an estimate for the current layout. The sheet
       * counter should read "~N" (or drop the total) instead of presenting it as final.
       */
      estimated?: boolean;
    }
  | {
      type: 'tap';
      zone: TapZone;
    }
  | {
      type: 'toc';
      chapters: TocEntry[];
    }
  | {
      type: 'layout-complete';
      chapterId: string;
    }
  | {
      /** Proof that at least one figure from the book actually painted. */
      type: 'image-rendered';
      count: number;
      width: number;
      height: number;
    }
  | {
      type: 'selection';
      selection: SelectionInfo | null;
    }
  | {
      type: 'highlight-tap';
      highlightId: string;
      rect: SelectionRect;
    }
  | {
      type: 'error';
      message: string;
    };
