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

function finalizeChapter(chapterIndex: number, title: string, rawBlocks: Omit<Block, 'id'>[]): Chapter {
  const id = `ch${String(chapterIndex).padStart(2, '0')}`;
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
  return {
    id,
    title,
    blocks,
    wordCount,
    hash: hashString(hashPayload),
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

  type DraftChapter = {
    title: string;
    blocks: Omit<Block, 'id'>[];
    explicitHeading: boolean;
  };

  const draftChapters: DraftChapter[] = [];
  let currentChapter: DraftChapter = {
    title,
    blocks: [],
    explicitHeading: false,
  };

  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
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
    currentChapter.blocks.push(block);
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

    currentChapter.blocks.push({
      kind: 'quote',
      html: parts.join('<br>'),
    });
    nextParagraphNoIndent = false;
  };

  for (const line of bodyLines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      flushParagraph();
      flushQuote();
      continue;
    }

    const h1Match = H1_RE.exec(line);
    if (h1Match) {
      flushParagraph();
      flushQuote();
      const chTitle = stripInlineMarkdown(h1Match[1] ?? '') || title;
      if (currentChapter.explicitHeading || currentChapter.blocks.length > 0) {
        draftChapters.push(currentChapter);
      }
      currentChapter = {
        title: chTitle,
        blocks: [],
        explicitHeading: true,
      };
      nextParagraphNoIndent = true;
      continue;
    }

    const h2Match = H2_RE.exec(line);
    if (h2Match) {
      flushParagraph();
      flushQuote();
      currentChapter.blocks.push({
        kind: 'h2',
        html: renderInlineHtml((h2Match[1] ?? '').trim(), knownFootnotes),
      });
      nextParagraphNoIndent = true;
      continue;
    }

    if (SCENE_BREAK_RE.test(trimmed)) {
      flushParagraph();
      flushQuote();
      currentChapter.blocks.push({
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
      currentChapter.blocks.push(parseImageBlock(imgMatch[1] ?? '', imgMatch[2] ?? ''));
      nextParagraphNoIndent = false;
      continue;
    }

    const obsidianMatch = OBSIDIAN_IMAGE_LINE_RE.exec(trimmed);
    if (obsidianMatch) {
      flushParagraph();
      flushQuote();
      currentChapter.blocks.push(parseObsidianImageBlock(obsidianMatch[1] ?? ''));
      nextParagraphNoIndent = false;
      continue;
    }

    // Normal prose line
    flushQuote();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushQuote();

  if (
    currentChapter.explicitHeading ||
    currentChapter.blocks.length > 0 ||
    draftChapters.length === 0
  ) {
    draftChapters.push(currentChapter);
  }

  const chapters: Chapter[] = draftChapters.map((ch, idx) =>
    finalizeChapter(idx + 1, ch.title, ch.blocks),
  );

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
 * Parse a plain-text (.txt) novel file into the canonical BookModel.
 * Escapes raw HTML, preserves Arabic Tashkeel, and splits non-empty lines into paragraphs.
 *
 * When `detectChapters` is on (the default) detected chapter headings become chapter titles and
 * any text before the first heading stays as the first chapter. Files with no detectable heading
 * keep the historical single-chapter result, byte for byte.
 */
export function parseTxt(text: string, fileName: string, options?: ParseOptions): Book {
  const normalized = normalizeLineEndings(text);
  const cleaned = options?.cleanArabic ? cleanArabicText(normalized) : normalized;
  const lines = cleaned.split('\n');
  const title = titleFromFileName(fileName);
  const { lang, dir } = detectLanguageAndDir(lines.slice(0, 80).join('\n'));
  const detectChapters = options?.detectChapters !== false;

  const meta: BookMeta = {
    title,
    lang,
    dir,
  };

  type DraftChapter = {
    title: string;
    blocks: Omit<Block, 'id'>[];
  };

  const drafts: DraftChapter[] = [];
  let current: DraftChapter = { title, blocks: [] };
  let isFirstBlockInChapter = true;

  const commitCurrent = () => {
    if (current.blocks.length > 0) drafts.push(current);
  };

  const appendParagraph = (plain: string) => {
    const block: Omit<Block, 'id'> = {
      kind: 'p',
      html: escapeHtml(plain),
    };
    if (isFirstBlockInChapter) {
      block.noIndent = true;
      isFirstBlockInChapter = false;
    }
    current.blocks.push(block);
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
        current = { title: heading, blocks: [] };
        isFirstBlockInChapter = true;
        continue;
      }
    }

    appendParagraph(trimmed);
  }

  commitCurrent();
  if (drafts.length === 0) {
    drafts.push(current);
  }

  const chapters: Chapter[] = drafts.map((draft, idx) =>
    finalizeChapter(idx + 1, draft.title, draft.blocks),
  );

  const wordCount = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  const id = `book_${hashString(`${fileName}\n${meta.title}\n${chapters[0]?.hash ?? ''}`)}`;

  return {
    id,
    meta,
    chapters,
    footnotes: {},
    wordCount,
  };
}
