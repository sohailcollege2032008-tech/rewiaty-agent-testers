import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useKeepAwake } from 'expo-keep-awake';
import * as ReactNative from 'react-native';
import { Dimensions, Linking, Platform } from 'react-native';

import { ReaderScreen } from '@/screens/reader-screen';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { touchBookOpened } from '@/storage/database';
import { ensureOfflineFontsDir } from '@/storage/font-assets';
import {
  DEFAULT_SETTINGS,
  loadThemePreference,
  resetReaderSettings,
  resetSection,
  saveReaderSettings,
  selectManualTheme,
} from '@/storage/settings-store';

const mockBack = jest.fn();
const postedToWebView: string[] = [];
let capturedOnLoadEnd: (() => void) | undefined;
let capturedOnMessage: ((event: { nativeEvent: { data: string } }) => void) | undefined;
let capturedWebViewProps: Record<string, unknown> | undefined;

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
        [key: string]: unknown;
      },
      ref: React.Ref<{ postMessage: (msg: string) => void }>,
    ) => {
      capturedOnLoadEnd = props.onLoadEnd;
      capturedOnMessage = props.onMessage;
      capturedWebViewProps = props as Record<string, unknown>;
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
  getBookDir: jest.fn(() => ({ uri: 'file:///mock/document/books/book_123/' })),
  getBooksRootDir: jest.fn(() => ({ uri: 'file:///mock/document/books/' })),
}));

const mockKv = new Map<string, unknown>();
jest.mock('@/storage/database', () => ({
  touchBookOpened: jest.fn(),
  getKv: jest.fn(async (key: string, fallback: unknown) => (mockKv.has(key) ? mockKv.get(key) : fallback)),
  setKv: jest.fn(async (key: string, value: unknown) => {
    mockKv.set(key, value);
  }),
}));

jest.mock('@/storage/font-assets', () => ({
  ensureOfflineFontsDir: jest.fn(),
}));

jest.mock('@/storage/settings-store', () => {
  const actual = jest.requireActual('@/storage/settings-store');
  return {
    ...actual,
    loadThemePreference: jest.fn(),
    loadReaderSettings: jest.fn(),
    saveReaderSettings: jest.fn(),
    selectManualTheme: jest.fn(),
    resetSection: jest.fn(),
    resetReaderSettings: jest.fn(),
  };
});

