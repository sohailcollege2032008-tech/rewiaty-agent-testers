/**
 * Core BookModel types shared between the parser, reader engine, and app shell.
 */

export type BookMeta = {
  title: string;
  author?: string;
  lang: 'ar' | 'en' | string;
  dir: 'rtl' | 'ltr';
  coverColor?: string;
};

export type BlockKind = 'p' | 'h2' | 'break' | 'quote' | 'image';

export type Block = {
  id: string; // e.g. ch01_p0007
  kind: BlockKind;
  html: string; // inline sanitized
  noIndent?: boolean;
};

export type Chapter = {
  id: string; // e.g. ch01
  title: string;
  blocks: Block[];
  wordCount: number;
  hash: string;
  /**
   * Deterministic hash of the chapter's raw source slice (plus its title and the parse
   * options that change the result), computable BEFORE blocks are parsed. Two chapters with
   * the same `rawHash` parse to the same blocks, so delta re-parse can reuse one verbatim.
   */
  rawHash?: string;
};

export type Book = {
  id: string;
  meta: BookMeta;
  chapters: Chapter[];
  footnotes: Record<string, Block[]>;
  wordCount: number;
};

export type Anchor = {
  blockId: string;
  charOffset: number;
};
