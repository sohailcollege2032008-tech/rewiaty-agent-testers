import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  displayOffsetForOriginalOffset,
  isHiddenMark,
  isTashkeelMark,
  originalOffsetForDisplayOffset,
  stripTashkeel,
  type TashkeelMode,
} from '../src/tashkeel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.resolve(__dirname, '../../../samples');
const arabicSample = fs.readFileSync(path.join(samplesDir, 'sample-ar.md'), 'utf8');
const englishSample = fs.readFileSync(path.join(samplesDir, 'sample-en.md'), 'utf8');

const MODES: TashkeelMode[] = ['full', 'none', 'shadda-tanween'];

const SHADDA = '\u0651';
const TANWEEN = ['\u064B', '\u064C', '\u064D'] as const;
const HARAKAT = ['\u064E', '\u064F', '\u0650', '\u0652'] as const;

function countChar(text: string, code: string): number {
  let count = 0;
  for (const ch of text) if (ch === code) count++;
  return count;
}

function countMarks(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (isTashkeelMark(text.charCodeAt(i))) count++;
  return count;
}

/** Every character that is not a diacritic, in order — i.e. the letters themselves. */
function lettersOnly(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (!isTashkeelMark(text.charCodeAt(i))) out += text[i];
  }
  return out;
}

/** A paragraph that really carries tashkeel, taken from the project's own sample. */
function findMashkoolParagraph(): string {
  const paragraph = arabicSample
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 120 && /[\u064B-\u0652]/.test(line));
  expect(paragraph, 'samples/sample-ar.md must contain a fully vocalised paragraph').toBeTruthy();
  return paragraph!;
}

