import type { Anchor, Book } from '@rewiaty/book-format';
import type {
  ReadingFocusMode,
  ReadingFocusReport,
} from './reading-focus.js';
import type { TashkeelMode } from './tashkeel.js';

export type { ReadingFocusMode, ReadingFocusReport, TashkeelMode };

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

/**
 * F32 — ألوان مخصّصة: a background/text pair the reader picked, plus whether it is in force.
 * `bg`/`text` are validated `#RRGGBB` strings; the engine still re-validates before painting, so
 * a corrupted stored value can never reach the stylesheet.
 */
export type CustomReaderColors = {
  enabled: boolean;
  bg: string;
  text: string;
};

export const DEFAULT_CUSTOM_COLORS: CustomReaderColors = {
  enabled: false,
  bg: '#FAF7F0',
  text: '#231F1A',
};

/**
 * F22 — how the book is presented.
 * - `paginated` (default): the classic one-column page that turns horizontally.
 * - `scroll`: one continuous vertical column; chapters stack, the page map still drives
 *   every number the reader sees (page, TOC, scrubber).
 */
export type ReadingMode = 'paginated' | 'scroll';

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
  /**
   * F31 — theme follows the clock / the system scheme / the reader's hand.
   *
   * `autoThemeMode` is the single source of truth for which theme is active. It replaced the
   * old `THEME_MANUAL_KV_KEY` boolean, which is now only a migration input (see settings-store).
   * `ambient` is reserved for a future light-sensor mode and currently resolves like `system`.
   */
  autoThemeMode?: 'system' | 'schedule' | 'manual' | 'ambient';
  dayTheme?: ThemeId;
  nightTheme?: ThemeId;
  nightStartHour?: number; // 0..23
  nightEndHour?: number; // 0..23
  /** F31 — the gentle 45-minute eye-rest reminder. */
  eyeRestReminder?: boolean;
  eyeRestIntervalMinutes?: number; // 15..120
  /**
   * F32 — ألوان مخصّصة. When `enabled` and both colours are valid hex, the paginator paints the
   * page from this pair (and derives every supporting token from it) instead of `THEMES[theme]`.
   * When disabled / malformed the preset theme is used untouched, so the two can never mix.
   *
   * F31 interaction: a custom pair replaces the theme's `bg`/`text` (and the tokens derived from
   * them) but never the lighting overlays — `dimmer`/`warmth` still paint on top of either one.
   */
  customColors?: CustomReaderColors;
  /** F22 — `paginated` (default) or continuous vertical `scroll`. */
  readingMode?: ReadingMode;
  /**
   * F22 — show the thin reading-progress bar at the top of the page while scrolled.
   * Default `true`; the reader can turn it off in the layout tab.
   */
  showScrollProgressBar?: boolean;
  /**
   * F33 — وضع التركيز ومسطرة التتبع.
   * - `off` (default): the page is untouched.
   * - `paragraph`: the paragraph under the reading line keeps the body ink; the rest of the page
   *   is painted with the theme's readable `muted` token.
   * - `ruler`: a thin pass-through line is drawn at the reading line, text untouched.
   * The reading line itself is the geometry documented in `reading-focus.ts`.
   */
  readingFocus?: ReadingFocusMode;
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
    quoteBorder: '#82633A',
    // Was #8A6A3C (4.39:1 on the paper). Darkened to clear the 4.5:1 text minimum.
    accent: '#82633A',
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
    // Was #7A6749 (4.29:1) — the Codex review rejected the muted/accent pair for body-size text.
    muted: '#65543A',
    quoteBg: 'rgba(58, 45, 28, 0.045)',
    quoteBorder: '#7C4D1E',
    // Was #96602A (4.14:1 on #F0E3CD). #7C4D1E reads 5.64:1 and keeps the ochre thread.
    accent: '#7C4D1E',
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
  readingMode: 'paginated',
  showScrollProgressBar: true,
  readingFocus: 'off',
};

export type ReaderInsets = {
  top: number;
  bottom: number;
};

/**
 * F46 — the structured prompt behind a scene placeholder. Every part is a short, editable
 * phrase, so the reader can nudge the picture without rewriting a paragraph.
 */
export type ScenePromptParts = {
  setting: string;
  mood: string;
  characters: string;
  style: string;
  note?: string;
};

export type ScenePlaceholderStatus = 'idle' | 'queued' | 'generating' | 'ready' | 'error';

/**
 * F46 — a sketchbook frame anchored after one block of the book.
 *
 * The frame keeps the same outer box in every status (see `styles.css`), so an image
 * arriving late can never move the text the reader is already reading.
 */
export type ScenePlaceholder = {
  id: string;
  afterBlockId: string;
  caption: string;
  prompt: ScenePromptParts;
  status: ScenePlaceholderStatus;
  aspectRatio?: number; // width / height, default 1.6 (16/10)
  imageUrl?: string; // only allow data:image/*, file://, https://, or relative safe paths; reject javascript:/data:text/html
  errorMessage?: string;
  collapsed?: boolean;
};

export type SceneDisplayMode = 'expanded' | 'collapsed' | 'hidden';

export type RNToWebMessage =
  | {
      type: 'load';
      book: Book;
      anchor?: Anchor;
      /**
       * Chapter the reader was last in, used as a fallback when `anchor` cannot be resolved
       * to a block. An empty chapter has no blocks, so its saved anchor is the chapter id
       * itself (or a block that has since been removed) — without this the reader used to
       * reopen at the start of the book and overwrite their real position with 0%.
       */
      chapterId?: string;
      settings?: Partial<ReaderSettings>;
      insets?: ReaderInsets;
      fontBaseUrl?: string;
      highlights?: EngineHighlight[];
      scenePlaceholders?: ScenePlaceholder[];
      sceneDisplayMode?: SceneDisplayMode;
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
    }
  | {
      type: 'scene-placeholders';
      placeholders: ScenePlaceholder[];
      displayMode?: SceneDisplayMode;
    }
  | {
      type: 'scene-update';
      placeholder: ScenePlaceholder;
    }
  | {
      type: 'scene-display-mode';
      mode: SceneDisplayMode;
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
      /** F22 — 0..1 position inside the current chapter while in `scroll` mode. */
      chapterProgress?: number;
      /** F22 — which presentation produced this position. */
      readingMode?: ReadingMode;
      /**
       * true while `pageCount` is an estimate for the current layout. The sheet
       * counter should read "~N" (or drop the total) instead of presenting it as final.
       */
      estimated?: boolean;
      /**
       * true when this position report was triggered by an explicit reader navigation
       * (finger swipe turn, next/prev command, or goto jump), as opposed to initial restore
       * or background reflow settling. Lets the host distinguish an intentional return to
       * page 1 from a fallback restore at 0% (Issue #44 / Codex P2).
       */
      userNavigated?: boolean;
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
      /**
       * F27 — ملمس الورق: what the page is actually painting, read from `getComputedStyle` rather
       * than from settings, so the host can prove the texture is (or is not) on screen at the
       * spec's 3%, tiled, and without a live filter.
       */
      type: 'paper-grain-status';
      theme: string;
      state: 'painted' | 'hidden' | 'invalid';
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
      type: 'scene-generate';
      sceneId: string;
      prompt: ScenePromptParts;
    }
  | {
      type: 'scene-prompt-edit';
      sceneId: string;
      prompt: ScenePromptParts;
    }
  | {
      type: 'scene-toggle-collapse';
      sceneId: string;
      collapsed: boolean;
    }
  | ({ type: 'reading-focus' } & ReadingFocusReport)
  | {
      type: 'error';
      message: string;
    };
