import { cleanArabicText } from './cleaner.js';
import { hashString } from './hash.js';
import {
  countWordsInHtml,
  escapeHtml,
  hasSafeRasterExtension,
  isSafeImageSrc,
  renderInlineHtml,
  stripInlineMarkdown,
} from './sanitize.js';
import { detectTxtChapterHeading } from './txt-chapters.js';
import type { Block, Book, BookMeta, Chapter } from './types.js';

const RTL_LANGS = new Set(['ar', 'fa', 'ur', 'he', 'ps', 'sd']);
const SCENE_BREAK_RE = /^(?:\*\s*\*\s*\*+|-\s*-\s*-+|_\s*_\s*_+)\s*$/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)\n]+)\)\s*$/;
const OBSIDIAN_IMAGE_LINE_RE = /^!\[\[([^[\]\n]+)\]\]$/;
const FOOTNOTE_DEF_RE = /^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/;
const H1_RE = /^#\s+(.+)$/;
const H2_RE = /^##\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const YAML_LINE_RE = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/;

/**
 * Optional parse-time transform. Both flags default to the historical behaviour so existing
 * books keep byte-identical hashes unless cleaning is explicitly requested.
 */
export type ParseOptions = {
  /** Run the non-destructive Arabic cleaner over the body before parsing. Default: false. */
  cleanArabic?: boolean;
  /** In `parseTxt`: split the file on detected chapter headings. Default: true. */
  detectChapters?: boolean;
};

function normalizeLineEndings(text: string): string {
  const noBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return noBom.replace(/\r\n?/g, '\n');
}

function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stripped = base.replace(/\.(?:md|markdown|txt)$/i, '').trim();
  return stripped || 'Untitled';
}

function detectLanguageAndDir(
  sampleText: string,
  explicitLang?: string,
  explicitDir?: string,
): { lang: string; dir: 'rtl' | 'ltr' } {
  const arabicMatches = sampleText.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g);
  const latinMatches = sampleText.match(/[A-Za-z]/g);
  const arabicCount = arabicMatches ? arabicMatches.length : 0;
  const latinCount = latinMatches ? latinMatches.length : 0;

  let lang = explicitLang?.trim() ?? '';
  if (!lang) {
    lang = arabicCount >= latinCount && arabicCount > 0 ? 'ar' : 'en';
  }

  let dir: 'rtl' | 'ltr';
  const normDir = explicitDir?.trim().toLowerCase();
  if (normDir === 'rtl' || normDir === 'ltr') {
    dir = normDir;
  } else {
    const baseLang = lang.toLowerCase().split(/[-_]/)[0] ?? '';
    if (RTL_LANGS.has(baseLang)) {
      dir = 'rtl';
    } else if (!explicitLang && arabicCount > latinCount) {
      dir = 'rtl';
    } else {
      dir = 'ltr';
    }
  }

  return { lang, dir };
}

function unquoteYamlValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

type FrontmatterResult = {
  fields: Record<string, string>;
  bodyStartLine: number;
};

/**
 * Parse YAML frontmatter only when at line 0 and delimited by `---` ... `---`
 * with valid YAML key-value lines (so body `---` scene breaks are never confused).
 */
function extractFrontmatter(lines: string[]): FrontmatterResult {
  if (lines.length < 3 || lines[0]?.trim() !== '---') {
    return { fields: {}, bodyStartLine: 0 };
  }

  let closingIndex = -1;
  const fields: Record<string, string> = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '---' || trimmed === '...') {
      closingIndex = i;
      break;
    }
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const kv = YAML_LINE_RE.exec(line);
    if (!kv) {
      // Not valid YAML frontmatter; treat opening `---` as normal body content.
      return { fields: {}, bodyStartLine: 0 };
    }
    const key = kv[1]?.trim() ?? '';
    const val = unquoteYamlValue(kv[2] ?? '');
    if (key) {
      fields[key] = val;
    }
  }

  if (closingIndex === -1) {
    return { fields: {}, bodyStartLine: 0 };
  }

  return { fields, bodyStartLine: closingIndex + 1 };
}

type FootnoteExtraction = {
  bodyLines: string[];
  rawFootnotes: Map<string, string[]>;
};

/**
 * Extract footnote definitions (`[^n]: ...` with optional indented continuations)
 * from the document body before parsing chapters.
 */
