import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { SearchScreen } from '@/screens/search-screen';
import {
  ensureLibrarySearchIndexed,
  searchLibrary,
  type SearchHit,
} from '@/storage/search-index';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { bookId?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/storage/search-index', () => ({
  ensureLibrarySearchIndexed: jest.fn(),
  searchLibrary: jest.fn(),
}));

const SAMPLE_HIT: SearchHit = {
  bookId: 'book_water',
  bookTitle: 'حَجَرُ الْمَاءِ',
  chapterId: 'ch01',
  chapterTitle: 'الْفَصْلُ الْأَوَّلُ',
  blockId: 'ch01_p0002',
  charOffset: 24,
  snippetBefore: '…كَانَ ',
  snippetMatch: 'حَجَرُ الْمَاءِ',
  snippetAfter: ' مَوْجُودًا…',
};

describe('SearchScreen', () => {
  let colorSchemeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockParams = {};
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    (ensureLibrarySearchIndexed as jest.Mock).mockResolvedValue(undefined);
    (searchLibrary as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    colorSchemeSpy.mockRestore();
  });

  it('shows Arabic idle state initially and ensures library index is populated', async () => {
    const { getByTestId, getByText } = await render(<SearchScreen />);

    await waitFor(() => {
      expect(ensureLibrarySearchIndexed).toHaveBeenCalledTimes(1);
    });

    expect(getByTestId('search-idle-state')).toBeTruthy();
    expect(getByText('ابحث في رواياتك…')).toBeTruthy();
  });

  it('debounces search input, renders highlighted snippet results, and navigates to exact anchor on press', async () => {
    (searchLibrary as jest.Mock).mockResolvedValue([SAMPLE_HIT]);

    const { getAllByText, getByTestId, getByText } = await render(<SearchScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    await fireEvent.changeText(getByTestId('search-input'), 'حجر الماء');

    await act(async () => {
      jest.advanceTimersByTime(160);
    });

    await waitFor(() => {
      expect(searchLibrary).toHaveBeenCalledWith('حجر الماء', { bookId: undefined });
      expect(getByTestId('search-result-0')).toBeTruthy();
    });

    const matches = getAllByText('حَجَرُ الْمَاءِ', { exact: true });
    expect(matches).toHaveLength(2);
    expect(getByText('الْفَصْلُ الْأَوَّلُ')).toBeTruthy();
    const hasAccentHighlight = matches.some((node) => {
      const flat = ReactNative.StyleSheet.flatten(node.props.style) as Record<string, unknown>;
      return flat?.color === '#9E3E2F';
    });
    expect(hasAccentHighlight).toBe(true);

    await fireEvent.press(getByTestId('search-result-0'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/reader/[id]',
      params: {
        id: 'book_water',
        blockId: 'ch01_p0002',
        charOffset: '24',
      },
    });
  });

  it('shows empty results state in Arabic and clears query back to idle state', async () => {
    (searchLibrary as jest.Mock).mockResolvedValue([]);

    const { getByTestId, getByText } = await render(<SearchScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    await fireEvent.changeText(getByTestId('search-input'), 'كلمة غير موجودة');

    await act(async () => {
      jest.advanceTimersByTime(160);
    });

    await waitFor(() => {
      expect(getByTestId('search-empty-state')).toBeTruthy();
      expect(getByText('لا توجد نتائج')).toBeTruthy();
    });

    await fireEvent.press(getByTestId('search-clear-button'));
    expect(getByTestId('search-idle-state')).toBeTruthy();
  });

  it('shows scope chips when bookId param is present and switches between book and full library', async () => {
    mockParams = { bookId: 'book_water' };
    (searchLibrary as jest.Mock).mockResolvedValue([SAMPLE_HIT]);

    const { getByTestId } = await render(<SearchScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId('search-scope-book')).toBeTruthy();
    expect(getByTestId('search-scope-library')).toBeTruthy();

    await fireEvent.changeText(getByTestId('search-input'), 'حجر');

    await act(async () => {
      jest.advanceTimersByTime(160);
    });

    await waitFor(() => {
      expect(searchLibrary).toHaveBeenLastCalledWith('حجر', { bookId: 'book_water' });
    });

    await fireEvent.press(getByTestId('search-scope-library'));

    await act(async () => {
      jest.advanceTimersByTime(160);
    });

    await waitFor(() => {
      expect(searchLibrary).toHaveBeenLastCalledWith('حجر', { bookId: undefined });
    });
  });

  it('guards technical English errors behind a friendly Arabic message', async () => {
    (searchLibrary as jest.Mock).mockRejectedValue(
      new Error('SQLITE_ERROR: fts5 syntax error near "*"'),
    );

    const { getByTestId, getByText, queryByText } = await render(<SearchScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    await fireEvent.changeText(getByTestId('search-input'), 'اختبار');

    await act(async () => {
      jest.advanceTimersByTime(160);
    });

    await waitFor(() => {
      expect(getByTestId('search-error-state')).toBeTruthy();
    });

    expect(queryByText(/SQLITE_ERROR/)).toBeNull();
    expect(getByText('تعذّر إتمام البحث حاليًا. حاول مرة أخرى.')).toBeTruthy();
  });
});
