import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Dimensions } from 'react-native';
import * as Sharing from 'expo-sharing';

import { ReaderScreen } from '@/screens/reader-screen';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { ensureOfflineFontsDir } from '@/storage/font-assets';
import { DEFAULT_SETTINGS, loadThemePreference } from '@/storage/settings-store';

const postedToWebView: string[] = [];
let capturedOnLoadEnd: (() => void) | undefined;
let capturedOnMessage: ((event: { nativeEvent: { data: string } }) => void) | undefined;

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'book_hl' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockWebView = React.forwardRef(
    (
      props: {
        testID?: string;
        onLoadEnd?: () => void;
        onMessage?: (event: { nativeEvent: { data: string } }) => void;
      },
      ref: React.Ref<{ postMessage: (msg: string) => void }>,
    ) => {
      capturedOnLoadEnd = props.onLoadEnd;
      capturedOnMessage = props.onMessage;
      React.useImperativeHandle(ref, () => ({
        postMessage: (msg: string) => {
          postedToWebView.push(msg);
        },
      }));
      return React.createElement(View, { testID: props.testID });
    },
  );
  return {
    __esModule: true,
    default: MockWebView,
    WebView: MockWebView,
  };
});

jest.mock('@/storage/bundle', () => ({
  readAssetText: jest.fn(),
  readBookBundle: jest.fn(),
  saveBookReaderState: jest.fn(),
  getBookDir: jest.fn(() => ({ uri: 'file:///mock/document/books/book_hl/' })),
  getBooksRootDir: jest.fn(() => ({ uri: 'file:///mock/document/books/' })),
}));

jest.mock('@/storage/database', () => ({
  touchBookOpened: jest.fn(),
  getKv: jest.fn(async (_k: string, fallback: unknown) => fallback),
  setKv: jest.fn(async () => undefined),
}));

jest.mock('@/storage/font-assets', () => ({
  ensureOfflineFontsDir: jest.fn(),
}));

jest.mock('@/storage/settings-store', () => {
  const actual = jest.requireActual('@/storage/settings-store');
  return {
    ...actual,
    loadThemePreference: jest.fn(),
  };
});