function extractFootnotes(lines: string[]): FootnoteExtraction {
  const bodyLines: string[] = [];
  const rawFootnotes = new Map<string, string[]>();

  let activeFootnoteId: string | null = null;
  let activeParagraphs: string[] = [];
  let currentParagraphLines: string[] = [];

  const flushFootnote = () => {
    if (!activeFootnoteId) return;
    if (currentParagraphLines.length > 0) {
      activeParagraphs.push(currentParagraphLines.join(' ').trim());
      currentParagraphLines = [];
    }
    const existing = rawFootnotes.get(activeFootnoteId) ?? [];
    const cleaned = activeParagraphs.filter((p) => p.length > 0);
    rawFootnotes.set(activeFootnoteId, [...existing, ...(cleaned.length > 0 ? cleaned : [''])]);
    activeFootnoteId = null;
    activeParagraphs = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const defMatch = FOOTNOTE_DEF_RE.exec(line);

    if (defMatch) {
      flushFootnote();
      activeFootnoteId = defMatch[1] ?? '';
      const firstLine = (defMatch[2] ?? '').trim();
      if (firstLine) {
        currentParagraphLines.push(firstLine);
      }
      continue;
    }

    if (activeFootnoteId !== null) {
      if (line.trim() === '') {
        if (currentParagraphLines.length > 0) {
          activeParagraphs.push(currentParagraphLines.join(' ').trim());
          currentParagraphLines = [];
        }
        // Check if the next non-empty line is indented (multi-paragraph footnote)
        const nextLine = lines[i + 1];
        if (nextLine !== undefined && /^(?: {2,}|\t)/.test(nextLine)) {
          continue;
        }
        flushFootnote();
        bodyLines.push(line);
        continue;
      }

      if (/^(?: {2,}|\t)/.test(line)) {
        currentParagraphLines.push(line.trim());
        continue;
      }

      // Non-indented, non-empty line terminates the footnote definition
      flushFootnote();
    }

    bodyLines.push(line);
  }

  flushFootnote();
  return { bodyLines, rawFootnotes };
}

function buildFootnotes(
  rawFootnotes: Map<string, string[]>,
  knownFootnotes: ReadonlySet<string>,
): Record<string, Block[]> {
  const result: Record<string, Block[]> = {};
  for (const [fnId, paragraphs] of rawFootnotes.entries()) {
    result[fnId] = paragraphs.map((pText, idx) => ({
      id: `fn_${fnId}_p${String(idx + 1).padStart(4, '0')}`,
      kind: 'p',
      html: renderInlineHtml(pText, knownFootnotes),
      noIndent: idx === 0 ? true : undefined,
    }));
  }
  return result;
}

function makeBlockId(chapterId: string, blockNumber: number): string {
  return `${chapterId}_p${String(blockNumber).padStart(4, '0')}`;
}

export function chapterIdForIndex(chapterIndex: number): string {
  return `ch${String(chapterIndex).padStart(2, '0')}`;
}

export function finalizeChapter(
  chapterIndex: number,
  title: string,
  rawBlocks: Omit<Block, 'id'>[],
  rawHash?: string,
): Chapter {
  const id = chapterIdForIndex(chapterIndex);
  let wordCount = 0;

  const blocks: Block[] = rawBlocks.map((b, idx) => {
    const blockId = makeBlockId(id, idx + 1);
    if (b.kind !== 'break' && b.kind !== 'image') {
      wordCount += countWordsInHtml(b.html);
    }
    const block: Block = {
      id: blockId,
      kind: b.kind,
      html: b.html,
    };
    if (b.noIndent) {
      block.noIndent = true;
    }
    return block;
  });

  const hashPayload = `${title}\n${blocks.map((b) => `${b.kind}:${b.html}`).join('\n')}`;
  const chapter: Chapter = {
    id,
    title,
    blocks,
    wordCount,
    hash: hashString(hashPayload),
  };
  if (rawHash !== undefined) {
    chapter.rawHash = rawHash;
  }
  return chapter;
}

/**
 * One chapter's untouched source, isolated from the rest of the document. `lines` holds the
 * chapter body (the heading line excluded when the chapter came from a heading) so a chapter
 * can be parsed on its own and produce byte-identical blocks to a whole-book parse.
 */
export type ChapterSourceSlice = {
  /** Resolved chapter title exactly as the reader will show it. */
  title: string;
  /** Chapter body lines, with the heading line removed when `headingLine` is set. */
  lines: string[];
  /** The raw heading line this slice was opened by (`# ...` in md, detected heading in txt). */
  headingLine?: string;
};

