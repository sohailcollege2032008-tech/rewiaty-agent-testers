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