const SAMPLE_BUNDLE = {
  book: {
    id: 'book_hl',
    meta: { title: 'حجر الماء', author: 'روايتي', lang: 'ar', dir: 'rtl' },
    chapters: [
      {
        id: 'ch01',
        title: 'الفصل الأول',
        blocks: [
          {
            id: 'ch01_p0001',
            kind: 'p',
            html: 'كَانَتْ نُورُ تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ.',
          },
        ],
        wordCount: 12,
        hash: 'h1',
      },
    ],
    footnotes: {},
    wordCount: 12,
  },
  manifest: {
    id: 'book_hl',
    meta: { title: 'حجر الماء', author: 'روايتي', lang: 'ar', dir: 'rtl' },
    chapters: [],
    wordCount: 12,
    parserVersion: 1,
  },
  state: {
    anchor: null,
    progress: 0,
    highlights: [
      {
        id: 'existing_hl',
        anchor: { blockId: 'ch01_p0001', charOffset: 0 },
        length: 12,
        color: 'sky',
        quote: 'كَانَتْ نُورُ',
        contextBefore: '',
        contextAfter: ' تَعْرِفُ',
        chapterId: 'ch01',
        chapterTitle: 'الفصل الأول',
        note: 'ملاحظة قديمة',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    updatedAt: 1000,
  },
};

describe('ReaderScreen highlights & notes integration', () => {
  let colorSchemeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    postedToWebView.length = 0;
    capturedOnLoadEnd = undefined;
    capturedOnMessage = undefined;
    Dimensions.set({
      window: { width: 390, height: 844, scale: 2, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
    });
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    (readAssetText as jest.Mock).mockResolvedValue('<html></html>');
    (saveBookReaderState as jest.Mock).mockResolvedValue(undefined);
    (ensureOfflineFontsDir as jest.Mock).mockResolvedValue(null);
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS },
      hasManualTheme: false,
    });
    (readBookBundle as jest.Mock).mockResolvedValue(SAMPLE_BUNDLE);
  });

  afterEach(() => {
    colorSchemeSpy.mockRestore();
  });

  async function renderReader() {
    const utils = await render(<ReaderScreen />);
    await waitFor(() => expect(utils.getByTestId('reader-webview')).toBeTruthy());
    await act(async () => {
      capturedOnLoadEnd?.();
    });
    await act(async () => {
      capturedOnMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'ready' }) } });
    });
    return utils;
  }

  function emit(payload: unknown) {
    capturedOnMessage?.({ nativeEvent: { data: JSON.stringify(payload) } });
  }

  it('sends persisted highlights on load', async () => {
    await renderReader();
    const loadMsg = JSON.parse(postedToWebView[0]!);
    expect(loadMsg.type).toBe('load');
    expect(loadMsg.highlights).toEqual([
      expect.objectContaining({
        id: 'existing_hl',
        blockId: 'ch01_p0001',
        charOffset: 0,
        color: 'sky',
        hasNote: true,
      }),
    ]);
  });

  it('shows 4-color + note toolbar on selection and creates highlight when color is tapped', async () => {
    const { getByTestId, queryByTestId } = await renderReader();

    await act(async () => {
      emit({
        type: 'selection',
        selection: {
          anchor: { blockId: 'ch01_p0001', charOffset: 13 },
          length: 16,
          quote: 'تَعْرِفُ الْبَحْرَ',
          contextBefore: 'كَانَتْ نُورُ ',
          contextAfter: ' قَبْلَ أَنْ',
          chapterId: 'ch01',
          rect: { left: 100, top: 240, right: 260, bottom: 270, width: 160, height: 30 },
        },
      });
    });

    expect(getByTestId('highlight-toolbar')).toBeTruthy();
    for (const c of ['gold', 'sage', 'sky', 'rose']) {
      expect(getByTestId(`highlight-color-${c}`)).toBeTruthy();
    }
    expect(getByTestId('highlight-note-button')).toBeTruthy();

    await fireEvent.press(getByTestId('highlight-color-sage'));

    expect(queryByTestId('highlight-toolbar')).toBeNull();
    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_hl',
      expect.objectContaining({
        highlights: expect.arrayContaining([
          expect.objectContaining({ id: 'existing_hl' }),
          expect.objectContaining({
            color: 'sage',
            quote: 'تَعْرِفُ الْبَحْرَ',
            anchor: { blockId: 'ch01_p0001', charOffset: 13 },
            length: 16,
          }),
        ]),
      }),
    );
    const messages = postedToWebView.map((raw) => JSON.parse(raw));
    expect(messages.some((m) => m.type === 'highlights' && m.highlights.length === 2)).toBe(true);
    expect(messages.some((m) => m.type === 'clear-selection')).toBe(true);
  });

  it('opens note modal from toolbar and saves a highlighted note', async () => {
    const { getByTestId, queryByTestId } = await renderReader();

    await act(async () => {
      emit({
        type: 'selection',
        selection: {
          anchor: { blockId: 'ch01_p0001', charOffset: 13 },
          length: 16,
          quote: 'تَعْرِفُ الْبَحْرَ',
          contextBefore: 'كَانَتْ نُورُ ',
          contextAfter: ' قَبْلَ أَنْ',
          chapterId: 'ch01',
          rect: { left: 100, top: 240, right: 260, bottom: 270, width: 160, height: 30 },
        },
      });
    });

    await fireEvent.press(getByTestId('highlight-note-button'));
    expect(getByTestId('highlight-note-modal')).toBeTruthy();
    await fireEvent.changeText(getByTestId('highlight-note-input'), 'فكرة جميلة');
    await fireEvent.press(getByTestId('highlight-note-save'));

    expect(queryByTestId('highlight-note-modal')).toBeNull();
    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_hl',
      expect.objectContaining({
        highlights: expect.arrayContaining([
          expect.objectContaining({
            color: 'gold',
            note: 'فكرة جميلة',
            quote: 'تَعْرِفُ الْبَحْرَ',
          }),
        ]),
      }),
    );
  });

  it('edits and deletes an existing highlight when tapped, and exports via TOC Quotes tab', async () => {
    const { getByTestId, queryByTestId } = await renderReader();

    await act(async () => {
      emit({
        type: 'highlight-tap',
        highlightId: 'existing_hl',
        rect: { left: 80, top: 200, right: 190, bottom: 230, width: 110, height: 30 },
      });
    });

    expect(getByTestId('highlight-toolbar')).toBeTruthy();
    expect(getByTestId('highlight-delete-button')).toBeTruthy();

    await fireEvent.press(getByTestId('highlight-color-rose'));
    expect(queryByTestId('highlight-toolbar')).toBeNull();
    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_hl',
      expect.objectContaining({
        highlights: [expect.objectContaining({ id: 'existing_hl', color: 'rose' })],
      }),
    );

    // Open TOC -> Quotes tab -> Export
    await act(async () => {
      emit({ type: 'tap', zone: 'center' });
    });
    await fireEvent.press(getByTestId('reader-toc-button'));
    await fireEvent.press(getByTestId('toc-tab-highlights'));
    await fireEvent.press(getByTestId('highlights-export-button'));

    await waitFor(() => {
      expect(Sharing.shareAsync).toHaveBeenCalled();
    });
  });
});