export type BookSourceFormat = 'md' | 'txt';

/**
 * A parsed document skeleton: metadata, footnotes and per-chapter source slices. Both the full
 * parser and the delta re-parser are built on top of this, so they can never drift apart.
 */
export type PreparedBookSource = {
  meta: BookMeta;
  footnotes: Record<string, Block[]>;
  knownFootnotes: ReadonlySet<string>;
  slices: ChapterSourceSlice[];
};

/**
 * Bump when the raw-slice hashing changes. Old hashes then stop matching and everything is
 * simply re-parsed instead of being reused unsafely.
 */
export const RAW_HASH_VERSION = 'delta-v2';

const FOOTNOTE_REF_RE = /\[\^([a-zA-Z0-9_-]+)\]/g;

/**
 * Hash of everything that decides a chapter's parsed output: its raw source lines, its title, the
 * source format, the parse options that change the result, and — only when the slice actually
 * references footnotes — whether each referenced footnote exists yet (a new definition changes
 * rendering).
 *
 * Why (tech): this runs before block/inline parsing, so an untouched chapter can be recognised
 * from the raw text alone and reused without touching the markdown pipeline. The format is part of
 * the key because identical text parses differently as Markdown (`**bold**` → `<strong>`) and as
 * plain text (`**bold**` stays literal): a `parseTxt` chapter must never be reused for Markdown.
 */
export function computeChapterRawHash(
  slice: ChapterSourceSlice,
  knownFootnotes: ReadonlySet<string>,
  format: BookSourceFormat,
  options?: ParseOptions,
): string {
  const body = slice.lines.join('\n');
  const refIds = new Set<string>();
  FOOTNOTE_REF_RE.lastIndex = 0;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = FOOTNOTE_REF_RE.exec(body)) !== null) {
    refIds.add(refMatch[1] ?? '');
  }
  const refSignature = [...refIds]
    .sort()
    .map((id) => `${id}:${knownFootnotes.has(id) ? '1' : '0'}`)
    .join(',');

  return hashString(
    [
      RAW_HASH_VERSION,
      `format:${format}`,
      options?.cleanArabic ? 'clean:1' : 'clean:0',
      `title:${slice.title}`,
      `heading:${slice.headingLine ?? ''}`,
      `refs:${refSignature}`,
      body,
    ].join('\n'),
  );
}

function buildMarkdownBlocks(
  lines: string[],
  knownFootnotes: ReadonlySet<string>,
): Omit<Block, 'id'>[] {
  const blocks: Omit<Block, 'id'>[] = [];
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  // Every chapter starts on a non-indented first paragraph: an `# ...` heading resets this in the
  // whole-book parser, and a document's first line behaves the same way.
  let nextParagraphNoIndent = true;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const joined = paragraphLines.join(' ').replace(/\s+/g, ' ').trim();
    paragraphLines = [];
    if (!joined) return;

    const block: Omit<Block, 'id'> = {
      kind: 'p',
      html: renderInlineHtml(joined, knownFootnotes),
    };
    if (nextParagraphNoIndent) {
      block.noIndent = true;
    }
    blocks.push(block);
    nextParagraphNoIndent = false;
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    const parts: string[] = [];
    let currentPart: string[] = [];

    for (const qLine of quoteLines) {
      if (qLine.trim() === '') {
        if (currentPart.length > 0) {
          parts.push(renderInlineHtml(currentPart.join(' ').trim(), knownFootnotes));
          currentPart = [];
        }
      } else {
        currentPart.push(qLine.trim());
      }
    }
    if (currentPart.length > 0) {
      parts.push(renderInlineHtml(currentPart.join(' ').trim(), knownFootnotes));
    }

    quoteLines = [];
    if (parts.length === 0) return;

    blocks.push({
      kind: 'quote',
      html: parts.join('<br>'),
    });
    nextParagraphNoIndent = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      flushQuote();
      continue;
    }

    const h1Match = H1_RE.exec(line);
    if (h1Match) {
      // A chapter slice never contains an `# ...` heading (it *is* the boundary). Keep the branch
      // so a nested heading cannot silently become prose if a caller passes unsplit lines.
      flushParagraph();
      flushQuote();
      continue;
    }

    const h2Match = H2_RE.exec(line);
    if (h2Match) {
      flushParagraph();
      flushQuote();
      blocks.push({
        kind: 'h2',
        html: renderInlineHtml((h2Match[1] ?? '').trim(), knownFootnotes),
      });
      nextParagraphNoIndent = true;
      continue;
    }

    if (SCENE_BREAK_RE.test(trimmed)) {
      flushParagraph();
      flushQuote();
      blocks.push({
        kind: 'break',
        html: '✦ ✦ ✦',
      });
      nextParagraphNoIndent = true;
      continue;
    }

    const quoteMatch = QUOTE_RE.exec(line);
    if (quoteMatch) {
      flushParagraph();
      quoteLines.push(quoteMatch[1] ?? '');
      continue;
    }

    const imgMatch = IMAGE_LINE_RE.exec(trimmed);
    if (imgMatch) {
      flushParagraph();
      flushQuote();
      blocks.push(parseImageBlock(imgMatch[1] ?? '', imgMatch[2] ?? ''));
      nextParagraphNoIndent = false;
      continue;
    }

    const obsidianMatch = OBSIDIAN_IMAGE_LINE_RE.exec(trimmed);
    if (obsidianMatch) {
      flushParagraph();
      flushQuote();
      blocks.push(parseObsidianImageBlock(obsidianMatch[1] ?? ''));
      nextParagraphNoIndent = false;
      continue;
    }

    // Normal prose line
    flushQuote();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushQuote();
  return blocks;
}

