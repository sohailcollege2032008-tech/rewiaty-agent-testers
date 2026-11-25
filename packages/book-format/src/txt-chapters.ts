/**
 * Chapter-heading detection for plain-text (.txt) novels.
 *
 * Detects the shapes Arabic and English books actually use for chapter titles, and
 * refuses obvious prose (a narrative paragraph that merely *starts* with «الفصل»).
 * Detection is pure and never mutates its input.
 */

/** Arabic harakat, tanween, shadda, sukun, superscript alef, and the tatweel elongation mark. */
const ARABIC_DIACRITICS_RE = /[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g;

/** Longest line (in characters) that can still be a heading. */
const MAX_HEADING_LENGTH = 80;

/** Longest standalone number / roman-numeral line we accept as a heading. */
const MAX_NUMERIC_HEADING_LENGTH = 12;

/** A heading never ends with sentence-final punctuation (that is prose). */
const SENTENCE_END_RE = /[\u002E\u061F\u0021\u2026]\s*$/;

const AR_DIGITS = '[0-9\u0660-\u0669]';

/** Arabic ordinal words without the leading article, already tashkeel-free. */
const AR_ORDINAL_WORD =
  '(?:[\u0623\u0627]ول[\u0649\u064A]?|ثاني[ةه]?|ثالث[ةه]?|رابع[ةه]?|خامس[ةه]?|سادس[ةه]?|سابع[ةه]?|ثامن[ةه]?|تاسع[ةه]?|عاشر[ةه]?|حادي[ةه]?|عشر(?:ون|ين)?|ثلاث(?:ون|ين)|[\u0623\u0627]ربع(?:ون|ين)?|خمس(?:ون|ين)?)';

/** A numeral slot after «الفصل»: digits, Arabic-Indic digits, or an ordinal word (+ «عشر» / compound). */
const AR_NUMERAL = `(?:(?:ال)?${AR_ORDINAL_WORD}(?:\\s+(?:عشر|عشرة))?(?:\\s+و(?:ال)?${AR_ORDINAL_WORD})?|${AR_DIGITS}+)`;
const AR_DIGITS_ONLY = `${AR_DIGITS}+`;

const AR_CHAPTER_RE = new RegExp(
  `^(?:ال)?(?:فصل|باب|جزء)\\s*[:：]?\\s*${AR_NUMERAL}(?:\\s*[:：.\\-–—]\\s*\\S.*)?$`,
);

/** Front/back matter that stands alone as a title. */
const AR_SPECIAL_RE = /^(?:ال)?(?:مقدمة|تمهيد|خاتمة)\s*(?:[:：]\s*\S.*)?$/;

const EN_ROMAN = '[IVXLCDM]+';
const EN_WORD_NUMBER =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)';

const EN_CHAPTER_RE = new RegExp(
  `^(?:chapter|chap\\.?|part|book)\\s+(?:[0-9]+|${EN_WORD_NUMBER}|${EN_ROMAN})(?:\\s*[:：.\\-–—]\\s*\\S.*)?$`,
  'i',
);

const EN_SPECIAL_RE = /^(?:prologue|epilogue)\s*(?:[:：]\s*\S.*)?$/i;

/** `1`, `١٢`, `(١)`, `[1]`, `- 1 -`, `— ١ —`. */
const STANDALONE_NUMBER_RE = new RegExp(
  `^(?:${AR_DIGITS_ONLY}|\\(\\s*${AR_DIGITS_ONLY}\\s*\\)|\\[\\s*${AR_DIGITS_ONLY}\\s*\\]|[-–—]\\s*${AR_DIGITS_ONLY}\\s*[-–—])$`,
);

/** Roman numerals I..L (valid, uppercase). */
const ROMAN_HEADING_RE = /^(?=[IVXL])(?:XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;

export type TxtChapterContext = {
  prevBlank: boolean;
  nextBlank: boolean;
};

function stripTashkeel(line: string): string {
  return line.replace(ARABIC_DIACRITICS_RE, '');
}

/**
 * Return the heading title when `line` looks like a chapter heading, otherwise `null`.
 *
 * Keyword headings («الفصل الأول», «Chapter 1», «Prologue») are recognised from the line alone;
 * bare numbers and roman numerals additionally require blank-line context.
 */
export function detectTxtChapterHeading(
  line: string,
  context?: TxtChapterContext,
): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_HEADING_LENGTH) return null;
  if (SENTENCE_END_RE.test(trimmed)) return null;

  const bare = stripTashkeel(trimmed).replace(/\s+/g, ' ');

  if (AR_CHAPTER_RE.test(bare) || AR_SPECIAL_RE.test(bare)) return trimmed;
  // Why (tech): stripTashkeel keeps hamza/alef variants, so test the original too for «فصل» shapes
  // where the article is written with a plain alef.
  if (AR_CHAPTER_RE.test(trimmed) || AR_SPECIAL_RE.test(trimmed)) return trimmed;

  if (EN_CHAPTER_RE.test(bare) || EN_SPECIAL_RE.test(bare)) return trimmed;

  // Why (tech): default to "isolated line" when no context is supplied; parseTxt always passes it.
  const prevBlank = context?.prevBlank ?? true;
  const nextBlank = context?.nextBlank ?? true;
  if (!prevBlank) return null;

  if (
    bare.length <= MAX_NUMERIC_HEADING_LENGTH &&
    (STANDALONE_NUMBER_RE.test(bare) || STANDALONE_NUMBER_RE.test(trimmed))
  ) {
    return trimmed;
  }

  // Roman numerals are only safe when the line is fully isolated by blank lines.
  if (nextBlank && ROMAN_HEADING_RE.test(trimmed)) return trimmed;

  return null;
}
