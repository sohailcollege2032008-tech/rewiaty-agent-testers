import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ReaderSettingsSheet } from '@/components/reader-settings-sheet';
import { DEFAULT_SETTINGS } from '@/storage/settings-store';

/**
 * Android 3-button navigation on a release build (API 34, 1080×2400) draws an opaque nav bar
 * over the edge-to-edge window at the bottom ~126px. Before this fix the settings sheet's
 * scroll viewport reached the screen bottom, so «دفء الشاشة» and «السطوع» rendered UNDER the nav
 * bar: Maestro saw them as visible (bounds inside the screen) while the tap at their centre hit
 * the system buttons, and a reader could not reliably reach them either.
 *
 * The fix raises the sheet's hosting container by the bottom safe-area inset (`bottomInset`),
 * so the scroll area ends above the bar, and keeps the scroll content's bottom padding
 * inset-derived as a second line of defence.
 */
const mockInsets = { top: 24, bottom: 48, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
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

async function renderSheet() {
  return render(
    <ReaderSettingsSheet
      visible
      settings={DEFAULT_SETTINGS}
      onChange={() => {}}
      onClose={() => {}}
    />,
  );
}

describe('reader settings sheet — bottom safe-area inset (Android nav bar)', () => {
  it('raises the sheet above the navigation bar by the bottom inset', async () => {
    const { getByTestId } = await renderSheet();

    const sheet = getByTestId('mock-settings-bottom-sheet');
    expect(sheet.props.bottomInset).toBe(mockInsets.bottom);
  });

  it('keeps the scroll content padding inset-derived so the last row clears the bar', async () => {
    const { getByTestId } = await renderSheet();

    const scroll = getByTestId('settings-scroll');
    const content = StyleSheet.flatten(
      scroll.props.contentContainerStyle as never,
    ) as { paddingBottom?: number };

    // 28px breathing room on top of the inset floor (never less than 20px).
    expect(content.paddingBottom).toBe(28 + Math.max(mockInsets.bottom, 20));
  });

  it('follows the inset React Native reports instead of a hardcoded value', async () => {
    const before = mockInsets.bottom;
    mockInsets.bottom = 0;
    try {
      const { getByTestId } = await renderSheet();
      expect(getByTestId('mock-settings-bottom-sheet').props.bottomInset).toBe(0);
      const content = StyleSheet.flatten(
        getByTestId('settings-scroll').props.contentContainerStyle as never,
      ) as { paddingBottom?: number };
      expect(content.paddingBottom).toBe(28 + 20);
    } finally {
      mockInsets.bottom = before;
    }
  });
});
