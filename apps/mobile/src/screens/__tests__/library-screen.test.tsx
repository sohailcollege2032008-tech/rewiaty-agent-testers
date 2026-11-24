import { Alert, Dimensions } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { LibraryScreen } from '@/screens/library-screen';
import { deleteBookBundle, ensureSampleBookSeeded } from '@/storage/bundle';
import { listBooks } from '@/storage/database';
import { pickAndImportBook } from '@/storage/importer';
import { loadThemePreference } from '@/storage/settings-store';
import type { BookLibraryRecord } from '@/types/reader';

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (cb: () => void) => {
      React.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/storage/bundle', () => ({
  ensureSampleBookSeeded: jest.fn(),
  deleteBookBundle: jest.fn(),
}));

jest.mock('@/storage/database', () => ({
  listBooks: jest.fn(),
}));

jest.mock('@/storage/importer', () => ({
  pickAndImportBook: jest.fn(),
}));

jest.mock('@/storage/settings-store', () => {
  const actual = jest.requireActual('@/storage/settings-store');
  return {
    ...actual,
    loadThemePreference: jest.fn(),
    selectManualTheme: jest.fn(),
  };
});

const SAMPLE_RECORD: BookLibraryRecord = {
  id: 'book_sample',
  title: 'أَوْرَاقُ الْبَحْرِ الْقَدِيمِ',
  author: 'مؤلف تجريبي',
  dir: 'rtl',
  coverSeed: 'أَوْرَاقُ الْبَحْرِ الْقَدِيمِ',
  coverColor: '#4E342E',
  progress: 0.35,
  lastOpenedAt: 2000,
  addedAt: 1000,
};

const IMPORTED_RECORD: BookLibraryRecord = {
  id: 'book_imported',
  title: 'رواية مستوردة',
  author: 'كاتب جديد',
  dir: 'rtl',
  coverSeed: 'رواية مستوردة',
  coverColor: null,
  progress: 0,
  lastOpenedAt: 3000,
  addedAt: 3000,
};

describe('LibraryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Dimensions.set({
      window: { width: 390, height: 844, scale: 2, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
    });
    (ensureSampleBookSeeded as jest.Mock).mockResolvedValue(true);
    (listBooks as jest.Mock).mockResolvedValue([SAMPLE_RECORD]);
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { theme: 'warraq' },
      hasManualTheme: false,
    });
  });

  it('renders seeded book card with progress percentage', async () => {
    const { getAllByText, getByText } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getAllByText('أَوْرَاقُ الْبَحْرِ الْقَدِيمِ').length).toBeGreaterThan(0);
      expect(getByText('35%')).toBeTruthy();
    });
  });

  it('imports a book and renders it in the library list', async () => {
    const { getAllByText, getByTestId } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getAllByText('أَوْرَاقُ الْبَحْرِ الْقَدِيمِ').length).toBeGreaterThan(0);
    });

    (pickAndImportBook as jest.Mock).mockResolvedValueOnce(IMPORTED_RECORD);
    (listBooks as jest.Mock).mockResolvedValueOnce([IMPORTED_RECORD, SAMPLE_RECORD]);

    await fireEvent.press(getByTestId('import-book-button'));

    await waitFor(() => {
      expect(pickAndImportBook).toHaveBeenCalledTimes(1);
      expect(getAllByText('رواية مستوردة').length).toBeGreaterThan(0);
    });
  });

  it('deletes a book on long-press confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    (listBooks as jest.Mock).mockResolvedValueOnce([IMPORTED_RECORD, SAMPLE_RECORD]);

    const { getAllByText, getByTestId, queryByText } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getAllByText('رواية مستوردة').length).toBeGreaterThan(0);
    });

    await fireEvent(getByTestId('book-card-book_imported'), 'longPress');
    expect(alertSpy).toHaveBeenCalledTimes(1);

    const buttons = alertSpy.mock.calls[0]?.[2];
    const deleteBtn = buttons?.find((b) => b.style === 'destructive');
    expect(deleteBtn).toBeDefined();

    (deleteBookBundle as jest.Mock).mockResolvedValueOnce(undefined);
    (listBooks as jest.Mock).mockResolvedValueOnce([SAMPLE_RECORD]);

    await act(async () => {
      deleteBtn?.onPress?.();
    });

    await waitFor(() => {
      expect(deleteBookBundle).toHaveBeenCalledWith('book_imported');
      expect(queryByText('رواية مستوردة')).toBeNull();
    });

    alertSpy.mockRestore();
  });

  it('uses multi-column tablet grid and theme pills on tablet width', async () => {
    Dimensions.set({
      window: { width: 1366, height: 1024, scale: 2, fontScale: 1 },
      screen: { width: 1366, height: 1024, scale: 2, fontScale: 1 },
    });
    (listBooks as jest.Mock).mockResolvedValue([IMPORTED_RECORD, SAMPLE_RECORD]);

    const { getByTestId } = await render(<LibraryScreen />);

    await waitFor(() => {
      const list = getByTestId('library-book-list');
      expect(list.props.numColumns).toBe(4);
      expect(getByTestId('library-theme-pill-burnt-paper')).toBeTruthy();
    });
  });
});
