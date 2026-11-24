export type {
  IndentMode,
  RNToWebMessage,
  ReaderSettings,
  TapZone,
  TextAlignMode,
  ThemeId,
  ThemeTokens,
  TocEntry,
  WebToRNMessage,
} from '../../../../packages/reader-engine/src/types';

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
  settings?: Partial<import('../../../../packages/reader-engine/src/types').ReaderSettings>;
  updatedAt: number;
};