describe('F18 — tashkeel modes on the project samples', () => {
  it('keeps the sample honest: it is a real vocalised Arabic text', () => {
    expect(countMarks(arabicSample)).toBeGreaterThan(500);
    expect(countChar(arabicSample, SHADDA)).toBeGreaterThan(20);
    for (const tanween of TANWEEN) {
      expect(countChar(arabicSample, tanween), `sample should exercise ${tanween}`).toBeGreaterThan(0);
    }
  });

  it('«كامل» is the identity — the file text is never rewritten', () => {
    for (const sample of [arabicSample, englishSample, findMashkoolParagraph()]) {
      expect(stripTashkeel(sample, 'full')).toBe(sample);
    }
  });

  it('«بدون» drops every haraka/shadda/tanween and keeps every base letter', () => {
    const paragraph = findMashkoolParagraph();
    const stripped = stripTashkeel(paragraph, 'none');

    expect(stripped.length).toBeLessThan(paragraph.length);
    expect(countMarks(stripped)).toBe(0);
    // The letters themselves are untouched: same sequence, same order, same count.
    expect(lettersOnly(stripped)).toBe(lettersOnly(paragraph));
    expect(lettersOnly(paragraph).length).toBeGreaterThan(60);

    // Same over the whole sample, and the mode is idempotent.
    const sampleNone = stripTashkeel(arabicSample, 'none');
    expect(countMarks(sampleNone)).toBe(0);
    expect(lettersOnly(sampleNone)).toBe(lettersOnly(arabicSample));
    expect(stripTashkeel(sampleNone, 'none')).toBe(sampleNone);
  });

  it('«شدّة وتنوين بس» keeps shadda + tanween and drops fatha/damma/kasra/sukun', () => {
    const paragraph = findMashkoolParagraph();
    const intermediate = stripTashkeel(paragraph, 'shadda-tanween');

    for (const mark of HARAKAT) {
      expect(countChar(intermediate, mark), `haraka ${mark} must be hidden`).toBe(0);
    }
    expect(countChar(intermediate, SHADDA)).toBe(countChar(paragraph, SHADDA));
    expect(countChar(intermediate, SHADDA)).toBeGreaterThan(0);
    for (const tanween of TANWEEN) {
      expect(countChar(intermediate, tanween)).toBe(countChar(paragraph, tanween));
    }
    expect(lettersOnly(intermediate)).toBe(lettersOnly(paragraph));

    // It sits exactly between the two other modes: dropping the kept marks gives «بدون».
    const keptMarks = new RegExp(`[${SHADDA}${TANWEEN.join('')}]`, 'g');
    expect(intermediate.replace(keptMarks, '')).toBe(stripTashkeel(paragraph, 'none'));
    expect(intermediate.length).toBeLessThan(paragraph.length);
    expect(intermediate.length).toBeGreaterThan(stripTashkeel(paragraph, 'none').length);
  });

  it('never touches non-Arabic text', () => {
    for (const mode of MODES) {
      expect(stripTashkeel(englishSample, mode)).toBe(englishSample);
    }
    // Latin punctuation, Greek, digits and emoji pass through all three modes unchanged.
    const mixed = 'Chapter 1 — ٢٠٢٦ · (٪) 🙂';
    for (const mode of MODES) {
      expect(stripTashkeel(mixed, mode)).toBe(mixed);
    }
  });

  it('exposes the mark predicate the UI and the tests share', () => {
    expect(isTashkeelMark(0x064e)).toBe(true); // fatha
    expect(isTashkeelMark(0x0651)).toBe(true); // shadda
    expect(isTashkeelMark(0x0640)).toBe(false); // tatweel is a letter, not a diacritic
    expect(isTashkeelMark(0x0627)).toBe(false); // alef

    expect(isHiddenMark(0x0651, 'shadda-tanween')).toBe(false);
    expect(isHiddenMark(0x064b, 'shadda-tanween')).toBe(false);
    expect(isHiddenMark(0x064e, 'shadda-tanween')).toBe(true);
    expect(isHiddenMark(0x0651, 'none')).toBe(true);
    expect(isHiddenMark(0x0651, 'full')).toBe(false);
  });

  it('maps display offsets back to original-text offsets (the anchor contract)', () => {
    const paragraph = findMashkoolParagraph();

    for (const mode of ['none', 'shadda-tanween'] as const) {
      const display = stripTashkeel(paragraph, mode);
      expect(display.length).toBeLessThan(paragraph.length);

      for (let displayOffset = 0; displayOffset < display.length; displayOffset++) {
        const original = originalOffsetForDisplayOffset(paragraph, displayOffset, mode);
        // The original offset points at the character that produced this displayed one:
        // everything up to and including it collapses to exactly `displayOffset + 1` chars.
        expect(
          stripTashkeel(paragraph.slice(0, original + 1), mode).length,
          `${mode} display offset ${displayOffset}`,
        ).toBe(displayOffset + 1);
        // …and converting the other way is an exact round trip on display offsets.
        expect(displayOffsetForOriginalOffset(paragraph, original, mode)).toBe(displayOffset);
      }

      // Past the end both directions clamp instead of inventing an offset.
      expect(originalOffsetForDisplayOffset(paragraph, display.length, mode)).toBe(paragraph.length);
      expect(originalOffsetForDisplayOffset(paragraph, -5, mode)).toBe(0);
      expect(displayOffsetForOriginalOffset(paragraph, paragraph.length + 10, mode)).toBe(
        display.length,
      );
    }

    // «كامل» is the identity mapping, so anchors written before F18 stay valid.
    expect(originalOffsetForDisplayOffset(paragraph, 42, 'full')).toBe(42);
    expect(displayOffsetForOriginalOffset(paragraph, 42, 'full')).toBe(42);
  });
});

// --- F18 review: the round trip has to survive the hard clusters, not just the easy ones -----

const TATWEEL = '\u0640';
const SUPERSCRIPT_ALEF = '\u0670';
const FATHA = '\u064E';

/** ب + shadda + fatha — the canonical order of two marks on one letter. */
const SHADDA_THEN_FATHA = '\u0628\u0651\u064E';
/** ب + fatha + shadda — the same cluster with the marks in the opposite order. */
const FATHA_THEN_SHADDA = '\u0628\u064E\u0651';

function countHidden(text: string, mode: TashkeelMode): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (isHiddenMark(text.charCodeAt(i), mode)) count++;
  return count;
}

/**
 * The anchor contract, exhaustively: for `mode`, every display offset must map back to an
 * original offset that (a) is never inside a hidden mark, (b) maps forward to the same
 * display offset, and (c) sits exactly at the prefix boundary the displayed text shows.
 * The other direction must be idempotent and land on a visible base character.
 *
 * This is the property the reader relies on when it reports a position (display → original)
 * and when it restores one (original → display) after a mode switch.
 */
