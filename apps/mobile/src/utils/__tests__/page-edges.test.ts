import {
  PAGE_EDGE_MAX_PX,
  PAGE_EDGE_MIN_PX,
  formatPageEdgeLabel,
  pageEdgeLayout,
} from '@/utils/page-edges';

describe('page-edge thickness (F25)', () => {
  it('starts unread (2 px) on the right in RTL and grows to 6 px as the book is read', () => {
    const start = pageEdgeLayout(0, 10, 'rtl')!;
    expect(start.readWidth).toBe(PAGE_EDGE_MIN_PX);
    expect(start.remainingWidth).toBe(PAGE_EDGE_MAX_PX);
    expect(start.readSide).toBe('right');
    expect(start.remainingSide).toBe('left');

    const middle = pageEdgeLayout(0.5, 10, 'rtl')!;
    expect(middle.readWidth).toBeCloseTo(4, 5);
    expect(middle.remainingWidth).toBeCloseTo(4, 5);

    const end = pageEdgeLayout(1, 10, 'rtl')!;
    expect(end.readWidth).toBe(PAGE_EDGE_MAX_PX);
    expect(end.remainingWidth).toBe(PAGE_EDGE_MIN_PX);
  });

  it('mirrors both edges for an LTR book', () => {
    const start = pageEdgeLayout(0, 10, 'ltr')!;
    expect(start.readSide).toBe('left');
    expect(start.remainingSide).toBe('right');
    // The numbers themselves are direction-free: only the physical sides move.
    expect(start.readWidth).toBe(PAGE_EDGE_MIN_PX);
    expect(start.remainingWidth).toBe(PAGE_EDGE_MAX_PX);
  });

  it('clamps a wild ratio into the 2..6 px band', () => {
    expect(pageEdgeLayout(5, 10, 'rtl')!.readWidth).toBe(PAGE_EDGE_MAX_PX);
    expect(pageEdgeLayout(-5, 10, 'rtl')!.readWidth).toBe(PAGE_EDGE_MIN_PX);
    expect(pageEdgeLayout(Number.NaN, 10, 'rtl')!.readWidth).toBe(PAGE_EDGE_MIN_PX);
  });

  it('paints nothing before the book is measured, and stays honest on a single page', () => {
    expect(pageEdgeLayout(0.4, 0, 'rtl')).toBeNull();
    expect(pageEdgeLayout(0.4, Number.NaN, 'rtl')).toBeNull();

    // One page has no progress to show: it must not claim the whole book was read.
    const single = pageEdgeLayout(1, 1, 'rtl')!;
    expect(single.readWidth).toBe(PAGE_EDGE_MIN_PX);
    expect(single.remainingWidth).toBe(PAGE_EDGE_MAX_PX);
  });

  it('formats the one-decimal label the device journey reads', () => {
    expect(formatPageEdgeLabel('read', 2)).toBe('سمك المقروء 2.0 بيكسل');
    expect(formatPageEdgeLabel('read', 4.444)).toBe('سمك المقروء 4.4 بيكسل');
    expect(formatPageEdgeLabel('remaining', 2.86)).toBe('سمك المتبقي 2.9 بيكسل');
  });
});
