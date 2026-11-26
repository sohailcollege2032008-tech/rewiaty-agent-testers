import type { Anchor, Book } from '@rewiaty/book-format';

export type ThemeId = 'warraq' | 'sepia' | 'burnt-paper' | 'oled-crimson';

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
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: 'Noto Naskh Arabic',
  fontSize: 20,
  lineHeight: 1.95,
  wordSpacing: 0,
  paragraphSpacing: 8,
  textAlign: 'justify',
  indentMode: 'classic',
  marginHorizontal: 24,
  marginVertical: 24,
  fontWeight: 400,
  theme: 'warraq',
  disableAnimation: false,
  maxReadingWidth: 68,
  dirOverride: 'auto',
  spread: 'auto',
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