function expectStableMapping(original: string, mode: TashkeelMode, label: string): void {
  const where = `${label} [${mode}]`;
  const display = stripTashkeel(original, mode);

  expect(display.length, `${where} display length`).toBe(original.length - countHidden(original, mode));

  // display -> original -> display: the identity on every reachable display offset.
  for (let displayOffset = 0; displayOffset <= display.length; displayOffset++) {
    const originalOffset = originalOffsetForDisplayOffset(original, displayOffset, mode);
    expect(originalOffset, `${where} display offset ${displayOffset} out of range`).toBeGreaterThanOrEqual(0);
    expect(originalOffset, `${where} display offset ${displayOffset} out of range`).toBeLessThanOrEqual(
      original.length,
    );

    if (displayOffset === display.length) {
      expect(originalOffset, `${where} end must clamp to the original end`).toBe(original.length);
    } else {
      // It must land on a real character, never inside a cluster of hidden marks…
      expect(
        isHiddenMark(original.charCodeAt(originalOffset), mode),
        `${where} display offset ${displayOffset} landed on hidden mark at original ${originalOffset}`,
      ).toBe(false);
      // …and it must be the very character that produced this displayed one.
      expect(original[originalOffset], `${where} display offset ${displayOffset} base char`).toBe(
        display[displayOffset],
      );
    }

    expect(
      displayOffsetForOriginalOffset(original, originalOffset, mode),
      `${where} display offset ${displayOffset} must round-trip`,
    ).toBe(displayOffset);
  }

  // original -> display -> original: idempotent, never on a hidden mark, prefix length exact.
  for (let originalOffset = 0; originalOffset <= original.length; originalOffset++) {
    const displayOffset = displayOffsetForOriginalOffset(original, originalOffset, mode);
    expect(displayOffset, `${where} original offset ${originalOffset} out of range`).toBeGreaterThanOrEqual(0);
    expect(displayOffset, `${where} original offset ${originalOffset} out of range`).toBeLessThanOrEqual(
      display.length,
    );

    const back = originalOffsetForDisplayOffset(original, displayOffset, mode);
    if (back < original.length) {
      expect(
        isHiddenMark(original.charCodeAt(back), mode),
        `${where} original offset ${originalOffset} back-mapped onto hidden mark at ${back}`,
      ).toBe(false);
    }
    expect(
      displayOffsetForOriginalOffset(original, back, mode),
      `${where} original offset ${originalOffset} must be idempotent`,
    ).toBe(displayOffset);
    // The anchor contract: the displayed length of the original prefix IS the display offset.
    expect(
      stripTashkeel(original.slice(0, back), mode).length,
      `${where} original offset ${originalOffset} prefix boundary`,
    ).toBe(displayOffset);
  }
}