describe('ReaderScreen', () => {
  let colorSchemeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    postedToWebView.length = 0;
    capturedOnLoadEnd = undefined;
    capturedOnMessage = undefined;
    capturedWebViewProps = undefined;

    Dimensions.set({
      window: { width: 390, height: 844, scale: 2, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
    });
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');

    (readAssetText as jest.Mock).mockResolvedValue('<html><body>reader</body></html>');
    (touchBookOpened as jest.Mock).mockResolvedValue(undefined);
    (saveBookReaderState as jest.Mock).mockResolvedValue(undefined);
    (ensureOfflineFontsDir as jest.Mock).mockResolvedValue('file:///mock/document/books/_fonts/');
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS },
      hasManualTheme: false,
    });
    (saveReaderSettings as jest.Mock).mockResolvedValue({ ...DEFAULT_SETTINGS });
    (selectManualTheme as jest.Mock).mockResolvedValue({ ...DEFAULT_SETTINGS });
    (resetSection as jest.Mock).mockResolvedValue({ ...DEFAULT_SETTINGS });
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
    colorSchemeSpy.mockRestore();
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

  it('hardens the reader WebView: local-only origins, no file-URL JS surface, outbound links leave the app', async () => {
    await renderLoadedReader();

    const props = capturedWebViewProps!;
    expect(props.allowFileAccessFromFileURLs).toBeUndefined();
    expect(props.allowUniversalAccessFromFileURLs).toBeUndefined();
    expect(props.originWhitelist).toEqual(['file://*', 'about:blank']);
    expect(props.originWhitelist).not.toContain('*');
    expect(props.allowFileAccess === true).toBe(Platform.OS === 'android');
    expect(props.allowingReadAccessToURL).toBe('file:///mock/document/books/');
    expect((props.source as { baseUrl?: string }).baseUrl).toBe(
      'file:///mock/document/books/book_123/',
    );

    const canStart = props.onShouldStartLoadWithRequest as (request: {
      url: string;
    }) => boolean;
    expect(canStart({ url: 'about:blank' })).toBe(true);
    expect(canStart({ url: 'file:///mock/document/books/book_123/' })).toBe(true);
    expect(canStart({ url: 'file:///etc/passwd' })).toBe(false);
    expect(canStart({ url: 'file:///mock/document/books/other/book.md' })).toBe(false);

    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    expect(canStart({ url: 'https://example.com/article' })).toBe(false);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/article');
    expect(canStart({ url: 'javascript:alert(1)' })).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
    openUrl.mockRestore();
  });

  it('loads book with saved anchor and posts load payload to WebView', async () => {
    await renderLoadedReader();

    expect(useKeepAwake).toHaveBeenCalled();
    expect(postedToWebView.length).toBeGreaterThanOrEqual(1);
    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.type).toBe('load');
    expect(loadPayload.book.id).toBe('book_123');
    expect(loadPayload.anchor).toEqual({ blockId: 'ch01_p0003', charOffset: 12 });
    // A phone always gets one page, sent explicitly on load (the engine's own default is 'auto').
    expect(loadPayload.settings).toEqual({ ...DEFAULT_SETTINGS, spread: 'single' });
    expect(loadPayload.fontBaseUrl).toBe('file:///mock/document/books/_fonts/');
  });

  it('exposes the engine image proof so an import can be proven to have painted a figure', async () => {
    const utils = await renderLoadedReader();
    expect(utils.queryByTestId('reader-image-proof')).toBeNull();

    await act(async () => {
      emitWebMessage({ type: 'image-rendered', count: 1, width: 240, height: 160 });
    });

    const proof = utils.getByTestId('reader-image-proof');
    expect(proof.props.children).toBe('صورة 240×160');
    expect(utils.queryByTestId('reader-image-error')).toBeNull();
  });

  it('surfaces a mounted figure that painted nothing as an explicit error, not as silence', async () => {
    const utils = await renderLoadedReader();

    // The engine reports `count: 0` when a figure was mounted but decoded to nothing. An absent
    // node would be indistinguishable from "the engine never reported", which is what let the
    // negative control pass for the wrong reason (CI run 45687065853).
    await act(async () => {
      emitWebMessage({ type: 'image-rendered', count: 0, width: 0, height: 0 });
    });

    const failure = utils.getByTestId('reader-image-error');
    expect(failure.props.children).toBe('الصورة مش ظاهرة');
    expect(utils.queryByTestId('reader-image-proof')).toBeNull();
  });

  it('automatically uses burnt-paper when system colorScheme is dark and no manual theme is set', async () => {
    colorSchemeSpy.mockReturnValue('dark');
    await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.settings.theme).toBe('burnt-paper');
  });

  it('respects manual theme override even when system colorScheme is dark', async () => {
    colorSchemeSpy.mockReturnValue('dark');
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, theme: 'sepia' },
      hasManualTheme: true,
    });
    await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.settings.theme).toBe('sepia');
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
    expect(queryByTestId('reader-settings-side-panel')).toBeNull();

    await fireEvent.press(getByTestId('settings-font-size-inc'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { fontSize: 21 },
    });

    // Each settings tab shows only its own section.
    await fireEvent.press(getByTestId('settings-tab-theme'));
    await fireEvent.press(getByTestId('theme-option-oled-crimson'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { theme: 'oled-crimson' },
    });
    expect(selectManualTheme).toHaveBeenCalledWith('oled-crimson');

    await fireEvent.press(getByTestId('settings-tab-font'));
    await fireEvent.press(getByTestId('font-option-Readex Pro'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { fontFamily: 'Readex Pro' },
    });

    await fireEvent.press(getByTestId('settings-tab-layout'));
    await fireEvent(getByTestId('settings-disable-animation-switch'), 'valueChange', true);
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { disableAnimation: true },
    });

    expect(saveReaderSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fontSize: 21,
        theme: 'oled-crimson',
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

  it('sends spread="auto" and renders settings as a side panel on landscape tablet', async () => {
    Dimensions.set({
      window: { width: 1366, height: 1024, scale: 2, fontScale: 1 },
      screen: { width: 1366, height: 1024, scale: 2, fontScale: 1 },
    });

    const { getByTestId } = await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.settings.spread).toBe('auto');
    expect(loadPayload.settings.maxReadingWidth).toBe(54);

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    await fireEvent.press(getByTestId('reader-settings-button'));
    expect(getByTestId('reader-settings-side-panel')).toBeTruthy();
  });

  it('uses tablet portrait maxReadingWidth=62 and bottom sheet in portrait tablet', async () => {
    Dimensions.set({
      window: { width: 1024, height: 1366, scale: 2, fontScale: 1 },
      screen: { width: 1024, height: 1366, scale: 2, fontScale: 1 },
    });

    const { getByTestId, queryByTestId } = await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.settings.spread).toBe('single');
    expect(loadPayload.settings.maxReadingWidth).toBe(62);

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    await fireEvent.press(getByTestId('reader-settings-button'));
    expect(getByTestId('mock-bottom-sheet')).toBeTruthy();
    expect(queryByTestId('reader-settings-side-panel')).toBeNull();
  });

  it('shows the bars with a hint the first time a reader opens a book', async () => {
    mockKv.clear();
    const screen = await renderLoadedReader();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
    });
    await waitFor(() => expect(screen.getByTestId('reader-hud-hint')).toBeTruthy());
    expect(screen.getByTestId('reader-settings-button')).toBeTruthy();
    expect(mockKv.get('reader_hud_hint_seen_v1')).toBe(true);
  });

  it('retires the first-open hint on any tap or page change (QA P3-5)', async () => {
    mockKv.clear();
    const screen = await renderLoadedReader();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'position', chapterId: 'ch01', page: 1, pageCount: 6, anchor: { blockId: 'ch01_p0001', charOffset: 0 }, bookProgress: 0 });
    });
    await waitFor(() => expect(screen.getByTestId('reader-hud-hint')).toBeTruthy());
    await act(async () => {
      emitWebMessage({ type: 'position', chapterId: 'ch01', page: 2, pageCount: 6, anchor: { blockId: 'ch01_p0004', charOffset: 0 }, bookProgress: 0.05 });
    });
    expect(screen.queryByTestId('reader-hud-hint')).toBeNull();
  });

  it('does not show the hint again once it was seen', async () => {
    // One render per test: two renders in one test overlapped act() and broke the following tests.
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const screen = await renderLoadedReader();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
    });
    expect(screen.queryByTestId('reader-hud-hint')).toBeNull();
  });

  it('checks the first-open hint once even when ready arrives twice', async () => {
    const db = jest.requireMock('@/storage/database');
    mockKv.clear();
    await renderLoadedReader();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'ready' });
    });
    expect((db.getKv as jest.Mock).mock.calls.filter(([k]: [string]) => k === 'reader_hud_hint_seen_v1')).toHaveLength(1);
  });

  it('keeps reading when the hint storage fails', async () => {
    const db = jest.requireMock('@/storage/database');
    (db.getKv as jest.Mock).mockRejectedValueOnce(new Error('sqlite busy'));
    const screen = await renderLoadedReader();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
    });
    expect(screen.queryByTestId('reader-hud-hint')).toBeNull();
    expect(screen.getByTestId('reader-webview')).toBeTruthy();
  });

  it('sends permanent chrome insets on load and updates them when HUD bar layout changes', async () => {
    const { getByTestId } = await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.insets).toEqual({
      top: expect.any(Number),
      bottom: expect.any(Number),
    });
    expect(loadPayload.insets.top).toBeGreaterThan(0);
    expect(loadPayload.insets.bottom).toBeGreaterThan(0);

    await act(async () => {
      fireEvent(getByTestId('reader-hud-header'), 'layout', {
        nativeEvent: { layout: { width: 390, height: 80, x: 0, y: 0 } },
      });
      fireEvent(getByTestId('reader-hud-footer'), 'layout', {
        nativeEvent: { layout: { width: 390, height: 140, x: 0, y: 704 } },
      });
      fireEvent(getByTestId('reader-running-footer'), 'layout', {
        nativeEvent: { layout: { width: 390, height: 32, x: 0, y: 812 } },
      });
    });

    const lastMsg = JSON.parse(postedToWebView.at(-1)!);
    expect(lastMsg).toEqual({
      type: 'settings',
      partial: {},
      insets: { top: 72, bottom: 108 },
    });
  });

  it('toggles bookmark without calling back when pressing the ribbon while HUD is visible', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('auto');

    const ribbon = getByTestId('reader-bookmark-ribbon');
    const flatRibbonStyle = ReactNative.StyleSheet.flatten(ribbon.props.style) as Record<
      string,
      unknown
    >;
    expect(Number(flatRibbonStyle.top)).toBeGreaterThan(0);
    expect(Number(flatRibbonStyle.zIndex)).toBeGreaterThan(20);

    await fireEvent.press(ribbon);

    expect(mockBack).not.toHaveBeenCalled();
    expect(getByTestId('reader-bookmark-ribbon').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_123',
      expect.objectContaining({
        bookmarks: [],
        bookmarkItems: [
          expect.objectContaining({ anchor: { blockId: 'ch01_p0003', charOffset: 12 }, page: 2 }),
        ],
      }),
    );
  });

  it('restores HUD visibility on settings close and suppresses taps for 300ms', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId, queryByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('auto');

    await fireEvent.press(getByTestId('reader-settings-button'));
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('none');
    expect(getByTestId('reader-settings-sheet-host')).toBeTruthy();

    await fireEvent.press(getByTestId('settings-dismiss-backdrop'));
    expect(queryByTestId('reader-settings-sheet-host')).toBeNull();
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('auto');
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'suppress-taps',
      durationMs: 300,
    });

    // A tap delivered immediately inside the 300ms window does not hide the restored HUD.
    await act(async () => {
      emitWebMessage({ type: 'tap', zone: 'center' });
    });
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('auto');

    // After >300ms, tapping center toggles HUD normally.
    const realNow = Date.now;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow() + 350);
    await act(async () => {
      emitWebMessage({ type: 'tap', zone: 'center' });
    });
    nowSpy.mockRestore();
    expect(getByTestId('reader-hud-header').props.pointerEvents).toBe('none');
  });

  it('gives reader HUD and settings controls >= 48dp touch targets and prevents label wrapping at fontScale 2', async () => {
    Dimensions.set({
      window: { width: 390, height: 844, scale: 2, fontScale: 2 },
      screen: { width: 390, height: 844, scale: 2, fontScale: 2 },
    });

    const { getByTestId, getByText } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
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
      const w = Number(flat.minWidth ?? flat.width ?? 48);
      const h = Number(flat.minHeight ?? flat.height ?? 32);
      return { width: w + left + right, height: h + top + bottom };
    };

    for (const id of [
      'reader-back-button',
      'reader-toc-button',
      'reader-theme-button',
      'reader-settings-button',
      'reader-bookmark-ribbon',
      'reader-scrubber-track',
    ]) {
      const box = measureTouchBox(getByTestId(id));
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }

    expect(getByTestId('reader-settings-button').props.accessibilityLabel).toBe('الإعدادات');

    await fireEvent.press(getByTestId('reader-settings-button'));

    for (const id of [
      'settings-tab-font',
      'settings-tab-layout',
      'settings-tab-theme',
      'settings-reset-button',
      'settings-font-size-dec',
      'settings-font-size-inc',
      'settings-weight-500',
    ]) {
      const box = measureTouchBox(getByTestId(id));
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.width).toBeGreaterThanOrEqual(48);
    }

    // Weight label "متوسط" never breaks mid-word at fontScale 2.
    const weightLabel = getByText('متوسط');
    expect(weightLabel.props.numberOfLines).toBe(1);
    expect(weightLabel.props.adjustsFontSizeToFit).toBe(true);
  });

  it('matches engine bookProgress in running footer, sets quiet 0.6 opacity, drops bookmark hint, truncates chapter title cleanly, and labels WebView in Arabic (P3-3, P3-6, P3-9, P3-10)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId, getByText, queryByText } = await renderLoadedReader();

    expect(capturedWebViewProps?.accessibilityLabel).toBe('صفحة الرواية');
    expect(touchBookOpened).toHaveBeenCalledWith('book_123', expect.any(Number));
    const openedTs = (touchBookOpened as jest.Mock).mock.calls[0]?.[1] as number;
    expect(openedTs).toBeGreaterThan(1000);

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch02_p0001', charOffset: 0 },
        chapterId: 'ch02',
        page: 8,
        pageCount: 13,
        chapterPage: 3,
        chapterPageCount: 6,
        bookProgress: 7 / 12,
      });
    });

    // P3-3: 7/12 = 58.33% -> 58%, matching LibraryScreen (not page/pageCount = 62%)
    const runningNumbers = getByText('8 / 13 · 58%');
    expect(runningNumbers.props.numberOfLines).toBe(1);
    const runningNumbersStyle = ReactNative.StyleSheet.flatten(runningNumbers.props.style) as Record<
      string,
      unknown
    >;
    expect(runningNumbersStyle.opacity).toBe(0.6);
    expect(runningNumbersStyle.flexShrink).toBe(0);

    const runningChapterText = getByTestId('reader-running-chapter');
    expect(runningChapterText.props.numberOfLines).toBe(1);
    expect(runningChapterText.props.ellipsizeMode).toBe('tail');
    const runningChapterStyle = ReactNative.StyleSheet.flatten(
      runningChapterText.props.style,
    ) as Record<string, unknown>;
    expect(runningChapterStyle.opacity).toBe(0.6);

    // P3-6: no "اضغط الشريطة لحفظ الصفحة" hint in HUD footer
    await act(async () => {
      emitWebMessage({ type: 'tap', zone: 'center' });
    });
    expect(queryByText('اضغط الشريطة لحفظ الصفحة')).toBeNull();

    // P3-9: HUD footer chapter title & counter flex cleanly
    const hudChapter = getByTestId('reader-chapter-title');
    expect(hudChapter.props.numberOfLines).toBe(1);
    expect(hudChapter.props.ellipsizeMode).toBe('tail');
    const hudCounter = getByTestId('reader-page-counter');
    expect(hudCounter.props.numberOfLines).toBe(1);
    expect(
      (ReactNative.StyleSheet.flatten(hudCounter.props.style) as Record<string, unknown>).flexShrink,
    ).toBe(0);
  });

  it('auto-fades the first-open hint after 5 seconds (A2)', async () => {
    mockKv.clear();
    jest.useFakeTimers();
    const screen = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
    });

    await waitFor(() => expect(screen.getByTestId('reader-hud-hint')).toBeTruthy());

    await act(async () => {
      jest.advanceTimersByTime(5400);
    });

    expect(screen.queryByTestId('reader-hud-hint')).toBeNull();
    jest.useRealTimers();
  });

  it('opens quick theme popover from reader header, applies theme live, and closes popover (A7)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId, queryByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    expect(queryByTestId('reader-theme-popover')).toBeNull();
    await fireEvent.press(getByTestId('reader-theme-button'));
    expect(getByTestId('reader-theme-popover')).toBeTruthy();

    for (const id of ['warraq', 'sepia', 'burnt-paper', 'oled-crimson']) {
      expect(getByTestId(`theme-quick-${id}`)).toBeTruthy();
    }

    await fireEvent.press(getByTestId('theme-quick-oled-crimson'));
    expect(queryByTestId('reader-theme-popover')).toBeNull();
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { theme: 'oled-crimson' },
    });
    expect(selectManualTheme).toHaveBeenCalledWith('oled-crimson');
  });

  it('removes X close button and closes settings via Android back press and reset resets active tab only (S2, A11)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    let backListener: (() => boolean | null | undefined) | undefined;
    const addListenerSpy = jest
      .spyOn(ReactNative.BackHandler, 'addEventListener')
      .mockImplementation((_event, cb) => {
        backListener = () => cb({} as never);
        return { remove: jest.fn() };
      });

    const { getByTestId, queryByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    await fireEvent.press(getByTestId('reader-settings-button'));
    expect(queryByTestId('settings-close-button')).toBeNull();

    // Change font size and theme, then reset only font tab
    await fireEvent.press(getByTestId('settings-font-size-inc'));
    await fireEvent.press(getByTestId('settings-tab-theme'));
    await fireEvent.press(getByTestId('theme-option-oled-crimson'));
    await fireEvent.press(getByTestId('settings-tab-font'));
    await fireEvent.press(getByTestId('settings-reset-button'));

    expect(resetSection).toHaveBeenCalledWith('font', undefined, 'warraq');
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: expect.objectContaining({ fontSize: 20, fontFamily: 'Noto Naskh Arabic' }),
    });
    expect(JSON.parse(postedToWebView.at(-1)!).partial.theme).toBeUndefined();

    // Android hardware back closes the settings sheet
    expect(backListener).toBeDefined();
    await act(async () => {
      const handled = backListener?.();
      expect(handled).toBe(true);
    });
    expect(queryByTestId('reader-settings-sheet-host')).toBeNull();

    addListenerSpy.mockRestore();
  });
  it('never shows a raw English error to the reader', () => {
    const { readerErrorMessage, READER_OPEN_FAILED_MESSAGE } = jest.requireActual('@/screens/reader-screen');
    expect(readerErrorMessage(new Error("Call to function 'FileSystemFile.text' has been rejected"))).toBe(READER_OPEN_FAILED_MESSAGE);
    expect(readerErrorMessage(new Error('تعذّر العثور على ملف الكتاب.'))).toBe('تعذّر العثور على ملف الكتاب.');
    expect(readerErrorMessage(undefined)).toBe(READER_OPEN_FAILED_MESSAGE);
  });
});
