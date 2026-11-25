const ARABIC_DIACRITICS_AND_TATWEEL_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/;
const ARABIC_DIACRITICS_AND_TATWEEL_GLOBAL_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const ALEF_VARIANTS_RE = /[أإآٱ]/g;
const FN_REF_SUP_RE = /<sup\b[^>]*class\s*=\s*["'][^"']*\bfn-ref\b[^"']*["'][^>]*>[\s\S]*?<\/sup>/gi;

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (match, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    .replace(/&amp;/gi, '&');
}

/**
 * Strip inline HTML tags, footnote references, and basic HTML entities into clean plain text
 * without splitting words across inline formatting tags.
 */
export function stripHtmlToPlainText(html: string): string {
  if (!html) return '';
  const withoutFootnotes = html.replace(FN_REF_SUP_RE, '');
  const withBlockSpaces = withoutFootnotes
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])>/gi, ' ');
  const withoutTags = withBlockSpaces.replace(/<[^>]+>/g, '');
  return decodeBasicEntities(withoutTags).replace(/\s+/g, ' ').trim();
}

function isArabicDiacriticOrTatweelCode(code: number): boolean {
  return (
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06ed) ||
    code === 0x0640
  );
}

function isWhitespaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x00a0;
}

function normalizeCharCode(code: number, ch: string): string {
  // أ (0x0623), إ (0x0625), آ (0x0622), ٱ (0x0671) -> ا
  if (code === 0x0623 || code === 0x0625 || code === 0x0622 || code === 0x0671) return 'ا';
  // ة (0x0629) -> ه
  if (code === 0x0629) return 'ه';
  // ى (0x0649) -> ي
  if (code === 0x0649) return 'ي';
  if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
  return code < 128 ? ch : ch.toLowerCase();
}

/**
 * Normalize Arabic and Latin text for diacritic-insensitive and orthographic-tolerant search.
 */
export function normalizeArabicForSearch(input: string): string {
  if (!input) return '';
  return input
    .replace(ARABIC_DIACRITICS_AND_TATWEEL_GLOBAL_RE, '')
    .replace(ALEF_VARIANTS_RE, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type MatchSpan = {
  offset: number;
  length: number;
};

/**
 * Locate the character offset and span length of the first match in the original (vocalized) text.
 */
export function findMatchSpanInOriginal(
  originalText: string,
  normalizedQuery: string,
  alreadyNormalized = false,
): MatchSpan {
  if (!originalText) return { offset: 0, length: 0 };
  const normQuery = alreadyNormalized
    ? normalizedQuery
    : normalizeArabicForSearch(normalizedQuery);
  if (!normQuery) return { offset: 0, length: 0 };

  const normChars: string[] = [];
  const origStarts: number[] = [];
  const origEnds: number[] = [];

  for (let i = 0; i < originalText.length; i++) {
    const ch = originalText[i]!;
    const code = ch.charCodeAt(0);
    if (isArabicDiacriticOrTatweelCode(code)) {
      if (origEnds.length > 0 && normChars[normChars.length - 1] !== ' ') {
        origEnds[origEnds.length - 1] = i + 1;
      }
      continue;
    }

    if (isWhitespaceCode(code) || (code > 127 && /\s/.test(ch))) {
      if (normChars.length > 0 && normChars[normChars.length - 1] !== ' ') {
        normChars.push(' ');
        origStarts.push(i);
        origEnds.push(i + 1);
      }
      continue;
    }

    const mapped = normalizeCharCode(code, ch);
    for (let k = 0; k < mapped.length; k++) {
      normChars.push(mapped[k]!);
      origStarts.push(i);
      origEnds.push(i + 1);
    }
  }

  if (normChars.length > 0 && normChars[normChars.length - 1] === ' ') {
    normChars.pop();
    origStarts.pop();
    origEnds.pop();
  }

  const normText = normChars.join('');

  const exactIdx = normText.indexOf(normQuery);
  if (exactIdx >= 0) {
    const start = origStarts[exactIdx] ?? 0;
    const end = origEnds[exactIdx + normQuery.length - 1] ?? start;
    return { offset: start, length: Math.max(0, end - start) };
  }

  // Fallback for multi-word queries separated by punctuation in the original text.
  const tokens = normQuery.split(' ').filter(Boolean);
  for (const token of tokens) {
    const tokenIdx = normText.indexOf(token);
    if (tokenIdx >= 0) {
      const start = origStarts[tokenIdx] ?? 0;
      const end = origEnds[tokenIdx + token.length - 1] ?? start;
      return { offset: start, length: Math.max(0, end - start) };
    }
  }

  return { offset: 0, length: 0 };
}

/**
 * Return the exact character offset in the original vocalized text for the first query match.
 */
export function findMatchOffsetInOriginal(
  originalText: string,
  normalizedQuery: string,
): number {
  return findMatchSpanInOriginal(originalText, normalizedQuery).offset;
}

export type SearchSnippet = {
  before: string;
  match: string;
  after: string;
};

/**
 * Build a readable context snippet around a match in the original text with ellipsis at truncated edges.
 */
export function buildSearchSnippet(
  originalText: string,
  matchOffset: number,
  queryLength: number,
  radius = 48,
): SearchSnippet {
  const len = originalText.length;
  const start = Math.max(0, Math.min(matchOffset, len));
  let end = Math.max(start, Math.min(start + Math.max(0, queryLength), len));

  while (end < len && isArabicDiacriticOrTatweelCode(originalText.charCodeAt(end))) {
    end += 1;
  }

  const r = Math.max(8, Math.floor(radius));
  let sliceStart = Math.max(0, start - r);
  if (sliceStart > 0) {
    const nextSpace = originalText.indexOf(' ', sliceStart);
    if (nextSpace !== -1 && nextSpace + 1 <= start && nextSpace - sliceStart <= 12) {
      sliceStart = nextSpace + 1;
    }
  }

  let sliceEnd = Math.min(len, end + r);
  if (sliceEnd < len) {
    const prevSpace = originalText.lastIndexOf(' ', sliceEnd);
    if (prevSpace !== -1 && prevSpace >= end && sliceEnd - prevSpace <= 12) {
      sliceEnd = prevSpace;
    }
  }

  return {
    before: (sliceStart > 0 ? '…' : '') + originalText.slice(sliceStart, start),
    match: originalText.slice(start, end),
    after: originalText.slice(end, sliceEnd) + (sliceEnd < len ? '…' : ''),
  };
}