describe('F18 — offset round-trip on the hard cases', () => {
  it('covers the offset BETWEEN shadda and fatha, in both mark orders', () => {
    for (const [label, text] of [
      ['shadda then fatha', SHADDA_THEN_FATHA],
      ['fatha then shadda', FATHA_THEN_SHADDA],
    ] as const) {
      expect(text.length, `${label} must be letter + two marks`).toBe(3);
      expect(countMarks(text), `${label} must carry two marks`).toBe(2);

      for (const mode of MODES) {
        expectStableMapping(text, mode, `single cluster, ${label}`);
      }

      // «بدون»: the letter survives, the whole cluster collapses to one display character.
      expect(stripTashkeel(text, 'none')).toBe('\u0628');
      expect(displayOffsetForOriginalOffset(text, 0, 'none')).toBe(0);
      // The offset between the two marks (1 in this order at the boundary after the first
      // mark, 2 after the second) is a real original offset and must map consistently…
      for (const between of [1, 2]) {
        expect(displayOffsetForOriginalOffset(text, between, 'none')).toBe(1);
      }
      // …while the reverse never invents a position inside the hidden pair.
      expect(originalOffsetForDisplayOffset(text, 0, 'none')).toBe(0);
      expect(originalOffsetForDisplayOffset(text, 1, 'none')).toBe(text.length);

      // «شدّة وتنوين بس»: shadda stays, fatha goes. The between-marks offset is different
      // now, and the reverse mapping must land on the shadda, never on the fatha.
      expect(stripTashkeel(text, 'shadda-tanween').length).toBe(2);
      const shaddaIndex = text.indexOf(SHADDA);
      expect(originalOffsetForDisplayOffset(text, 1, 'shadda-tanween')).toBe(shaddaIndex);
      expect(originalOffsetForDisplayOffset(text, 2, 'shadda-tanween')).toBe(text.length);
      expect(displayOffsetForOriginalOffset(text, shaddaIndex, 'shadda-tanween')).toBe(1);

      // «كامل» keeps every mark: the identity, including the between-marks offsets.
      for (let offset = 0; offset <= text.length; offset++) {
        expect(displayOffsetForOriginalOffset(text, offset, 'full')).toBe(offset);
        expect(originalOffsetForDisplayOffset(text, offset, 'full')).toBe(offset);
      }
    }
  });

  it('covers mixed Arabic + English inside the same block, on every offset', () => {
    const mixed = 'قَالَ Sohail (سُهَيْل): "Hello, world!" — ثُمَّ عَادَ إِلَى الْبَيْتِ 42 مرة.';
    expect(/[A-Za-z]/.test(mixed)).toBe(true);
    expect(countMarks(mixed)).toBeGreaterThan(8);

    for (const mode of MODES) {
      expectStableMapping(mixed, mode, 'mixed Arabic/English block');

      const displayed = stripTashkeel(mixed, mode);
      // Latin runs, digits and the Latin punctuation survive every mode verbatim.
      expect(displayed).toContain('Sohail');
      expect(displayed).toContain('"Hello, world!"');
      expect(displayed).toContain('42');
      expect(displayed).toContain('—');
      // The mapping does not shift the Latin text around the Arabic clusters.
      const latinStart = mixed.indexOf('Sohail');
      const latinDisplayStart = displayed.indexOf('Sohail');
      expect(displayOffsetForOriginalOffset(mixed, latinStart, mode)).toBe(latinDisplayStart);
      expect(originalOffsetForDisplayOffset(mixed, latinDisplayStart, mode)).toBe(latinStart);
    }
  });

  it('covers tatweel (U+0640), which is a letter and must never be treated as a mark', () => {
    const text = `كُ${TATWEEL}${TATWEEL}${TATWEEL}تُبٌ مَ${TATWEEL}${TATWEEL}دْرَسِيَّةٌ`;
    expect(countChar(text, TATWEEL), 'the fixture must contain tatweel').toBe(5);
    // Tatweel is not a diacritic: it is kept by every mode, and «بدون» still keeps all of it.
    expect(isTashkeelMark(TATWEEL.charCodeAt(0))).toBe(false);
    expect(countChar(stripTashkeel(text, 'none'), TATWEEL)).toBe(5);
    expect(countChar(stripTashkeel(text, 'shadda-tanween'), TATWEEL)).toBe(5);

    for (const mode of MODES) {
      expectStableMapping(text, mode, 'tatweel');
    }
  });

  it('covers U+0670 (superscript alef), which «شدّة وتنوين بس» hides', () => {
    const text = `ه${SUPERSCRIPT_ALEF}ذَا الرَّحْم${SUPERSCRIPT_ALEF}نُ وَه${SUPERSCRIPT_ALEF}ذِهِ`;
    expect(countChar(text, SUPERSCRIPT_ALEF), 'the fixture must contain U+0670').toBe(3);
    expect(isTashkeelMark(SUPERSCRIPT_ALEF.charCodeAt(0))).toBe(true);
    expect(isHiddenMark(SUPERSCRIPT_ALEF.charCodeAt(0), 'shadda-tanween')).toBe(true);

    expect(countChar(stripTashkeel(text, 'none'), SUPERSCRIPT_ALEF)).toBe(0);
    expect(countChar(stripTashkeel(text, 'shadda-tanween'), SUPERSCRIPT_ALEF)).toBe(0);
    expect(countChar(stripTashkeel(text, 'full'), SUPERSCRIPT_ALEF)).toBe(3);

    for (const mode of MODES) {
      expectStableMapping(text, mode, 'superscript alef');
    }
  });

  it('covers a real vocalised paragraph and a block with every mark class together', () => {
    const kitchenSink =
      `${SHADDA_THEN_FATHA} ${FATHA_THEN_SHADDA} ` +
      `ه${SUPERSCRIPT_ALEF}ذَا ` +
      `كُ${TATWEEL}تُبٌ ` +
      `Mixed English 2026 — ` +
      findMashkoolParagraph();

    expect(countMarks(kitchenSink)).toBeGreaterThan(50);

    for (const mode of MODES) {
      expectStableMapping(kitchenSink, mode, 'kitchen sink block');
      expectStableMapping(findMashkoolParagraph(), mode, 'sample paragraph');
    }
  });
});
