import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { HighlightToolbar } from '@/components/highlight-toolbar';
import { HIGHLIGHT_COLORS } from '@/types/reader';

/**
 * P2 a11y (QA r1) — Issue #49.
 *
 * The toolbar's controls were 40×40 with no `hitSlop` and only 2dp between swatches, so the
 * effective targets were 40dp (Android's minimum is 48dp) and adjacent swatch targets merged.
 * These tests pin the budget from the component's own styles: every interactive control must
 * expose at least 48×48dp of tappable area, neighbouring targets must not overlap, and the
 * pill must still fit a 360dp screen without spilling past the 12dp page gutter.
 */

const VIEWPORT_WIDTH = 360;
/** Page gutter the positioner keeps on both sides (`maxLeft = containerWidth - width - 12`). */
const GUTTER = 12;

type AnyProps = Record<string, unknown>;

function flatStyle(node: { props: AnyProps }): Record<string, unknown> {
  return StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;
}

function hitSlopBox(value: unknown): { horizontal: number; vertical: number } {
  if (typeof value === 'number') return { horizontal: value * 2, vertical: value * 2 };
  if (value && typeof value === 'object') {
    const slop = value as { left?: number; right?: number; top?: number; bottom?: number };
    return {
      horizontal: (slop.left ?? 0) + (slop.right ?? 0),
      vertical: (slop.top ?? 0) + (slop.bottom ?? 0),
    };
  }
  return { horizontal: 0, vertical: 0 };
}

function effectiveSize(node: { props: AnyProps }): { width: number; height: number } {
  const style = flatStyle(node);
  const slop = hitSlopBox(node.props.hitSlop);
  const width =
    (typeof style.width === 'number' ? style.width : typeof style.minWidth === 'number' ? style.minWidth : 0) +
    slop.horizontal;
  const height =
    (typeof style.height === 'number' ? style.height : typeof style.minHeight === 'number' ? style.minHeight : 0) +
    slop.vertical;
  return { width, height };
}

async function renderToolbar(isEditing: boolean) {
  return render(
    <HighlightToolbar
      visible
      rect={{ left: 100, top: 300, right: 220, bottom: 330, width: 120, height: 30 }}
      containerWidth={VIEWPORT_WIDTH}
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

describe('HighlightToolbar accessibility touch targets (Issue #49)', () => {
  it('gives every colour swatch a ≥ 48×48dp target with no overlapping neighbours', async () => {
    const { getByTestId } = await renderToolbar(false);
    const colorsRow = flatStyle(getByTestId('highlight-toolbar-colors'));

    // Distinct physical targets: 40dp visible + 4dp hitSlop on each side, 8dp apart.
    for (const item of HIGHLIGHT_COLORS) {
      const swatch = getByTestId(`highlight-color-${item.id}`);
      const size = effectiveSize(swatch);
      expect(size.width).toBeGreaterThanOrEqual(48);
      expect(size.height).toBeGreaterThanOrEqual(48);
    }

    const gold = flatStyle(getByTestId('highlight-color-gold'));
    const sage = flatStyle(getByTestId('highlight-color-sage'));
    const goldSlop = hitSlopBox(getByTestId('highlight-color-gold').props.hitSlop).horizontal;
    const gap = (colorsRow.gap as number | undefined) ?? 0;
    expect(gap).toBeGreaterThanOrEqual(4);
    // Adjacent targets may touch exactly, never overlap: visual pitch ≥ effective width.
    const pitch = (gold.width as number) + gap;
    expect(pitch).toBeGreaterThanOrEqual((gold.width as number) + goldSlop);
    expect(sage.width).toBe(gold.width);
  });

  it('gives the note and delete buttons ≥ 48×48dp targets', async () => {
    const { getByTestId } = await renderToolbar(true);

    const note = effectiveSize(getByTestId('highlight-note-button'));
    expect(note.width).toBeGreaterThanOrEqual(48);
    expect(note.height).toBeGreaterThanOrEqual(48);

    const del = effectiveSize(getByTestId('highlight-delete-button'));
    expect(del.width).toBeGreaterThanOrEqual(48);
    expect(del.height).toBeGreaterThanOrEqual(48);
  });

  it('fits the edited toolbar inside the 360dp viewport without spilling past the gutter', async () => {
    const { getByTestId } = await renderToolbar(true);
    const positioner = flatStyle(getByTestId('highlight-toolbar'));
    const left = positioner.left as number;
    const width = positioner.width as number;

    expect(width).toBeLessThanOrEqual(VIEWPORT_WIDTH - GUTTER * 2);
    expect(left).toBeGreaterThanOrEqual(GUTTER);
    expect(left + width).toBeLessThanOrEqual(VIEWPORT_WIDTH - GUTTER);
  });
});
