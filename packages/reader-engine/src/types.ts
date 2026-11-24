import type { Anchor, Book } from '@rewiaty/book-format';

export type ThemeId = 'warm-paper' | 'sepia' | 'charcoal' | 'oled';

export type TextAlignMode = 'start' | 'justify';

export type IndentMode = 'classic' | 'block';

export type TapZone = 'prev' | 'next' | 'center';

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
  muted: string;
  quoteBg: string;
  quoteBorder: string;
  accent: string;
  popoverBg: string;
  popoverBorder: string;
};

export const THEMES: Record<ThemeId, ThemeTokens> = {
  'warm-paper': {
    bg: '#FAF8F5',
    text: '#24211D',
    muted: '#6E675F',
    quoteBg: 'rgba(36, 33, 29, 0.04)',
    quoteBorder: 'rgba(130, 100, 68, 0.45)',
    accent: '#8B5A2B',
    popoverBg: '#FFFDF9',
    popoverBorder: '#E5DDD0',
  },
  sepia: {
    bg: '#F4ECD8',
    text: '#3E3024',
    muted: '#735F4B',
    quoteBg: 'rgba(62, 48, 36, 0.05)',
    quoteBorder: 'rgba(122, 86, 48, 0.45)',
    accent: '#7A4E22',
    popoverBg: '#FAF3E3',
    popoverBorder: '#DECFAF',
  },
  charcoal: {
    bg: '#18181B',
    text: '#D4D4D8',
    muted: '#9CA3AF',
    quoteBg: 'rgba(255, 255, 255, 0.04)',
    quoteBorder: 'rgba(161, 161, 170, 0.4)',
    accent: '#D4A373',
    popoverBg: '#27272A',
    popoverBorder: '#3F3F46',
  },
  oled: {
    bg: '#000000',
    text: '#A1A1AA',
    muted: '#71717A',
    quoteBg: 'rgba(255, 255, 255, 0.05)',
    quoteBorder: 'rgba(161, 161, 170, 0.35)',
    accent: '#C49A6C',
    popoverBg: '#121214',
    popoverBorder: '#27272A',
  },
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: 'Amiri',
  fontSize: 20,
  lineHeight: 1.95,
  wordSpacing: 0,
  paragraphSpacing: 8,
  textAlign: 'justify',
  indentMode: 'classic',
  marginHorizontal: 24,
  marginVertical: 24,
  fontWeight: 400,
  theme: 'warm-paper',
  disableAnimation: false,
  maxReadingWidth: 68,
  dirOverride: 'auto',
  spread: 'auto',
};

export type RNToWebMessage =
  | {
      type: 'load';
      book: Book;
      anchor?: Anchor;
      settings?: Partial<ReaderSettings>;
      fontBaseUrl?: string;
    }
  | {
      type: 'settings';
      partial: Partial<ReaderSettings>;
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
    };

export type TocEntry = {
  id: string;
  title: string;
  wordCount: number;
  pageCount: number;
  startPage: number;
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
      type: 'error';
      message: string;
    };
