import { fireEvent, render } from '@testing-library/react-native';

import { ReaderSettingsSheet } from '@/components/reader-settings-sheet';
import { DEFAULT_SETTINGS } from '@/storage/settings-store';

/**
 * F33 — the reader's three-state focus control lives in the layout tab with Arabic names, and the
 * sheet shows what the engine actually reported (which paragraph is on the reading line), so the
 * setting is never a leap of faith.
 */
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 48, left: 0, right: 0 }),
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { ScrollView, View } = require('react-native');

  const MockBottomSheet = React.forwardRef(
    (props: { children?: React.ReactNode; [key: string]: unknown }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        snapToIndex: jest.fn(),
        close: jest.fn(),
      }));
      if (props.index === -1) return null;
      return React.createElement(
        View,
        { testID: 'mock-settings-bottom-sheet', ...props },
        props.children,
      );
    },
  );

  return {
    __esModule: true,
    default: MockBottomSheet,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: View,
  };
});

async function renderSheet(
  overrides: Partial<React.ComponentProps<typeof ReaderSettingsSheet>> = {},
) {
  const onChange = jest.fn();
  const view = await render(
    <ReaderSettingsSheet
      visible
      settings={DEFAULT_SETTINGS}
      onChange={onChange}
      onClose={() => {}}
      {...overrides}
    />,
  );
  // The sheet opens on the font tab; the focus control lives in «تنسيق الصفحة».
  await fireEvent.press(view.getByTestId('settings-tab-layout'));
  return { onChange, ...view };
}

describe('F33 reading focus settings', () => {
  it('offers exactly three Arabic choices and starts on «إيقاف»', async () => {
    const { getByText, getByTestId } = await renderSheet();

    expect(getByText('تركيز القراءة')).toBeTruthy();
    expect(getByText('إيقاف')).toBeTruthy();
    expect(getByText('تركيز الفقرة')).toBeTruthy();
    expect(getByText('مسطرة التتبع')).toBeTruthy();

    expect(getByTestId('settings-reading-focus-off').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('sends the chosen mode to the reader (paragraph then ruler)', async () => {
    const { onChange, getByTestId } = await renderSheet();

    await fireEvent.press(getByTestId('settings-reading-focus-paragraph'));
    expect(onChange).toHaveBeenCalledWith({ readingFocus: 'paragraph' });

    await fireEvent.press(getByTestId('settings-reading-focus-ruler'));
    expect(onChange).toHaveBeenCalledWith({ readingFocus: 'ruler' });
  });

  it('marks the stored mode as the selected one when the sheet reopens', async () => {
    const { getByTestId } = await renderSheet({
      settings: { ...DEFAULT_SETTINGS, readingFocus: 'ruler' },
    });

    expect(getByTestId('settings-reading-focus-ruler').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByTestId('settings-reading-focus-off').props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('reports what the engine focused in paragraph mode', async () => {
    const view = await render(
      <ReaderSettingsSheet
        visible
        settings={{ ...DEFAULT_SETTINGS, readingFocus: 'paragraph' }}
        onChange={jest.fn()}
        onClose={() => {}}
        readingFocusStatus={{ mode: 'paragraph', currentIndex: 2, blockCount: 11 }}
      />,
    );
    await fireEvent.press(view.getByTestId('settings-tab-layout'));
    expect(view.getByTestId('reading-focus-engine-status')).toBeTruthy();
    expect(view.getByText('الفقرة المضيئة ٢ من ١١')).toBeTruthy();
  });

  it('reports what the engine focused in ruler mode', async () => {
    const view = await render(
      <ReaderSettingsSheet
        visible
        settings={{ ...DEFAULT_SETTINGS, readingFocus: 'ruler' }}
        onChange={jest.fn()}
        onClose={() => {}}
        readingFocusStatus={{ mode: 'ruler', currentIndex: 5, blockCount: 9 }}
      />,
    );
    await fireEvent.press(view.getByTestId('settings-tab-layout'));
    expect(view.getByText('خط التتبع · الفقرة ٥ من ٩')).toBeTruthy();
  });

  it('hides the engine line completely when the focus is off', async () => {
    const { queryByTestId } = await renderSheet({
      settings: { ...DEFAULT_SETTINGS, readingFocus: 'off' },
      readingFocusStatus: { mode: 'off', currentIndex: null, blockCount: 0 },
    });
    expect(queryByTestId('reading-focus-engine-status')).toBeNull();
  });
});
