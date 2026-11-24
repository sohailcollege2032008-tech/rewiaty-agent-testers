import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { LibraryScreen } from '@/screens/library-screen';
import { deleteBookBundle, ensureSampleBookSeeded } from '@/storage/bundle';
import { listBooks } from '@/storage/database';
import { pickAndImportBook } from '@/storage/importer';
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
    (ensureSampleBookSeeded as jest.Mock).mockResolvedValue(true);
    (listBooks as jest.Mock).mockResolvedValue([SAMPLE_RECORD]);
  });

  it('renders seeded book card, imports a book, and deletes on long-press confirm', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getAllByText, getByText, getByTestId, queryByText } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getAllByText('أَوْرَاقُ الْبَحْرِ الْقَدِيمِ').length).toBeGreaterThan(0);
      expect(getByText('35%')).toBeTruthy();
    });

    (pickAndImportBook as jest.Mock).mockResolvedValueOnce(IMPORTED_RECORD);
    (listBooks as jest.Mock).mockResolvedValueOnce([IMPORTED_RECORD, SAMPLE_RECORD]);

    await fireEvent.press(getByTestId('import-book-button'));

    await waitFor(() => {
      expect(pickAndImportBook).toHaveBeenCalledTimes(1);
      expect(getAllByText('رواية مستوردة').length).toBeGreaterThan(0);
    });

    // Long press triggers delete confirmation dialog
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
});
