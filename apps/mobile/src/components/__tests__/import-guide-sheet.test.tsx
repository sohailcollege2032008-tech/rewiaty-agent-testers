import * as ReactNative from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { ImportGuideSheet } from '@/components/import-guide-sheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

type JsonNode = {
  props?: Record<string, unknown>;
  children?: Array<JsonNode | string> | null;
};

/** Flatten a rendered tree into an ordered list of testIDs and text leaves. */
function flattenTree(node: JsonNode | string | null | undefined): string[] {
  const out: string[] = [];
  const walk = (current: JsonNode | string | null | undefined) => {
    if (current == null) return;
    if (typeof current === 'string') {
      const trimmed = current.trim();
      if (trimmed) out.push(`text:${trimmed}`);
      return;
    }
    const testID = current.props?.testID;
    if (typeof testID === 'string') out.push(`id:${testID}`);
    (current.children ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

function effectiveTouchBox(node: { props: Record<string, unknown> }) {
  const flat =
    ReactNative.StyleSheet.flatten(
      node.props.style as ReactNative.StyleProp<ReactNative.ViewStyle>,
    ) ?? {};
  const slop = node.props.hitSlop as
    | number
    | { top?: number; bottom?: number; left?: number; right?: number }
    | undefined;
  const top = typeof slop === 'number' ? slop : (slop?.top ?? 0);
  const bottom = typeof slop === 'number' ? slop : (slop?.bottom ?? 0);
  const left = typeof slop === 'number' ? slop : (slop?.left ?? 0);
  const right = typeof slop === 'number' ? slop : (slop?.right ?? 0);
  const width = Number(flat.minWidth ?? flat.width ?? 0);
  const height = Number(flat.minHeight ?? flat.height ?? 0);
  return { width: width + left + right, height: height + top + bottom };
}

describe('ImportGuideSheet (#52 / #61)', () => {
  it('places the mobile pick button above the Telegram steps', async () => {
    const { toJSON, getByTestId } = await render(
      <ImportGuideSheet visible onPickFile={jest.fn()} onClose={jest.fn()} />,
    );

    expect(getByTestId('import-guide-pick-button')).toBeTruthy();

    const order = flattenTree(toJSON() as JsonNode);
    const pickIndex = order.indexOf('id:import-guide-pick-button');
    const firstStepIndex = order.indexOf('text:١. افتح الملف في تيليجرام');

    expect(pickIndex).toBeGreaterThanOrEqual(0);
    expect(firstStepIndex).toBeGreaterThanOrEqual(0);
    expect(pickIndex).toBeLessThan(firstStepIndex);
  });

  it('drops the English "Open with" copy and the bidi-flipping dotted extensions', async () => {
    const { queryByText, getAllByText } = await render(
      <ImportGuideSheet visible onPickFile={jest.fn()} onClose={jest.fn()} />,
    );

    expect(queryByText(/Open with/i)).toBeNull();
    expect(getAllByText(/فتح بواسطة/).length).toBeGreaterThan(0);
    // `.md` / `.txt` at a paren boundary render as `(txt.` in RTL.
    expect(queryByText(/\.md|\.txt/)).toBeNull();
  });

  it('gives the close button a real 48x48 target and calls onClose', async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <ImportGuideSheet visible onPickFile={jest.fn()} onClose={onClose} />,
    );

    const closeButton = getByTestId('import-guide-close-button');
    expect(closeButton.props.accessibilityLabel).toBe('إغلاق دليل الاستيراد');

    // The Pressable itself must be 48×48 (the visual circle inside may be smaller), so the target
    // never depends on a clipped hitSlop.
    const flat =
      ReactNative.StyleSheet.flatten(
        closeButton.props.style as ReactNative.StyleProp<ReactNative.ViewStyle>,
      ) ?? {};
    expect(Number(flat.width)).toBe(48);
    expect(Number(flat.height)).toBe(48);
    expect(closeButton.props.hitSlop).toBeUndefined();

    const box = effectiveTouchBox(closeButton);
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);

    await fireEvent.press(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives the mobile pick button a >= 48dp target', async () => {
    const { getByTestId } = await render(
      <ImportGuideSheet visible onPickFile={jest.fn()} onClose={jest.fn()} />,
    );

    const box = effectiveTouchBox(getByTestId('import-guide-pick-button'));
    expect(box.height).toBeGreaterThanOrEqual(48);
  });

  it('keeps the sheet content clear of the bottom navigation bar', async () => {
    const { getByTestId } = await render(
      <ImportGuideSheet visible onPickFile={jest.fn()} onClose={jest.fn()} />,
    );

    const panel = getByTestId('import-guide-sheet-panel');
    const flat =
      ReactNative.StyleSheet.flatten(
        panel.props.style as ReactNative.StyleProp<ReactNative.ViewStyle>,
      ) ?? {};
    // insets.bottom is mocked to 24 → Math.max(24, 20) + 16
    expect(flat.paddingBottom).toBe(40);
  });
});
