import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useKeepAwake } from 'expo-keep-awake';

import { ReaderScreen } from '@/screens/reader-screen';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { touchBookOpened } from '@/storage/database';
import { ensureOfflineFontsDir } from '@/storage/font-assets';
import {
  DEFAULT_SETTINGS,
  loadReaderSettings,
  resetReaderSettings,
  saveReaderSettings,
} from '@/storage/settings-store';

const mockBack = jest.fn();
const postedToWebView: string[] = [];
let capturedOnLoadEnd: (() => void) | undefined;
let capturedOnMessage: ((event: { nativeEvent: { data: string } }) => void) | undefined;

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ id: 'book_123' }),
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
}));

jest.mock('@/storage/database', () => ({
  touchBookOpened: jest.fn(),
}));

jest.mock('@/storage/font-assets', () => ({
  ensureOfflineFontsDir: jest.fn(),
}));

jest.mock('@/storage/settings-store', () => {
  const actual = jest.requireActual('@/storage/settings-store');
  return {
    ...actual,
    loadReaderSettings: jest.fn(),
    saveReaderSettings: jest.fn(),
    resetReaderSettings: jest.fn(),
  };
});

describe('ReaderScreen', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    postedToWebView.length = 0;
    capturedOnLoadEnd = undefined;
    capturedOnMessage = undefined;

    (readAssetText as jest.Mock).mockResolvedValue('<html><body>reader</body></html>');
    (touchBookOpened as jest.Mock).mockResolvedValue(undefined);
    (saveBookReaderState as jest.Mock).mockResolvedValue(undefined);
    (ensureOfflineFontsDir as jest.Mock).mockResolvedValue('file:///mock/cache/rewiaty-fonts/');
    (loadReaderSettings as jest.Mock).mockResolvedValue({ ...DEFAULT_SETTINGS });
    (saveReaderSettings as jest.Mock).mockResolvedValue({ ...DEFAULT_SETTINGS });
    (resetReaderSettings as jest.Mock).mockResolvedValue({ ...DEFAULT_SETTINGS });
    (readBookBundle as jest.Mock).mockResolvedValue({
      book: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [
          { id: 'ch01', title: 'الفصل الأول', blocks: [], wordCount: 100, hash: 'h1' },
          { id: 'ch02', title: 'الفصل الثاني', blocks: [], wordCount: 120, hash: 'h2' },
        ],
        footnotes: {},
        wordCount: 220,
      },
      manifest: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [],
        wordCount: 220,
        parserVersion: 1,
      },
      state: {
        anchor: { blockId: 'ch01_p0003', charOffset: 12 },
        progress: 0.2,
        chapterId: 'ch01',
        page: 2,
        pageCount: 10,
        updatedAt: 1000,
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function renderLoadedReader() {
    const utils = await render(<ReaderScreen />);
    await waitFor(() => {
      expect(utils.getByTestId('reader-webview')).toBeTruthy();
    });
    await act(async () => {
      capturedOnLoadEnd?.();
    });
    return utils;
  }

  function emitWebMessage(payload: unknown) {
    capturedOnMessage?.({
      nativeEvent: { data: JSON.stringify(payload) },
    });
  }

  it('loads book with saved anchor and posts load payload to WebView', async () => {
    await renderLoadedReader();

    expect(useKeepAwake).toHaveBeenCalled();
    expect(postedToWebView.length).toBeGreaterThanOrEqual(1);
    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.type).toBe('load');
    expect(loadPayload.book.id).toBe('book_123');
    expect(loadPayload.anchor).toEqual({ blockId: 'ch01_p0003', charOffset: 12 });
    expect(loadPayload.settings).toEqual(DEFAULT_SETTINGS);
    expect(loadPayload.fontBaseUrl).toBe('file:///mock/cache/rewiaty-fonts/');
  });

  it('debounces position saves by 500ms', async () => {
    await renderLoadedReader();

    jest.useFakeTimers();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch02_p0001', charOffset: 0 },
        chapterId: 'ch02',
        page: 6,
        pageCount: 11,
        chapterPage: 1,
        chapterPageCount: 6,
        bookProgress: 0.5,
      });
    });

    expect(saveBookReaderState).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    jest.useRealTimers();

    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_123',
      expect.objectContaining({
        anchor: { blockId: 'ch02_p0001', charOffset: 0 },
        progress: 0.5,
        chapterId: 'ch02',
        page: 6,
        pageCount: 11,
      }),
    );
  });

  it('toggles HUD on center tap and sends goto when selecting TOC chapter', async () => {
    const { getByTestId, getByText } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({
        type: 'toc',
        chapters: [
          { id: 'ch01', title: 'الفصل الأول', wordCount: 100, pageCount: 5, startPage: 1 },
          { id: 'ch02', title: 'الفصل الثاني', wordCount: 120, pageCount: 6, startPage: 6 },
        ],
      });
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch02_p0001', charOffset: 0 },
        chapterId: 'ch02',
        page: 6,
        pageCount: 11,
        chapterPage: 1,
        chapterPageCount: 6,
        bookProgress: 0.5,
      });
    });

    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('none');
    await act(async () => {
      emitWebMessage({ type: 'tap', zone: 'center' });
    });
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('auto');
    expect(getByText('صفحة 6 من 11')).toBeTruthy();

    await fireEvent.press(getByTestId('reader-toc-button'));
    await fireEvent.press(getByTestId('toc-item-ch01'));

    const gotoMsg = JSON.parse(postedToWebView.at(-1)!);
    expect(gotoMsg).toEqual({ type: 'goto', chapterId: 'ch01' });
  });

  it('opens settings bottom sheet from HUD, sends live settings partial, applies theme, and persists', async () => {
    const { getByTestId, queryByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    expect(queryByTestId('reader-settings-sheet-host')).toBeNull();

    await fireEvent.press(getByTestId('reader-settings-button'));
    expect(getByTestId('reader-settings-sheet-host')).toBeTruthy();

    await fireEvent.press(getByTestId('settings-font-size-inc'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { fontSize: 21 },
    });

    await fireEvent.press(getByTestId('theme-option-oled'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { theme: 'oled' },
    });

    await fireEvent.press(getByTestId('font-option-Readex Pro'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { fontFamily: 'Readex Pro' },
    });

    await fireEvent(getByTestId('settings-disable-animation-switch'), 'valueChange', true);
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { disableAnimation: true },
    });

    expect(saveReaderSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fontSize: 21,
        theme: 'oled',
        fontFamily: 'Readex Pro',
        disableAnimation: true,
      }),
    );

    const hudHeader = getByTestId('reader-hud-header');
    expect(hudHeader.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: 'rgba(0, 0, 0, 0.96)' }),
      ]),
    );
  });
});
