import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useKeepAwake } from 'expo-keep-awake';

import { ReaderScreen } from '@/screens/reader-screen';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { touchBookOpened } from '@/storage/database';

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

  it('loads book with saved anchor, debounces position saves, toggles HUD, and handles TOC goto', async () => {
    const { getByTestId, getByText } = await render(<ReaderScreen />);

    expect(useKeepAwake).toHaveBeenCalled();

    await waitFor(() => {
      expect(getByTestId('reader-webview')).toBeTruthy();
    });

    await act(async () => {
      capturedOnLoadEnd?.();
    });

    expect(postedToWebView.length).toBeGreaterThanOrEqual(1);
    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.type).toBe('load');
    expect(loadPayload.book.id).toBe('book_123');
    expect(loadPayload.anchor).toEqual({ blockId: 'ch01_p0003', charOffset: 12 });

    jest.useFakeTimers();
    await act(async () => {
      capturedOnMessage?.({
        nativeEvent: { data: JSON.stringify({ type: 'ready' }) },
      });
      capturedOnMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            type: 'toc',
            chapters: [
              { id: 'ch01', title: 'الفصل الأول', wordCount: 100, pageCount: 5, startPage: 1 },
              { id: 'ch02', title: 'الفصل الثاني', wordCount: 120, pageCount: 6, startPage: 6 },
            ],
          }),
        },
      });
      capturedOnMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            type: 'position',
            anchor: { blockId: 'ch02_p0001', charOffset: 0 },
            chapterId: 'ch02',
            page: 6,
            pageCount: 11,
            chapterPage: 1,
            chapterPageCount: 6,
            bookProgress: 0.5,
          }),
        },
      });
    });

    // Position save is debounced by 500ms
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

    // Tap center toggles HUD and shows page X of Y and chapter title
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('none');
    await act(async () => {
      capturedOnMessage?.({
        nativeEvent: { data: JSON.stringify({ type: 'tap', zone: 'center' }) },
      });
    });
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('auto');
    expect(getByText('صفحة 6 من 11')).toBeTruthy();

    // Open TOC and select chapter -> sends goto chapterId
    await fireEvent.press(getByTestId('reader-toc-button'));
    await fireEvent.press(getByTestId('toc-item-ch01'));

    const gotoMsg = JSON.parse(postedToWebView.at(-1)!);
    expect(gotoMsg).toEqual({ type: 'goto', chapterId: 'ch01' });
  });
});
