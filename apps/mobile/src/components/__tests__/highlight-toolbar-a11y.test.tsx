import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { HighlightToolbar } from '@/components/highlight-toolbar';
import { HIGHLIGHT_COLORS } from '@/types/reader';

/**
 * P2 a11y (QA r1) — Issues #49 and #59.
 *
 * #49: the toolbar's controls were 40×40 and the extra reach was a `hitSlop` halo, so the
 * real boxes were below Android's 48dp minimum and neighbouring targets overlapped. Every
 * control now owns a real 48×48dp box; these tests read the component's own styles and must
 * NOT add `hitSlop` to pass.
 *
 * #59: the pill was positioned from a hard-coded width, so at 200% font scale (longer Arabic
 * label) the fourth, gold swatch was pushed off the right edge. The width is now measured by
 * `onLayout` and `left` is clamped against the measurement; the pill wraps instead of
 * clipping. The layout event is fired here to simulate that measurement.
 */

const VIEWPORT_WIDTH = 360;
/** Page gutter the positioner keeps on both sides. */
const GUTTER = 12;

type AnyProps = Record<string, unknown>;

function flatStyle(node: { props: AnyProps }): Record<string, unknown> {
  return StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
}

/** The control's own box — deliberately no `hitSlop` allowance. */
function actualSize(node: { props: AnyProps }): { width: number; height: number } {
  const style = flatStyle(node);
  const width =
    typeof style.width === 'number' ? style.width : typeof style.minWidth === 'number' ? style.minWidth : 0;
  const height =
    typeof style.height === 'number'
      ? style.height
      : typeof style.minHeight === 'number'
        ? style.minHeight
        : 0;
  return { width, height };
}

async function renderToolbar(
  options: {
    isEditing?: boolean;
    containerWidth?: number;
    rect?: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  } = {},
) {
  const { isEditing = false, containerWidth = VIEWPORT_WIDTH, rect } = options;
  return render(
    <HighlightToolbar
      visible
      rect={rect ?? { left: 100, top: 300, right: 220, bottom: 330, width: 120, height: 30 }}
      containerWidth={containerWidth}
      containerHeight={800}
      topInset={24}
      bottomInset={20}
      webviewOffsetTop={0}
      theme="burnt-paper"
      isEditing={isEditing}
      activeColor="gold"
      onSelectColor={jest.fn()}
      onPressNote={jest.fn()}
      onPressDelete={jest.fn()}
    />,
  );
}

/** Right edge of the pill after a measured layout, using the same clamp the component uses. */
function rightEdge(left: number, width: number): number {
  return left + Math.min(width, VIEWPORT_WIDTH - GUTTER * 2);
}

describe('HighlightToolbar accessibility touch targets (Issue #49)', () => {
  it('gives every colour swatch a real 48×48dp box (no hitSlop halo)', async () => {
    const { getByTestId } = await renderToolbar();
    const colorsRow = flatStyle(getByTestId('highlight-toolbar-colors'));

    for (const item of HIGHLIGHT_COLORS) {
      const swatch = getByTestId(`highlight-color-${item.id}`);
      const size = actualSize(swatch);
      expect(size.width).toBeGreaterThanOrEqual(48);
      expect(size.height).toBeGreaterThanOrEqual(48);
      // The target must be layout, not a padded reach over its neighbour.
      expect(swatch.props.hitSlop).toBeUndefined();
      // The coloured circle inside keeps its visual size and does not fill the target box.
      const dot = flatStyle(getByTestId(`highlight-color-dot-${item.id}`));
      expect(dot.width).toBeLessThanOrEqual(28);
      expect(dot.width).toBeGreaterThanOrEqual(26);
    }

    const gold = flatStyle(getByTestId('highlight-color-gold'));
    const gap = (colorsRow.gap as number | undefined) ?? 0;
    // Neighbouring 48dp boxes must not touch or overlap: the row keeps a real gap.
    expect(gap).toBeGreaterThanOrEqual(4);
    expect((gold.width as number) + gap).toBeGreaterThan(gold.width as number);
  });

  it('gives the note and delete buttons real 48×48dp boxes', async () => {
    const { getByTestId } = await renderToolbar({ isEditing: true });

    for (const testID of ['highlight-note-button', 'highlight-delete-button']) {
      const button = getByTestId(testID);
      const size = actualSize(button);
      expect(size.width).toBeGreaterThanOrEqual(48);
      expect(size.height).toBeGreaterThanOrEqual(48);
      expect(button.props.hitSlop).toBeUndefined();
    }
  });

  it('keeps the edited toolbar inside a 360dp screen without spilling past the gutter', async () => {
    const { getByTestId } = await renderToolbar({ isEditing: true });
    const positioner = flatStyle(getByTestId('highlight-toolbar'));
    const left = positioner.left as number;
    const maxWidth = positioner.maxWidth as number;

    expect(maxWidth).toBe(VIEWPORT_WIDTH - GUTTER * 2);
    expect(left).toBeGreaterThanOrEqual(GUTTER);
    // The edit pill is wider than the viewport: it is bounded by maxWidth and wraps.
    expect(left + Math.min(maxWidth, VIEWPORT_WIDTH - GUTTER * 2)).toBeLessThanOrEqual(
      VIEWPORT_WIDTH - GUTTER,
    );
    const pill = flatStyle(getByTestId('highlight-toolbar-pill'));
    expect(pill.flexWrap).toBe('wrap');
    expect(pill.maxWidth).toBe(VIEWPORT_WIDTH - GUTTER * 2);
  });

  it('clamps `left` from the measured width so a 200% font-scale pill stays on screen (Issue #59)', async () => {
    // The reader taps near the right edge of the page.
    const { getByTestId } = await renderToolbar({
      isEditing: true,
      rect: { left: 300, top: 320, right: 350, bottom: 350, width: 50, height: 30 },
    });

    const toolbar = getByTestId('highlight-toolbar');
    // `onLayout` reports the pill's real width: wider than the 372dp estimate and wrapping.
    await fireEvent(toolbar, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 336, height: 112 } },
    });

    const positioner = flatStyle(getByTestId('highlight-toolbar'));
    const left = positioner.left as number;
    expect(left).toBeGreaterThanOrEqual(GUTTER);
    expect(rightEdge(left, 336)).toBeLessThanOrEqual(VIEWPORT_WIDTH - GUTTER);

    const pill = flatStyle(getByTestId('highlight-toolbar-pill'));
    expect(pill.flexWrap).toBe('wrap');
  });
});
