/**
 * F25 — «سُمك الصفحات على الحواف».
 *
 * Two thin paper stacks sit on the left and right sides of the page. One is what the reader has
 * already read, the other is what is left; as the reader advances, the read stack thickens and the
 * remaining one thins. Both stay inside 2..6 logical px so they always read as paper edges and never
 * as a UI bar.
 *
 * Direction is physical, not logical: in an Arabic (RTL) book the pages that have been flipped over
 * accumulate on the RIGHT, so the read stack lives on the right and the remaining one on the left.
 * An LTR book is the exact mirror. Everything here is pure math — the screen only paints the result.
 */

/** Thinnest a stack can get, in logical px — the paper still has an edge. */
export const PAGE_EDGE_MIN_PX = 2;

/** Thickest a stack can get, in logical px — past this it stops reading as paper. */
export const PAGE_EDGE_MAX_PX = 6;

export type PageEdgeSide = 'left' | 'right';

export type PageEdgeLayout = {
  /** Thickness of the stack that represents what was already read (2..6 px). */
  readWidth: number;
  /** Thickness of the stack that represents what is still ahead (2..6 px). */
  remainingWidth: number;
  /** Physical side of the read stack: right in RTL, left in LTR. */
  readSide: PageEdgeSide;
  /** Physical side of the remaining stack: left in RTL, right in LTR. */
  remainingSide: PageEdgeSide;
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Widths and sides for the two page edges.
 *
 * Returns `null` while the engine has not measured the book yet (`pageCount <= 0`): a saved page
 * number is not real progress, and painting a fake stack during loading would lie to the reader.
 * A single-page book has no progress to show, so it keeps the honest floor: nothing read (2 px)
 * and everything remaining (6 px) — never a division by zero.
 */
export function pageEdgeLayout(
  progressRatio: number,
  pageCount: number,
  dir: 'rtl' | 'ltr',
): PageEdgeLayout | null {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return null;

  // A one-page book never advances: it must not report the whole book as read.
  const ratio = pageCount <= 1 ? 0 : clampRatio(progressRatio);
  const span = PAGE_EDGE_MAX_PX - PAGE_EDGE_MIN_PX;

  const readWidth = PAGE_EDGE_MIN_PX + ratio * span;
  const remainingWidth = PAGE_EDGE_MAX_PX - ratio * span;
  const isRtl = dir === 'rtl';

  return {
    readWidth,
    remainingWidth,
    readSide: isRtl ? 'right' : 'left',
    remainingSide: isRtl ? 'left' : 'right',
  };
}

/**
 * The one-decimal readout the edges carry as their accessibility label. The device journey
 * (`page-edges`) reads it, because Maestro cannot measure a view's width; a screen reader also
 * gets a meaningful description instead of two anonymous strips.
 */
export function formatPageEdgeLabel(kind: 'read' | 'remaining', width: number): string {
  const value = Math.max(PAGE_EDGE_MIN_PX, Math.min(PAGE_EDGE_MAX_PX, width)).toFixed(1);
  return kind === 'read' ? `سمك المقروء ${value} بيكسل` : `سمك المتبقي ${value} بيكسل`;
}
