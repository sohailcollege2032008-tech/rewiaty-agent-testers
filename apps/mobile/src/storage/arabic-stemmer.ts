/**
 * Light Arabic stemmer for offline dictionary lookups (F49).
 *
 * This is the TypeScript twin of the candidate generation used by
 * `scripts/build-dictionary.py` and the verified build benchmark:
 *
 * 1. Normalize the selected word (diacritics, tatweel, orthographic variants).
 * 2. Strip common prefixes (`وال`, `بال`, `ال`, `و` …).
 * 3. Strip common suffixes (`ات`, `ون`, `ها` …) and restore feminine `ت` → `ه`.
 * 4. Strip verb prefixes (`ي`, `ت`, `ن`, `ست` …) and add taa-marbuta variants.
 *
 * Candidates are returned in ranked order so the lookup can prefer the exact
 * word and fall back to the earliest (strongest) stem.
 */

const DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL_RE = /\u0640/g;
const ALEF_VARIANTS_RE = /[أإآٱ]/g;
/** Anything outside the Arabic letter block is punctuation, space or digits. */
const NON_ARABIC_LETTER_RE = /[^\u0621-\u064A]/g;

const MIN_STEM_LENGTH = 2;

export const ARABIC_PREFIXES: readonly string[] = [
  'وبال',
  'فبال',
  'وكال',
  'فكال',
  'ولل',
  'فلل',
  'وال',
  'فال',
  'بال',
  'كال',
  'لل',
  'وب',
  'فب',
  'وك',
  'فك',
  'ول',
  'فل',
  'وس',
  'فس',
  'ال',
  'و',
  'ف',
  'ب',
  'ك',
  'ل',
  'س',
];

export const ARABIC_SUFFIXES: readonly string[] = [
  'كما',
  'هما',
  'هم',
  'هن',
  'كم',
  'كن',
  'نا',
  'ها',
  'ون',
  'ين',
  'ان',
  'ات',
  'تم',
  'تن',
  'وا',
  'تا',
  'ه',
  'ك',
  'ي',
  'ت',
  'ا',
  'ن',
];

export const ARABIC_VERB_PREFIXES: readonly string[] = [
  'ي',
  'ت',
  'ن',
  'ا',
  'ست',
  'سي',
  'سن',
  'سا',
  'لي',
  'لت',
  'لن',
  'لا',
];

/**
 * Normalize one Arabic word into the dictionary's canonical spelling:
 * no tashkeel/tatweel, no punctuation or whitespace, and orthographic folding
 * (أإآٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي).
 *
 * Returns `''` when the input contains no Arabic letters.
 */
export function normalizeArabicWord(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const withoutMarks = input.replace(DIACRITICS_RE, '').replace(TATWEEL_RE, '');
  const folded = withoutMarks
    .replace(ALEF_VARIANTS_RE, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
  return folded.replace(NON_ARABIC_LETTER_RE, '');
}

/**
 * Generate ordered, deduplicated light-stem candidates for a raw word.
 *
 * The first candidate is always the exact normalized word (when it is a valid
 * Arabic word), then prefix-free forms, then suffix-free forms, then
 * verb-prefix / taa-marbuta variants. Stems shorter than two letters are
 * dropped. Returns `[]` when the input has no Arabic word of two or more
 * letters.
 */
export function generateStemCandidates(rawWord: string): string[] {
  const norm = normalizeArabicWord(rawWord);
  if (norm.length < MIN_STEM_LENGTH) return [];

  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string): void => {
    if (candidate.length < MIN_STEM_LENGTH || seen.has(candidate)) return;
    seen.add(candidate);
    ordered.push(candidate);
  };

  add(norm);

  // 1. Prefix-stripped forms (the ordered array is already the ranking base).
  const prefixForms: string[] = [norm];
  for (const prefix of ARABIC_PREFIXES) {
    if (!norm.startsWith(prefix)) continue;
    const stem = norm.slice(prefix.length);
    if (stem.length < MIN_STEM_LENGTH) continue;
    if (!seen.has(stem)) {
      add(stem);
      prefixForms.push(stem);
    }
  }

  // 2. Suffix-stripped forms for every base (up to two passes for stacked
  //    pronoun + plural/verb endings such as يكتبونها -> يكتبون -> يكتب),
  //    restoring feminine taa (ت → ه).
  const suffixPass1: string[] = [];
  for (const base of prefixForms) {
    for (const suffix of ARABIC_SUFFIXES) {
      if (!base.endsWith(suffix)) continue;
      const stem = base.slice(0, base.length - suffix.length);
      if (stem.length < MIN_STEM_LENGTH) continue;
      if (!seen.has(stem)) {
        add(stem);
        suffixPass1.push(stem);
      }
      if (stem.endsWith('ت')) {
        const fem = `${stem.slice(0, -1)}ه`;
        if (!seen.has(fem)) {
          add(fem);
          suffixPass1.push(fem);
        }
      }
    }
  }
  for (const base of suffixPass1) {
    for (const suffix of ARABIC_SUFFIXES) {
      if (!base.endsWith(suffix)) continue;
      const stem = base.slice(0, base.length - suffix.length);
      if (stem.length < MIN_STEM_LENGTH) continue;
      add(stem);
      if (stem.endsWith('ت')) {
        add(`${stem.slice(0, -1)}ه`);
      }
    }
  }

  // 3. Verb-prefix and taa-marbuta variants of every form discovered so far.
  for (const base of [...ordered]) {
    for (const prefix of ARABIC_VERB_PREFIXES) {
      if (!base.startsWith(prefix)) continue;
      const stem = base.slice(prefix.length);
      if (stem.length < MIN_STEM_LENGTH) continue;
      add(stem);
    }
    if (base.endsWith('ه') && base.length > MIN_STEM_LENGTH) {
      add(base.slice(0, -1));
    } else {
      add(`${base}ه`);
    }
  }

  return ordered;
}
