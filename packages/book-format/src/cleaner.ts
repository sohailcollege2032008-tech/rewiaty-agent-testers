/**
 * Non-destructive Arabic text cleaner (F19).
 *
 * Every function here is pure: it takes a string and returns a new one. Nothing is written to disk,
 * the source file is never touched, and Arabic Tashkeel survives character-for-character.
 */

import { detectTxtChapterHeading } from './txt-chapters.js';

export type CleanArabicOptions = {
  /** Remove spaces/tabs sitting before Arabic punctuation. Default: true. */
  punctuationSpacing?: boolean;
  /** Convert `"..."` to «...» when the quoted text contains Arabic. Default: true. */
  arabicQuotes?: boolean;
  /** Join hard-wrapped lines inside a paragraph. Default: true. */
  unwrapHardLines?: boolean;
};

const PUNCTUATION_BEFORE_SPACE_RE = /[ \t]+([،؛؟!.:…])/g;

/** Arabic-Indic and ASCII digits: a decimal point between two of these must survive. */
const DIGIT_RE = /[0-9\u0660-\u0669]/;

const ARABIC_LETTER_RE = /[\u0600-\u06FF]/;

const YAML_KV_RE = /^[a-zA-Z0-9_-]+\s*:\s*.*$/;

const SENTENCE_END_RE = /[.؟!…»]\s*["'\u201D\u2019]?\s*$/;

const DIALOGUE_START_RE = /^[-–—]\s+|^«/;

const LIST_OR_DIALOGUE_RE = /^[-–—*+]\s+/;

/**
 * Clean Arabic prose while preserving the author's meaning and marks.
 * The operation is idempotent: `cleanArabicText(cleanArabicText(s)) === cleanArabicText(s)`.
 */
export function cleanArabicText(text: string, options?: CleanArabicOptions): string {
  const opts = {
    punctuationSpacing: options?.punctuationSpacing !== false,
    arabicQuotes: options?.arabicQuotes !== false,
    unwrapHardLines: options?.unwrapHardLines !== false,
  };

  // Order matters for idempotency: unwrapping can complete a quote pair that was split across
  // lines, so quotes are converted after joining, and stray spaces before punctuation are the
  // very last thing removed.
  let out = text;
  if (opts.unwrapHardLines) out = unwrapLines(out);

  // YAML frontmatter is metadata, not prose: it is never re-quoted or re-spaced.
  const lines = out.split('\n');
  const frontmatterEnd = findFrontmatterEnd(lines);
  const bodyStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
  const head = lines.slice(0, bodyStart);
  let body = lines.slice(bodyStart);

  if (opts.arabicQuotes) body = body.map((line) => convertLineQuotes(line));
  if (opts.punctuationSpacing) body = body.map((line) => fixPunctuationSpacing(line));

  return [...head, ...body].join('\n');
}

function canDropSpaceBefore(
  punct: string,
  prevNonSpace: string,
  nextNonSpace: string,
): boolean {
  switch (punct) {
    case '.':
      // Never touch an ellipsis or serial dots: `...`, `. . .`.
      if (prevNonSpace === '.' || nextNonSpace === '.') return false;
      // Never split a decimal number: `3.5`.
      if (DIGIT_RE.test(prevNonSpace) && DIGIT_RE.test(nextNonSpace)) return false;
      // Never touch a URL or a path: `https ://`.
      if (nextNonSpace === '/') return false;
      // Never touch a filename extension: `report .pdf`.
      if (/[A-Za-z\u0600-\u06FF]/.test(prevNonSpace) && /[A-Za-z0-9]/.test(nextNonSpace)) {
        return false;
      }
      return true;
    case ':':
      // Never break a URL scheme.
      if (nextNonSpace === '/' || nextNonSpace === '\\') return false;
      // Never reshape clock times or ratios such as `12 : 30`.
      if (DIGIT_RE.test(prevNonSpace) && DIGIT_RE.test(nextNonSpace)) return false;
      return true;
    default:
      // `،` `؛` `؟` `!` `…`
      return true;
  }
}

function fixPunctuationSpacing(text: string): string {
  return text.replace(
    PUNCTUATION_BEFORE_SPACE_RE,
    (match: string, punct: string, offset: number) => {
      const nextStart = offset + match.length;
      const prevNonSpace = text.slice(0, offset).replace(/[ \t]+$/, '').slice(-1);
      const nextNonSpace = text.slice(nextStart).replace(/^[ \t]+/, '').charAt(0);
      return canDropSpaceBefore(punct, prevNonSpace, nextNonSpace) ? punct : match;
    },
  );
}

/**
 * True when the quote at `index` sits inside an HTML tag or inside a Markdown link destination,
 * i.e. it is syntax, not dialogue.
 */
function isSyntaxQuote(line: string, index: number): boolean {
  const before = line.slice(0, index);
  const lastLt = before.lastIndexOf('<');
  const lastGt = before.lastIndexOf('>');
  if (lastLt > lastGt) return true;

  const lastDestOpen = before.lastIndexOf('](');
  const lastDestClose = before.lastIndexOf(')');
  if (lastDestOpen > lastDestClose) return true;

  const prevChar = before.replace(/[ \t]+$/, '').slice(-1);
  // `alt="..."`, `title="..."` — an attribute value is syntax, not dialogue.
  if (prevChar === '=') return true;

  return false;
}

function convertLineQuotes(line: string): string {
  if (!line.includes('"')) return line;

  const positions: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && line[i - 1] !== '\\') positions.push(i);
  }
  if (positions.length < 2) return line;

  // Why (tech): quotes are strictly alternating in a line (open, close, open, close...). Pairing
  // them in order keeps `"Hello" و"عربي"` from being mis-paired into one giant quote.
  let out = '';
  let cursor = 0;

  for (let i = 0; i + 1 < positions.length; i += 2) {
    const open = positions[i]!;
    const close = positions[i + 1]!;
    const inner = line.slice(open + 1, close);

    const convertible =
      !isSyntaxQuote(line, open) &&
      !isSyntaxQuote(line, close) &&
      ARABIC_LETTER_RE.test(inner) &&
      // Raw HTML inside the pair means this is markup, not dialogue.
      !/[<>]/.test(inner);

    if (convertible) {
      out += `${line.slice(cursor, open)}«${inner}»`;
      cursor = close + 1;
    }
  }

  out += line.slice(cursor);
  return out;
}

function findFrontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return -1;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '---' || trimmed === '...') return i;
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!YAML_KV_RE.test(lines[i] ?? '')) return -1;
  }
  return -1;
}

function isSceneBreak(line: string): boolean {
  return (
    /^(?:\*\s*){2,}\*$/.test(line) ||
    /^(?:-\s*){2,}-$/.test(line) ||
    /^(?:_\s*){2,}_$/.test(line)
  );
}

/**
 * Lines that must survive exactly as they are: headings, scene breaks, quotes, images,
 * footnote definitions, dialogue openers, and detected .txt chapter headings.
 */
function isStructuralLine(
  line: string,
  context: { prevBlank: boolean; nextBlank: boolean },
): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^#{1,6}\s/.test(trimmed)) return true;
  if (isSceneBreak(trimmed)) return true;
  if (/^>/.test(trimmed)) return true;
  if (/^!\[\[[^\]]*\]\]$/.test(trimmed)) return true;
  if (/^!\[[^\]]*\]\([^)]*\)$/.test(trimmed)) return true;
  if (/^\[\^[^\]\s]+\]:/.test(trimmed)) return true;
  if (LIST_OR_DIALOGUE_RE.test(trimmed) || DIALOGUE_START_RE.test(trimmed)) return true;
  if (detectTxtChapterHeading(trimmed, context)) return true;
  return false;
}

function joinLines(head: string, tail: string): string {
  const left = head.replace(/[ \t\r]+$/, '');
  const right = tail.replace(/^[ \t\r]+/, '');
  if (!right) return left;
  // Punctuation belongs to the previous word, not the next one.
  if (/^[،؛؟!.:…»)\]}]/.test(right)) return left + right;
  return `${left} ${right}`;
}

function unwrapLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let index = 0;

  const frontmatterEnd = findFrontmatterEnd(lines);
  if (frontmatterEnd >= 0) {
    for (; index <= frontmatterEnd; index++) result.push(lines[index] ?? '');
  }

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const prevBlank = index === 0 || (lines[index - 1] ?? '').trim() === '';
    const nextLine = lines[index + 1];
    const nextBlank = nextLine === undefined || nextLine.trim() === '';

    if (!line.trim() || isStructuralLine(line, { prevBlank, nextBlank })) {
      result.push(line);
      index++;
      continue;
    }

    let accumulated = line;
    while (index + 1 < lines.length) {
      const following = lines[index + 1] ?? '';
      if (!following.trim()) break;

      const afterFollowing = lines[index + 2];
      const followingNextBlank = afterFollowing === undefined || afterFollowing.trim() === '';
      if (isStructuralLine(following, { prevBlank: false, nextBlank: followingNextBlank })) {
        break;
      }
      if (SENTENCE_END_RE.test(accumulated)) break;

      accumulated = joinLines(accumulated, following);
      index++;
    }

    result.push(accumulated);
    index++;
  }

  return result.join('\n');
}
