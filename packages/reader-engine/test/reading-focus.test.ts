import { describe, expect, it } from 'vitest';
import {
  READING_FOCUS_ANCHOR_RATIO,
  READING_FOCUS_MODES,
  normalizeReadingFocusMode,
  pickFocusBlockIndex,
} from '../src/reading-focus.js';
import { DEFAULT_SETTINGS, THEMES, contrastRatio } from '../src/types.js';

/**
 * F33 — وضع التركيز ومسطرة التتبع: منطق اختيار الفقرة الحالية.
 *
 * The engine paints the reading focus from two pure decisions, so both are tested here without
 * a browser:
 *  1. A stored/partial value maps to exactly one of the three modes — anything unknown is «إيقاف»,
 *     never a coerced truthy mode. The default is «إيقاف»: a reader who never asked for it keeps
 *     the page exactly as it was.
 *  2. The current paragraph is the one the reading line (40% down the text area) passes through.
 *     When the line falls in the gap between two paragraphs the nearest one wins, so a page never
 *     loses its highlight.
 *
 * Bayanat: «الباقي باهت مع الحفاظ على قابلية القراءة» — for every preset theme the dimmed ink is
 * the theme's own `muted` token, which this test proves clears WCAG AA (4.5:1) on that theme's
 * paper. That is what keeps the non-current paragraphs readable instead of washed out.
 */

describe('F33 reading focus — mode', () => {
  it('defaults to off so a reader who never asked for it sees the plain page', () => {
    expect(DEFAULT_SETTINGS.readingFocus).toBe('off');
    expect(READING_FOCUS_MODES).toEqual(['off', 'paragraph', 'ruler']);
  });

  it('maps every stored value to exactly one mode and drops anything unknown to off', () => {
    expect(normalizeReadingFocusMode('off')).toBe('off');
    expect(normalizeReadingFocusMode('paragraph')).toBe('paragraph');
    expect(normalizeReadingFocusMode('ruler')).toBe('ruler');
    expect(normalizeReadingFocusMode(undefined)).toBe('off');
    expect(normalizeReadingFocusMode(null)).toBe('off');
    expect(normalizeReadingFocusMode('')).toBe('off');
    expect(normalizeReadingFocusMode('yes')).toBe('off');
    expect(normalizeReadingFocusMode(1)).toBe('off');
    expect(normalizeReadingFocusMode({ mode: 'ruler' })).toBe('off');
  });

  it('keeps the reading line inside the text area', () => {
    expect(READING_FOCUS_ANCHOR_RATIO).toBeGreaterThan(0.25);
    expect(READING_FOCUS_ANCHOR_RATIO).toBeLessThan(0.6);
  });
});

describe('F33 reading focus — which paragraph is current', () => {
  const boxes = [
    { top: 100, bottom: 180 },
    { top: 190, bottom: 300 },
    { top: 310, bottom: 400 },
  ];

  it('picks the paragraph the line passes through', () => {
    expect(pickFocusBlockIndex(boxes, 100)).toBe(0);
    expect(pickFocusBlockIndex(boxes, 240)).toBe(1);
    expect(pickFocusBlockIndex(boxes, 399)).toBe(2);
  });

  it('picks the nearest paragraph when the line lands in a gap', () => {
    // 6px below box 0 / 4px above box 1 → box 1 is closer.
    expect(pickFocusBlockIndex(boxes, 186)).toBe(1);
    // 5px below box 1 / 5px above box 2 → the earlier paragraph wins the tie (reading order).
    expect(pickFocusBlockIndex(boxes, 305)).toBe(1);
  });

  it('clamps above the first and below the last paragraph', () => {
    expect(pickFocusBlockIndex(boxes, -50)).toBe(0);
    expect(pickFocusBlockIndex(boxes, 9999)).toBe(2);
  });

  it('returns -1 when the page has no paragraph to focus', () => {
    expect(pickFocusBlockIndex([], 200)).toBe(-1);
    // Zero-height boxes are not readable paragraphs.
    expect(pickFocusBlockIndex([{ top: 200, bottom: 200 }], 200)).toBe(-1);
  });
});

describe('F33 reading focus — dimmed ink stays readable', () => {
  it('every preset theme has a muted ink that clears WCAG AA on its own paper', () => {
    for (const [id, tokens] of Object.entries(THEMES)) {
      const ratio = contrastRatio(tokens.muted, tokens.bg);
      expect(ratio, `${id} muted contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the muted ink is visibly dimmer than the body ink on the default page', () => {
    const warraq = THEMES.warraq;
    expect(contrastRatio(warraq.muted, warraq.bg)).toBeLessThan(
      contrastRatio(warraq.text, warraq.bg),
    );
  });
});
