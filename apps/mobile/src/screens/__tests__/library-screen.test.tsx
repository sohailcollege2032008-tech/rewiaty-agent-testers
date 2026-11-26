import * as ReactNative from 'react-native';
import { Alert, Dimensions } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ToastOverlay } from '@/components/toast-overlay';
import { IMPORT_GUIDE_COUNT_KV_KEY, LibraryScreen } from '@/screens/library-screen';
import { deleteBookBundle, ensureSampleBookSeeded } from '@/storage/bundle';
import { listBooks } from '@/storage/database';
import { pickAndImportBook } from '@/storage/importer';
import { loadThemePreference } from '@/storage/settings-store';
import type { BookLibraryRecord } from '@/types/reader';
import { clearToast } from '@/utils/toast';

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

// The global reanimated mock has no `withRepeat`; the Mission Control badge
// pulses with it while jobs are active.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    View,
    useSharedValue: (initial: number) => {
      const ref = React.useRef({ value: initial });
      return ref.current;
    },
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withTiming: (toValue: number) => toValue,
    withRepeat: (value: number) => value,
    cubicBezier: () => ({}),
    Easing: { bezier: () => () => 0 },
  };
});

jest.mock('@/storage/bundle', () => ({
  ensureSampleBookSeeded: jest.fn(),
  deleteBookBundle: jest.fn(),
}));

const mockKv = new Map<string, unknown>();