function buildTxtBlocks(lines: string[]): Omit<Block, 'id'>[] {
  const blocks: Omit<Block, 'id'>[] = [];
  let isFirstBlockInChapter = true;
  for (const line of lines) {
    if (!line) continue;
    const block: Omit<Block, 'id'> = {
      kind: 'p',
      html: escapeHtml(line),
    };
    if (isFirstBlockInChapter) {
      block.noIndent = true;
      isFirstBlockInChapter = false;
    }
    blocks.push(block);
  }
  return blocks;
}

export function buildChapterBlocks(
  format: BookSourceFormat,
  slice: ChapterSourceSlice,
  knownFootnotes: ReadonlySet<string>,
): Omit<Block, 'id'>[] {
  return format === 'txt'
    ? buildTxtBlocks(slice.lines)
    : buildMarkdownBlocks(slice.lines, knownFootnotes);
}

function hasBlockContent(lines: readonly string[]): boolean {
  return lines.some((line) => line.trim() !== '');
}

/**
 * Split markdown body lines (frontmatter and footnote definitions already removed) at `# ...`
 * chapter boundaries. Text before the first heading only survives as a chapter when it carries
 * content, mirroring the whole-book parser exactly.
 *
 * `producesBlocks` decides what "carries content" means. The whole-book parser emitted a chapter
 * by looking at the blocks it produced (`blocks.length > 0`), so raw text that renders nothing —
 * e.g. a lone `>` line before the first heading — must not create a ghost chapter. Passing the
 * real block builder keeps this splitter byte-identical to a full parse instead of approximating
 * it with "is there a non-blank line".
 */
function sliceMarkdownLines(
  bodyLines: readonly string[],
  defaultTitle: string,
  producesBlocks: (lines: string[]) => boolean = hasBlockContent,
): ChapterSourceSlice[] {
  const slices: ChapterSourceSlice[] = [];
  let current: ChapterSourceSlice = { title: defaultTitle, lines: [] };
  let currentIsExplicit = false;

  for (const line of bodyLines) {
    const h1Match = H1_RE.exec(line);
    if (h1Match) {
      if (currentIsExplicit || producesBlocks(current.lines)) {
        slices.push(current);
      }
      current = {
        title: stripInlineMarkdown(h1Match[1] ?? '') || defaultTitle,
        lines: [],
        headingLine: line,
      };
      currentIsExplicit = true;
      continue;
    }
    current.lines.push(line);
  }

  if (currentIsExplicit || producesBlocks(current.lines) || slices.length === 0) {
    slices.push(current);
  }
  return slices;
}

/**
 * Split plain-text lines at detected chapter headings. Blank lines never reach a chapter body
 * (the txt parser ignores them), so the slice holds trimmed content lines only.
 */
