import type { Anchor } from '@rewiaty/book-format';

export { HIGHLIGHT_COLORS } from '../../../../packages/reader-engine/src/types';
export type {
  EngineHighlight,
  HighlightColor,
  HighlightColorMeta,
  IndentMode,
  RNToWebMessage,
  ReaderInsets,
  ReaderSettings,
  SceneDisplayMode,
  ScenePlaceholder,
  ScenePlaceholderStatus,
  ScenePromptParts,
  SelectionInfo,
  SelectionRect,
  TashkeelMode,
  TapZone,
  TextAlignMode,
  ThemeId,
  ThemeTokens,
  TocEntry,
  WebToRNMessage,
} from '../../../../packages/reader-engine/src/types';

/**
 * A bookmark stores its place as a text anchor (block + character offset) plus a quote and the
 * surrounding text, so it can be restored even after the book is reflowed or re-parsed.
 */
export type BookmarkItem = {
  id: string;
  anchor: Anchor;
  chapterId: string;
  chapterTitle: string;
  /** Up to ~80 characters starting at the anchor. */
  quote: string;
  /** Up to ~25 characters immediately before the quote. */
  contextBefore: string;
  /** Up to ~25 characters immediately after the quote. */
  contextAfter: string;
  page?: number;
  createdAt: number;
};

/**
 * A text highlight with an optional note, stored with a fuzzy anchor (blockId + charOffset +
 * length + exact quote + 20 chars before/after) so it survives file edits and layout changes.
 */
export type HighlightItem = {
  id: string;
  anchor: Anchor;
  length: number;
  color: import('../../../../packages/reader-engine/src/types').HighlightColor;
  quote: string;
  /** Up to 20 characters immediately before the quote. */
  contextBefore: string;
  /** Up to 20 characters immediately after the quote. */
  contextAfter: string;
  chapterId: string;
  chapterTitle: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export type BookLibraryRecord = {
  id: string;
  title: string;
  author: string | null;
  dir: 'rtl' | 'ltr';
  coverSeed: string;
  coverColor: string | null;
  progress: number; // 0..1
  lastOpenedAt: number;
  addedAt: number;
  /**
   * True for the novel that ships inside the app (`ensureSampleBookSeeded`). Bundled books are
   * the app's own demo content, not user data: they never wear «جديدة» and cannot be deleted.
   */
  isBundled?: boolean;
};

export type BookManifest = {
  id: string;
  meta: import('@rewiaty/book-format').BookMeta;
  chapters: Array<{
    id: string;
    title: string;
    wordCount: number;
    hash: string;
  }>;
  wordCount: number;
  parserVersion: number;
};

export type BookReaderState = {
  anchor: import('@rewiaty/book-format').Anchor | null;
  progress: number;
  chapterId?: string;
  page?: number;
  pageCount?: number;
  bookmarks?: number[];
  /** Text-anchored bookmarks (F16). `bookmarks` stays for older saved states. */
  bookmarkItems?: BookmarkItem[];
  /** Text-anchored highlights and notes (F17). */
  highlights?: HighlightItem[];
  /** F46 scene placeholders. Optional: every state saved before F46 stays readable. */
  scenes?: import('../../../../packages/reader-engine/src/types').ScenePlaceholder[];
  settings?: Partial<import('../../../../packages/reader-engine/src/types').ReaderSettings>;
  updatedAt: number;
};
