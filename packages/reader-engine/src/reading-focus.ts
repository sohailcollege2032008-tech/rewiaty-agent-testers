/**
 * F33 — مسطرة القراية ووضع التركيز.
 *
 * Two reading aids share one geometric rule, and this module keeps that rule pure and testable:
 *
 * > The reading line is a single horizontal line **40% down the text area** of the visible page
 * > (in scroll mode: 40% down the viewport). The current paragraph is the one that line passes
 * > through. When the line lands in the gutter between two paragraphs, the nearest one wins.
 *
 * `paragraph` mode paints that paragraph in full ink and hands every other paragraph on the page
 * the theme's `muted` token (which is readable by design — see the contrast test). `ruler` mode
 * draws a thin pass-through line at the same height and leaves the text untouched. `off` does
 * nothing at all, which is the default.
 */

export type ReadingFocusMode = 'off' | 'paragraph' | 'ruler';

export const READING_FOCUS_MODES: readonly ReadingFocusMode[] = ['off', 'paragraph', 'ruler'];

/** Where the reading line sits inside the text area (0..1). */
export const READING_FOCUS_ANCHOR_RATIO = 0.4;

/**
 * The bridged description of what the engine is currently focusing.
 *
 * Sent to the host whenever the mode or the focused paragraph changes, so the settings sheet can
 * show «الفقرة المضيئة ٢ من ١١» and a Maestro journey can prove the engine really re-evaluated
 * the page instead of trusting a stored toggle.
 */
export type ReadingFocusReport = {
  mode: ReadingFocusMode;
  /** Block id of the current paragraph, or `null` when the page has no paragraph to focus. */
  currentBlockId: string | null;
  /** 1-based index of the current paragraph on the visible page, or `null`. */
  currentIndex: number | null;
  /** How many paragraphs the visible page/line band had to choose from. */
  blockCount: number;
  /** Viewport Y of the reading line, in CSS pixels. */
  anchorY: number;
  anchorRatio: number;
};

export type FocusBlockBox = {
  top: number;
  bottom: number;
};

/**
 * A stored or partial value maps to exactly one mode. Anything this build does not know — a
 * mangled string from an old build, a number, an object — reads as `off` instead of being
 * coerced into a truthy mode that would suddenly dim the reader's page.
 */
export function normalizeReadingFocusMode(value: unknown): ReadingFocusMode {
  return value === 'paragraph' || value === 'ruler' ? value : 'off';
}

/**
 * The paragraph the reading line passes through.
 *
 * `boxes` are the visible paragraphs in reading order. A box that contains `anchorY` wins
 * immediately. Otherwise the box whose interval is closest to the line wins, with the earlier
 * paragraph breaking a tie to match reading order. Returns `-1` when there is nothing to focus.
 */
export function pickFocusBlockIndex(
  boxes: readonly FocusBlockBox[],
  anchorY: number,
): number {
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i]!;
    if (box.bottom <= box.top) continue;
    if (anchorY >= box.top && anchorY <= box.bottom) return i;

    const distance = anchorY < box.top ? box.top - anchorY : anchorY - box.bottom;
    if (distance < nearestDistance - 0.0001) {
      nearest = i;
      nearestDistance = distance;
    }
  }

  return nearest;
}
