import * as ReactNative from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { BookCard } from '@/components/book-card';
import type { BookLibraryRecord } from '@/types/reader';

const BOOK: BookLibraryRecord = {
  id: 'book_test_1',
  title: 'رواية تجريبية',
  author: 'كاتب تجريبي',
  dir: 'rtl',
  coverSeed: 'رواية تجريبية',
  coverColor: null,
  progress: 0.4,
  isBundled: false,
  lastOpenedAt: 2000,
  addedAt: 1000,
};

const BUNDLED_BOOK: BookLibraryRecord = {
  ...BOOK,
  id: 'book_bundled_1',
  title: 'الرواية المدمجة',
  isBundled: true,
};

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

type JsonNode = {
  props?: Record<string, unknown>;
  children?: Array<JsonNode | string> | null;
};

/** Find the node carrying `testID` and return every ancestor above it. */
function findAncestors(testID: string, node: JsonNode | string | null | undefined): JsonNode[] | null {
  if (node == null || typeof node === 'string') return null;
  if (node.props?.testID === testID) return [];
  for (const child of node.children ?? []) {
    const found = findAncestors(testID, child);
    if (found) return [node, ...found];
  }
  return null;
}

describe('BookCard delete affordance (#61, P2 #1/#3/#4)', () => {
  it('renders a labelled delete button that opens confirmation without breaking long-press', async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const onDelete = jest.fn();

    const { getByTestId } = await render(
      <BookCard
        book={BOOK}
        onPress={onPress}
        onLongPress={onLongPress}
        onDelete={onDelete}
      />,
    );

    const deleteButton = getByTestId(`book-delete-${BOOK.id}`);
    expect(deleteButton.props.accessibilityLabel).toBe(`حذف ${BOOK.title}`);
    expect(deleteButton.props.accessibilityRole).toBe('button');

    // The visible circle is 36dp; the real target must be 48×48 without leaning on a clipped slop.
    const flatDelete =
      ReactNative.StyleSheet.flatten(
        deleteButton.props.style as ReactNative.StyleProp<ReactNative.ViewStyle>,
      ) ?? {};
    expect(Number(flatDelete.width)).toBe(48);
    expect(Number(flatDelete.height)).toBe(48);
    const box = effectiveTouchBox(deleteButton);
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);

    await fireEvent.press(deleteButton);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(BOOK);
    expect(onPress).not.toHaveBeenCalled();

    // The Maestro long-press journey must keep working.
    await fireEvent(getByTestId(`book-card-${BOOK.id}`), 'longPress');
    expect(onLongPress).toHaveBeenCalledWith(BOOK);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps the delete button as a sibling of the open Pressable, never nested (P2 #3)', async () => {
    const { toJSON, getByTestId } = await render(
      <BookCard book={BOOK} onPress={jest.fn()} onLongPress={jest.fn()} onDelete={jest.fn()} />,
    );

    const ancestors = findAncestors(`book-delete-${BOOK.id}`, toJSON() as JsonNode);
    expect(ancestors).not.toBeNull();
    const ancestorTestIDs = (ancestors ?? []).map((node) => node.props?.testID);
    expect(ancestorTestIDs).not.toContain(`book-card-${BOOK.id}`);

    // Both are still rendered and independently labelled for VoiceOver/TalkBack.
    expect(getByTestId(`book-card-${BOOK.id}`).props.accessibilityRole).toBe('button');
    expect(getByTestId(`book-delete-${BOOK.id}`).props.accessibilityRole).toBe('button');
  });

  it('hides every delete affordance for a bundled book (P2 #1)', async () => {
    const onLongPress = jest.fn();
    const onDelete = jest.fn();

    const { getByTestId, queryByTestId } = await render(
      <BookCard
        book={BUNDLED_BOOK}
        onPress={jest.fn()}
        onLongPress={onLongPress}
        onDelete={onDelete}
      />,
    );

    expect(queryByTestId(`book-delete-${BUNDLED_BOOK.id}`)).toBeNull();
    expect(getByTestId(`book-card-${BUNDLED_BOOK.id}`).props.accessibilityHint).toBe(
      'افتح الكتاب',
    );
    // The long-press delete path is not wired for a bundled book either (library-screen asserts the
    // Alert stays closed; here the component simply receives no long-press callback).
    expect(getByTestId(`book-card-${BUNDLED_BOOK.id}`).props.onLongPress).toBeUndefined();

    await fireEvent.press(getByTestId(`book-card-${BUNDLED_BOOK.id}`));
    expect(onDelete).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