jest.mock('@/storage/database', () => ({
  listBooks: jest.fn(),
  getKv: jest.fn(async (key: string, fallback: unknown) =>
    mockKv.has(key) ? mockKv.get(key) : fallback,
  ),
  setKv: jest.fn(async (key: string, value: unknown) => {
    mockKv.set(key, value);
  }),
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
  let colorSchemeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockKv.clear();
    clearToast();
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
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

  afterEach(() => {
    colorSchemeSpy.mockRestore();
  });

  it('renders seeded book card with progress percentage and without premature مقروء label', async () => {
    const { getAllByText, getByText, queryByText } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getAllByText('أَوْرَاقُ الْبَحْرِ الْقَدِيمِ').length).toBeGreaterThan(0);
      expect(getByText('35%')).toBeTruthy();
      expect(queryByText('مقروء')).toBeNull();
    });
  });

  it('shows import guide sheet on first 3 imports, expands help link, and opens picker directly after 3 times (A10, P3-1)', async () => {
    const { getAllByText, getByTestId, getByText, queryByTestId } = await render(
      <>
        <LibraryScreen />
        <ToastOverlay />
      </>,
    );

    await waitFor(() => {
      expect(getAllByText('أَوْرَاقُ الْبَحْرِ الْقَدِيمِ').length).toBeGreaterThan(0);
    });

    (pickAndImportBook as jest.Mock).mockResolvedValue(IMPORTED_RECORD);
    (listBooks as jest.Mock).mockResolvedValue([IMPORTED_RECORD, SAMPLE_RECORD]);

    // 1st press: shows guide sheet with 3 steps + help link + pick button
    await fireEvent.press(getByTestId('import-book-button'));
    await waitFor(() => {
      expect(getByTestId('import-guide-sheet')).toBeTruthy();
      expect(getByText('افتح الملف في تيليجرام ← ⋮ ← فتح بواسطة ← روايتي')).toBeTruthy();
      expect(getByTestId('import-guide-pick-button')).toBeTruthy();
      expect(getByTestId('import-guide-help-link')).toBeTruthy();
    });
    expect(pickAndImportBook).not.toHaveBeenCalled();

    // Tapping "إزاي أجيب روايات؟" reveals help text
    expect(queryByTestId('import-guide-help-box')).toBeNull();
    await fireEvent.press(getByTestId('import-guide-help-link'));
    expect(getByTestId('import-guide-help-box')).toBeTruthy();

    // Pressing "اختار ملف من الموبايل" triggers picker, shows toast, and opens book
    await fireEvent.press(getByTestId('import-guide-pick-button'));
    await waitFor(() => {
      expect(pickAndImportBook).toHaveBeenCalledTimes(1);
      expect(getByText('اتضافت «رواية مستوردة»')).toBeTruthy();
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/reader/[id]',
        params: { id: 'book_imported' },
      });
    });

    // 2nd and 3rd presses still show the guide sheet
    await fireEvent.press(getByTestId('import-book-button'));
    await waitFor(() => expect(getByTestId('import-guide-sheet')).toBeTruthy());
    await fireEvent.press(getByTestId('import-guide-backdrop'));

    await fireEvent.press(getByTestId('import-book-button'));
    await waitFor(() => expect(getByTestId('import-guide-sheet')).toBeTruthy());
    await fireEvent.press(getByTestId('import-guide-backdrop'));
    expect(mockKv.get(IMPORT_GUIDE_COUNT_KV_KEY)).toBe(3);

    // 4th press skips the guide sheet and opens the picker directly
    await fireEvent.press(getByTestId('import-book-button'));
    await waitFor(() => {
      expect(pickAndImportBook).toHaveBeenCalledTimes(2);
    });
    expect(queryByTestId('import-guide-sheet')).toBeNull();
  });

  it('shows ابدأ القراية on hero CTA when progress is 0 and كمّل القراية when > 0 (A1)', async () => {
    const unopenedHero: BookLibraryRecord = {
      ...IMPORTED_RECORD,
      id: 'book_zero',
      title: 'كتاب لم يبدأ',
      progress: 0,
    };
    (listBooks as jest.Mock).mockResolvedValueOnce([unopenedHero]);

    const { getByTestId, getByText, queryByText } = await render(<LibraryScreen />);
    await waitFor(() => {
      expect(getByText('ابدأ القراية')).toBeTruthy();
      expect(queryByText('كمّل القراية')).toBeNull();
      expect(getByTestId('continue-reading-button').props.accessibilityLabel).toBe('ابدأ القراية');
    });
  });

  it('shows مقروء only when progress >= 98% and numeric % for 1%-97% (P3-2)', async () => {
    const ninetySeven: BookLibraryRecord = {
      ...SAMPLE_RECORD,
      id: 'book_97',
      title: 'كتاب ٩٧',
      progress: 0.97,
      lastOpenedAt: 5000,
    };
    const ninetyEight: BookLibraryRecord = {
      ...IMPORTED_RECORD,
      id: 'book_98',
      title: 'كتاب ٩٨',
      progress: 0.98,
      lastOpenedAt: 4000,
    };
    (listBooks as jest.Mock).mockResolvedValueOnce([ninetySeven, ninetyEight]);

    const { getAllByText, getByText } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getByText('97%')).toBeTruthy();
      expect(getAllByText('مقروء')).toHaveLength(1);
    });
  });

  it('ignores reading theme oled-crimson and stays warraq when system is light (P3-7)', async () => {
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { theme: 'oled-crimson' },
      hasManualTheme: true,
    });

    const { getByTestId, queryByTestId } = await render(<LibraryScreen />);
    await waitFor(() => {
      const containerStyle = ReactNative.StyleSheet.flatten(
        getByTestId('library-screen').props.style,
      ) as Record<string, unknown>;
      expect(containerStyle.backgroundColor).toBe('#FAF7F0');
    });
    expect(queryByTestId('library-theme-toggle')).toBeNull();
  });

  it('uses burnt-paper when system colorScheme is dark even if reading theme is sepia (P3-7)', async () => {
    colorSchemeSpy.mockReturnValue('dark');
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { theme: 'sepia' },
      hasManualTheme: true,
    });

    const { getByTestId } = await render(<LibraryScreen />);
    await waitFor(() => {
      const containerStyle = ReactNative.StyleSheet.flatten(
        getByTestId('library-screen').props.style,
      ) as Record<string, unknown>;
      expect(containerStyle.backgroundColor).toBe('#181310');
    });
  });

  it('fits cover text in max 2 lines with adjustsFontSizeToFit and marks only the last unopened book جديدة (P3-8)', async () => {
    const activeHero: BookLibraryRecord = {
      ...SAMPLE_RECORD,
      id: 'book_active',
      title: 'كتاب حالي',
      progress: 0.5,
      addedAt: 500,
      lastOpenedAt: 5000,
    };
    const openedZero: BookLibraryRecord = {
      ...SAMPLE_RECORD,
      id: 'book_opened_zero',
      title: 'كتاب مفتوح بصفر',
      progress: 0,
      addedAt: 1000,
      lastOpenedAt: 4000,
    };
    const newestUnopened: BookLibraryRecord = {
      ...IMPORTED_RECORD,
      id: 'book_newest_unopened',
      title: 'أُمُّ الشَّوَاطِئِ',
      author: 'قسم الجودة',
      progress: 0,
      addedAt: 3000,
      lastOpenedAt: 3000,
    };
    const olderUnopened: BookLibraryRecord = {
      ...SAMPLE_RECORD,
      id: 'book_old_unopened',
      title: 'كتاب قديم غير مفتوح',
      progress: 0,
      addedAt: 1500,
      lastOpenedAt: 1500,
    };
    (listBooks as jest.Mock).mockResolvedValueOnce([
      activeHero,
      openedZero,
      newestUnopened,
      olderUnopened,
    ]);

    const { getAllByText } = await render(<LibraryScreen />);

    await waitFor(() => {
      // Only newestUnopened gets جديدة; openedZero & olderUnopened show 0%
      expect(getAllByText('جديدة')).toHaveLength(1);
      expect(getAllByText('0%')).toHaveLength(2);
    });

    const coverTitles = getAllByText('أُمُّ الشَّوَاطِئِ');
    const coverTitle = coverTitles.find((n) => n.props.adjustsFontSizeToFit === true);
    expect(coverTitle).toBeDefined();
    expect(coverTitle!.props.numberOfLines).toBe(2);

    const coverAuthors = getAllByText('قسم الجودة');
    const coverAuthor = coverAuthors.find((n) => n.props.adjustsFontSizeToFit === true);
    expect(coverAuthor).toBeDefined();
    expect(coverAuthor!.props.numberOfLines).toBe(1);
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

  it('uses multi-column tablet grid on tablet width', async () => {
    Dimensions.set({
      window: { width: 1366, height: 1024, scale: 2, fontScale: 1 },
      screen: { width: 1366, height: 1024, scale: 2, fontScale: 1 },
    });
    (listBooks as jest.Mock).mockResolvedValue([IMPORTED_RECORD, SAMPLE_RECORD]);

    const { getByTestId, queryByTestId } = await render(<LibraryScreen />);

    await waitFor(() => {
      const list = getByTestId('library-book-list');
      expect(list.props.numColumns).toBe(4);
      expect(queryByTestId('library-theme-pill-burnt-paper')).toBeNull();
    });
  });

  it('opens AI settings from the library header (BYOK entry point)', async () => {
    const { getByTestId } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getByTestId('library-ai-settings-button')).toBeTruthy();
    });

    const button = getByTestId('library-ai-settings-button');
    expect(button.props.accessibilityLabel).toBe('إعدادات الذكاء الاصطناعي');
    expect(button.props.accessibilityRole).toBe('button');

    await fireEvent.press(button);

    expect(mockPush).toHaveBeenCalledWith('/ai-settings');
    // The sample-book import invariant must survive the extra header action.
    expect(getByTestId('import-book-button')).toBeTruthy();
    expect(getByTestId('library-brand-name')).toBeTruthy();
  });

  it('gives primary library buttons >= 48dp effective touch targets', async () => {
    const { getByTestId } = await render(<LibraryScreen />);

    await waitFor(() => {
      expect(getByTestId('import-book-button')).toBeTruthy();
    });

    const measureTouchBox = (node: { props: Record<string, unknown> }) => {
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
      const w = Number(flat.minWidth ?? flat.width ?? 100);
      const h = Number(flat.minHeight ?? flat.height ?? 0);
      return { width: w + left + right, height: h + top + bottom };
    };

    for (const id of ['import-book-button', 'continue-reading-button', 'library-ai-settings-button']) {
      const box = measureTouchBox(getByTestId(id));
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThanOrEqual(48);
    }
  });

  it('configures expo-localization for forced RTL in app.json and I18nManager in _layout', () => {
    const appJson = require('../../../app.json') as {
      expo: { plugins: Array<string | [string, Record<string, unknown>]> };
    };
    const locPlugin = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === 'expo-localization',
    ) as [string, Record<string, unknown>] | undefined;
    expect(locPlugin).toBeDefined();
    expect(locPlugin?.[1]).toEqual(
      expect.objectContaining({ supportsRTL: true, forcesRTL: true }),
    );
  });
});