function sliceTxtLines(
  lines: readonly string[],
  fallbackTitle: string,
  detectChapters: boolean,
): ChapterSourceSlice[] {
  const slices: ChapterSourceSlice[] = [];
  let current: ChapterSourceSlice = { title: fallbackTitle, lines: [] };

  const commitCurrent = () => {
    if (current.lines.length > 0) {
      slices.push(current);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (!trimmed) continue;

    if (detectChapters) {
      const prevBlank = i === 0 || (lines[i - 1] ?? '').trim() === '';
      const nextBlank = i === lines.length - 1 || (lines[i + 1] ?? '').trim() === '';
      const heading = detectTxtChapterHeading(trimmed, { prevBlank, nextBlank });
      if (heading) {
        commitCurrent();
        current = { title: heading, lines: [], headingLine: lines[i] };
        continue;
      }
    }

    current.lines.push(trimmed);
  }

  commitCurrent();
  if (slices.length === 0) {
    slices.push(current);
  }
  return slices;
}

function buildMeta(
  title: string,
  lang: string,
  dir: 'rtl' | 'ltr',
  fields: Record<string, string>,
): BookMeta {
  const meta: BookMeta = {
    title,
    lang,
    dir,
  };
  if (fields.author?.trim()) {
    meta.author = fields.author.trim();
  }
  if (fields.coverColor?.trim()) {
    meta.coverColor = fields.coverColor.trim();
  }
  return meta;
}

function assembleBook(
  meta: BookMeta,
  footnotes: Record<string, Block[]>,
  chapters: Chapter[],
  fileName: string,
): Book {
  const wordCount = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  const id = `book_${hashString(`${fileName}\n${meta.title}\n${chapters[0]?.hash ?? ''}`)}`;
  return {
    id,
    meta,
    chapters,
    footnotes,
    wordCount,
  };
}

/**
 * Prepare a markdown document for chapter-by-chapter parsing: frontmatter, footnote extraction,
 * language detection and chapter slicing, all before any block/inline markdown work happens.
 */
export function prepareMarkdownBook(
  text: string,
  fileName: string,
  options?: ParseOptions,
): PreparedBookSource {
  const normalized = normalizeLineEndings(text);
  const lines = normalized.split('\n');

  const { fields, bodyStartLine } = extractFrontmatter(lines);
  // Why (tech, Codex P2): footnotes are pulled out of the *raw* body before cleaning. Cleaning the
  // whole body first unwrapped a footnote's indented continuation line together with the body line
  // that followed it, so `extractFootnotes` then read that body line as a continuation and the body
  // paragraph vanished from the chapter. Body and each footnote paragraph are cleaned separately,
  // and the whole operation stays non-destructive (the caller's string is never touched).
  const bodyText = lines.slice(bodyStartLine).join('\n');
  const { bodyLines: rawBodyLines, rawFootnotes: uncleanedFootnotes } = extractFootnotes(
    bodyText.split('\n'),
  );
  const bodyLines = options?.cleanArabic
    ? cleanArabicText(rawBodyLines.join('\n')).split('\n')
    : rawBodyLines;
  const rawFootnotes = new Map<string, string[]>();
  for (const [fnId, paragraphs] of uncleanedFootnotes) {
    rawFootnotes.set(
      fnId,
      options?.cleanArabic ? paragraphs.map((p) => cleanArabicText(p)) : paragraphs,
    );
  }

  const knownFootnotes = new Set(rawFootnotes.keys());
  const footnotes = buildFootnotes(rawFootnotes, knownFootnotes);

  const fallbackTitle = titleFromFileName(fileName);
  const title = fields.title?.trim() || fallbackTitle;
  const { lang, dir } = detectLanguageAndDir(
    bodyLines.slice(0, 80).join('\n'),
    fields.lang,
    fields.dir,
  );

  return {
    meta: buildMeta(title, lang, dir, fields),
    footnotes,
    knownFootnotes,
    // Why: the preamble chapter and a bare `#` heading are titled with the book's resolved title
    // (frontmatter `title` first, file name second) exactly like the original whole-book parse.
    // The chapter keeps itself out when its lines produce no blocks at all.
    slices: sliceMarkdownLines(
      bodyLines,
      title,
      (lines) => buildMarkdownBlocks(lines, knownFootnotes).length > 0,
    ),
  };
}

/**
 * Prepare a plain-text document for chapter-by-chapter parsing.
 */
export function prepareTxtBook(
  text: string,
  fileName: string,
  options?: ParseOptions,
): PreparedBookSource {
  const normalized = normalizeLineEndings(text);
  const cleaned = options?.cleanArabic ? cleanArabicText(normalized) : normalized;
  const lines = cleaned.split('\n');
  const title = titleFromFileName(fileName);
  const { lang, dir } = detectLanguageAndDir(lines.slice(0, 80).join('\n'));
  const detectChapters = options?.detectChapters !== false;

  return {
    meta: {
      title,
      lang,
      dir,
    },
    footnotes: {},
    knownFootnotes: new Set<string>(),
    slices: sliceTxtLines(lines, title, detectChapters),
  };
}

function parseImageBlock(altRaw: string, srcRaw: string): Omit<Block, 'id'> {
  let src = srcRaw.trim();
  // Strip optional <...> wrapper or markdown title ("title" / 'title')
  if (src.startsWith('<') && src.includes('>')) {
    src = src.slice(1, src.indexOf('>')).trim();
  } else {
    const titleSplit = /^(\S+)\s+(?:"[^"]*"|'[^']*')$/.exec(src);
    if (titleSplit?.[1]) {
      src = titleSplit[1];
    }
  }

  if (!isSafeImageSrc(src)) {
    return {
      kind: 'p',
      html: escapeHtml(`![${altRaw}](${srcRaw})`),
    };
  }

  const safeSrc = escapeHtml(src);
  const safeAlt = escapeHtml(altRaw.trim());
  return {
    kind: 'image',
    html: `<img src="${safeSrc}" alt="${safeAlt}">`,
  };
}

/**
 * Parse an Obsidian image embed line: `![[name.webp]]`, `![[images/map.png]]`,
 * `![[name.webp|alt text]]`, `![[name.webp|300]]`, `![[name.webp|300x200]]`.
 * Anything that is not a safe raster path inside the bundle degrades to escaped text.
 */
function parseObsidianImageBlock(innerRaw: string): Omit<Block, 'id'> {
  const fallback: Omit<Block, 'id'> = {
    kind: 'p',
    html: escapeHtml(`![[${innerRaw}]]`),
  };

  const parts = innerRaw.split('|');
  const targetRaw = (parts[0] ?? '').trim();
  if (!targetRaw) return fallback;

  let alt = '';
  for (const rawPart of parts.slice(1)) {
    const value = rawPart.trim();
    if (!value) continue;
    // Obsidian size syntax (`|300`, `|300x200`) is not alt text.
    if (/^\d+(?:\s*[xX×]\s*\d+)?$/.test(value)) continue;
    alt = value;
    break;
  }

  // Only safe raster images are embeddable; svg/html/scripts degrade to text.
  if (!hasSafeRasterExtension(targetRaw)) return fallback;

  // A bare file name lives in the book's assets folder; a path keeps its relative form.
  const resolved = targetRaw.includes('/') ? targetRaw : `assets/${targetRaw}`;
  if (!isSafeImageSrc(resolved)) return fallback;

  return {
    kind: 'image',
    html: `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}">`,
  };
}

/**
 * Parse a Markdown novel file into the canonical BookModel.
 */
export function parseBook(text: string, fileName: string, options?: ParseOptions): Book {
  const prepared = prepareMarkdownBook(text, fileName, options);
  const chapters = prepared.slices.map((slice, idx) =>
    finalizeChapter(
      idx + 1,
      slice.title,
      buildChapterBlocks('md', slice, prepared.knownFootnotes),
      computeChapterRawHash(slice, prepared.knownFootnotes, 'md', options),
    ),
  );
  return assembleBook(prepared.meta, prepared.footnotes, chapters, fileName);
}

/**
 * Parse a plain-text (.txt) novel file into the canonical BookModel.
 * Escapes raw HTML, preserves Arabic Tashkeel, and splits non-empty lines into paragraphs.
 *
 * When `detectChapters` is on (the default) detected chapter headings become chapter titles and
 * any text before the first heading stays as the first chapter. Files with no detectable heading
 * keep the historical single-chapter result, byte for byte.
 */
export function parseTxt(text: string, fileName: string, options?: ParseOptions): Book {
  const prepared = prepareTxtBook(text, fileName, options);
  const chapters = prepared.slices.map((slice, idx) =>
    finalizeChapter(
      idx + 1,
      slice.title,
      buildChapterBlocks('txt', slice, prepared.knownFootnotes),
      computeChapterRawHash(slice, prepared.knownFootnotes, 'txt', options),
    ),
  );
  return assembleBook(prepared.meta, prepared.footnotes, chapters, fileName);
}
