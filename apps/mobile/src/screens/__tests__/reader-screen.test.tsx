import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Brightness from 'expo-brightness';
import { useKeepAwake } from 'expo-keep-awake';
import * as ReactNative from 'react-native';
import { AppState, Dimensions, Linking, Platform } from 'react-native';

import {
  EDGE_SWIPE_HORIZONTAL_MIN,
  ReaderScreen,
  edgeSwipeIntent,
  edgeSwipePage,
  extractEngineSettingsPartial,
} from '@/screens/reader-screen';
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
/** What `useLocalSearchParams` reports; a search hit opens the reader as `{ id, blockId, charOffset }`. */
let mockSearchParams: { id: string; blockId?: string; charOffset?: string } = {
  id: 'book_123',
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// F24 needs the pan config the ribbon registers, so this suite captures every registered pan
// gesture and drives the ribbon's own one (identified by its testID) by hand.
type MockPanEvent = { translationY: number; canceled?: boolean };
type MockPanConfig = {
  testID?: string;
  onBegin?: (event: MockPanEvent) => void;
  onActivate?: (event: MockPanEvent) => void;
  onUpdate?: (event: MockPanEvent) => void;
  onDeactivate?: (event: MockPanEvent) => void;
  onFinalize?: (event: MockPanEvent) => void;
  [key: string]: unknown;
};
const mockPanGestures: MockPanConfig[] = [];
jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    GestureHandlerRootView: View,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    usePanGesture: (config: MockPanConfig) => {
      mockPanGestures.push(config);
      return {};
    },
    useTapGesture: () => ({}),
    useSimultaneousGestures: () => ({}),
  };
});

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
  getBookRecord: jest.fn(async () => null),
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
    mockSearchParams = { id: 'book_123' };

    Dimensions.set({
      window: { width: 390, height: 844, scale: 2, fontScale: 1 },
      screen: { width: 390, height: 844, scale: 2, fontScale: 1 },
    });
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    // The RN jest mock types `AppState.currentState` as a bare jest.fn; a foreground reader needs
    // the real value or the eye-rest heartbeat treats every tick as backgrounded.
    (ReactNative.AppState as unknown as { currentState: string }).currentState = 'active';

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
        // Opened moments ago: a normal open must never show the F28 welcome-back card.
        updatedAt: Date.now(),
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

  async function openThemeSettingsTab(getByTestId: Awaited<ReturnType<typeof render>>['getByTestId']) {
    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });
    await fireEvent.press(getByTestId('reader-settings-button'));
    await fireEvent.press(getByTestId('settings-tab-theme'));
  }

  function mockStaleBundle(updatedAt: number) {
    (readBookBundle as jest.Mock).mockResolvedValue({
      book: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [
          {
            id: 'ch01',
            title: 'الفصل الأول',
            blocks: [
              {
                id: 'ch01_p0001',
                kind: 'p',
                html: 'كَانَ الْفَجْرُ يَتَسَلَّلُ بِهُدُوءٍ فَوْقَ أَرْصِفَةِ الْمِينَاءِ.',
              },
              {
                id: 'ch01_p0002',
                kind: 'p',
                html: 'وَعَادَ الصَّيَّادُونَ يَجُرُّونَ شِبَاكَهُمْ إِلَى الشَّاطِئِ.',
              },
            ],
            wordCount: 120,
            hash: 'h1',
          },
          { id: 'ch02', title: 'الفصل الثاني', blocks: [], wordCount: 120, hash: 'h2' },
        ],
        footnotes: {},
        wordCount: 240,
      },
      manifest: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [],
        wordCount: 240,
        parserVersion: 1,
      },
      state: {
        anchor: { blockId: 'ch01_p0002', charOffset: 0 },
        progress: 0.35,
        chapterId: 'ch01',
        page: 3,
        pageCount: 10,
        bookmarkItems: [
          {
            id: 'bm_1',
            anchor: { blockId: 'ch01_p0001', charOffset: 0 },
            chapterId: 'ch01',
            chapterTitle: 'الفصل الأول',
            quote: 'كَانَ الْفَجْرُ يَتَسَلَّلُ',
            contextBefore: '',
            contextAfter: 'بِهُدُوءٍ',
            page: 1,
            createdAt: updatedAt - 1_000,
          },
        ],
        updatedAt,
      },
    });
  }

  it('shows «فين كنا واقفين؟» when the book state is five days old and hides it on one tap (F28)', async () => {
    mockStaleBundle(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const utils = await renderLoadedReader();

    await waitFor(() => expect(utils.getByTestId('welcome-back-card')).toBeTruthy());
    expect(utils.getByText('فين كنا واقفين؟')).toBeTruthy();
    expect(utils.getByText('غبت ٥ أيام · الفصل الأول')).toBeTruthy();
    expect(utils.getByText('آخر علامة')).toBeTruthy();
    expect(utils.getByText('«كَانَ الْفَجْرُ يَتَسَلَّلُ»')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('welcome-back-card'));
    expect(utils.queryByTestId('welcome-back-card')).toBeNull();
  });

  it('does not show the welcome-back card on a normal fresh open (F28)', async () => {
    const utils = await renderLoadedReader();
    expect(utils.queryByTestId('welcome-back-card')).toBeNull();
  });

  it('does not show the welcome-back card when the book is opened on a search result (Codex P2)', async () => {
    // A reader who has been away for days taps a search hit: they asked for that passage, not
    // for a recap, so the card must never cover the result they navigated to.
    mockSearchParams = { id: 'book_123', blockId: 'ch01_p0002', charOffset: '0' };
    mockStaleBundle(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const utils = await renderLoadedReader();

    expect(utils.queryByTestId('welcome-back-card')).toBeNull();
    // The search anchor is still honoured: it is the position the engine is asked to show.
    await waitFor(() => expect(postedToWebView.length).toBeGreaterThan(0));
    const load = postedToWebView
      .map((raw) => JSON.parse(raw) as { type: string; anchor?: { blockId?: string } })
      .find((msg) => msg.type === 'load');
    expect(load?.anchor?.blockId).toBe('ch01_p0002');
  });

  it('dismisses the welcome-back card once the reader turns a page (F28)', async () => {
    mockStaleBundle(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const utils = await renderLoadedReader();

    await waitFor(() => expect(utils.getByTestId('welcome-back-card')).toBeTruthy());

    // The first position is the engine reporting where the book already was; it must not
    // dismiss the card. A real page turn (a changed page key) does.
    await act(async () => {
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch01_p0002', charOffset: 0 },
        chapterId: 'ch01',
        page: 3,
        pageCount: 10,
        chapterPage: 3,
        chapterPageCount: 5,
        bookProgress: 0.35,
      });
    });
    expect(utils.getByTestId('welcome-back-card')).toBeTruthy();

    await act(async () => {
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch01_p0002', charOffset: 40 },
        chapterId: 'ch01',
        page: 4,
        pageCount: 10,
        chapterPage: 4,
        chapterPageCount: 5,
        bookProgress: 0.45,
      });
    });
    expect(utils.queryByTestId('welcome-back-card')).toBeNull();
  });

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

  it('does not call a figure with no box a proof', async () => {
    const utils = await renderLoadedReader();

    // The proof means "a reader can see this figure", not "a file resolved": a decoded image that
    // laid out to nothing must not satisfy the import assertion.
    await act(async () => {
      emitWebMessage({ type: 'image-rendered', count: 1, width: 0, height: 0 });
    });

    expect(utils.queryByTestId('reader-image-proof')).toBeNull();
    expect(utils.getByTestId('reader-image-error')).toBeTruthy();
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
      settings: { ...DEFAULT_SETTINGS, theme: 'sepia', autoThemeMode: 'manual' },
      hasManualTheme: true,
    });
    await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.settings.theme).toBe('sepia');
  });

  it('reopens in «حسب الجهاز» from the stored mode, not from a stale manual theme (P1)', async () => {
    // Codex F31 review P1: a manual theme used to win on reopen even after the reader switched
    // back to «حسب الجهاز», because the legacy `hasManualTheme` boolean decided here.
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, theme: 'sepia', autoThemeMode: 'system' },
      hasManualTheme: true,
    });
    await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.settings.autoThemeMode).toBe('system');
    expect(loadPayload.settings.theme).toBe('warraq');
  });

  it('reopens on the saved theme in «يدوي» mode even when the device is dark (P1)', async () => {
    colorSchemeSpy.mockReturnValue('dark');
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, theme: 'parchment', autoThemeMode: 'manual' },
      hasManualTheme: true,
    });
    await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.settings.theme).toBe('parchment');
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

  it('F22: switches to scroll mode, sends the partial, gates the progress-bar switch, and reads chapter progress', async () => {
    const { getByTestId, queryByTestId, getByText } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    await fireEvent.press(getByTestId('reader-settings-button'));
    await fireEvent.press(getByTestId('settings-tab-layout'));

    // The progress-bar switch only makes sense in scroll mode.
    expect(queryByTestId('settings-reading-mode-paginated')).toBeTruthy();
    expect(queryByTestId('settings-scroll-progress-switch')).toBeNull();

    await fireEvent.press(getByTestId('settings-reading-mode-scroll'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { readingMode: 'scroll' },
    });

    const progressSwitch = getByTestId('settings-scroll-progress-switch');
    expect(progressSwitch.props.value).toBe(true);
    await fireEvent(progressSwitch, 'valueChange', false);
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'settings',
      partial: { showScrollProgressBar: false },
    });

    // Scroll positions carry a chapter fraction instead of a page number.
    await act(async () => {
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch02_p0001', charOffset: 0 },
        chapterId: 'ch02',
        page: 6,
        pageCount: 11,
        chapterPage: 3,
        chapterPageCount: 6,
        bookProgress: 0.5,
        chapterProgress: 0.42,
        readingMode: 'scroll',
        spread: false,
      });
    });

    expect(getByText('الفصل 42%')).toBeTruthy();
    // The layer stays usable in scroll mode: the scrubber still maps to page seeks.
    expect(getByTestId('reader-scrubber-track')).toBeTruthy();
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

  it('saves a bookmark by pulling the ribbon down and removes it by pushing the extended ribbon up (F24)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
    });

    const ribbonPan = () => {
      const config = [...mockPanGestures]
        .reverse()
        .find((candidate) => candidate.testID === 'reader-bookmark-ribbon-gesture');
      expect(config).toBeTruthy();
      return config!;
    };

    // A downward pull past the threshold, released cleanly: save at the current position.
    await act(async () => {
      const pan = ribbonPan();
      pan.onBegin?.({ translationY: 0 });
      pan.onActivate?.({ translationY: 12 });
      pan.onUpdate?.({ translationY: 60 });
      pan.onDeactivate?.({ translationY: 60, canceled: false });
      pan.onFinalize?.({ translationY: 60, canceled: false });
    });

    expect(getByTestId('reader-bookmark-ribbon').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_123',
      expect.objectContaining({
        bookmarkItems: [
          expect.objectContaining({ anchor: { blockId: 'ch01_p0003', charOffset: 12 }, page: 2 }),
        ],
      }),
    );

    // The ribbon is extended now: an upward push past the release threshold removes it.
    const callsBeforeRemoval = (saveBookReaderState as jest.Mock).mock.calls.length;
    await act(async () => {
      const pan = ribbonPan();
      pan.onBegin?.({ translationY: 0 });
      pan.onActivate?.({ translationY: -12 });
      pan.onUpdate?.({ translationY: -60 });
      pan.onDeactivate?.({ translationY: -60, canceled: false });
      pan.onFinalize?.({ translationY: -60, canceled: false });
    });

    expect(getByTestId('reader-bookmark-ribbon').props.accessibilityState).toEqual({
      selected: false,
    });
    const removalCalls = (saveBookReaderState as jest.Mock).mock.calls.slice(callsBeforeRemoval);
    expect(removalCalls.some(([, state]) => state.bookmarkItems.length === 0)).toBe(true);
  });

  it('does not save, remove, or tick the haptic on a short ribbon drag or a cancelled one (F24)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
    });

    const panConfig = [...mockPanGestures]
      .reverse()
      .find((candidate) => candidate.testID === 'reader-bookmark-ribbon-gesture');
    expect(panConfig).toBeTruthy();

    const callsBefore = (saveBookReaderState as jest.Mock).mock.calls.length;
    await act(async () => {
      panConfig!.onBegin?.({ translationY: 0 });
      panConfig!.onActivate?.({ translationY: 10 });
      panConfig!.onUpdate?.({ translationY: 26 });
      panConfig!.onDeactivate?.({ translationY: 26, canceled: false });
      panConfig!.onFinalize?.({ translationY: 26, canceled: false });
      panConfig!.onBegin?.({ translationY: 0 });
      panConfig!.onActivate?.({ translationY: 10 });
      panConfig!.onUpdate?.({ translationY: 70 });
      panConfig!.onDeactivate?.({ translationY: 70, canceled: true });
      panConfig!.onFinalize?.({ translationY: 70, canceled: true });
    });

    expect(getByTestId('reader-bookmark-ribbon').props.accessibilityState).toEqual({
      selected: false,
    });
    const bookmarkSaves = (saveBookReaderState as jest.Mock).mock.calls
      .slice(callsBefore)
      .filter(([, state]) => state.bookmarkItems.length > 0);
    expect(bookmarkSaves).toHaveLength(0);
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

    // P3-3 + P2 #60: 7/12 = 58.33% -> 58%, with LRI isolates so RTL BiDi never flips % or ~
    const runningNumbers = getByText('صفحة 8 من 13 · \u206658%\u2069');
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
    // P2 a11y (QA r1) Issue #50: the WebView's #reader-live-region is the single live source
    // for a page turn. A second live region on the counter made TalkBack speak every turn twice.
    expect(hudCounter.props.accessibilityLiveRegion).toBeUndefined();
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
  it('offers «ارجع لصفحة N» after a TOC jump and returns to the page the reader left (F26)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId, queryByTestId, getByText } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch01_p0003', charOffset: 12 },
        chapterId: 'ch01',
        page: 2,
        pageCount: 10,
        bookProgress: 0.2,
      });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    // No pill until the reader actually jumps.
    expect(queryByTestId('jump-back-pill')).toBeNull();

    await fireEvent.press(getByTestId('reader-toc-button'));
    await fireEvent.press(getByTestId('toc-item-ch02'));

    await waitFor(() => expect(getByTestId('jump-back-pill')).toBeTruthy());
    expect(getByText('ارجع لصفحة 2')).toBeTruthy();

    await fireEvent.press(getByTestId('jump-back-pill'));

    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'goto',
      anchor: { blockId: 'ch01_p0003', charOffset: 12 },
    });
    await waitFor(() => expect(queryByTestId('jump-back-pill')).toBeNull());
  });

  it('retires the pill after three page turns in the new spot (F26)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId, queryByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'position', chapterId: 'ch01', page: 2, pageCount: 10, bookProgress: 0.2 });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    await fireEvent.press(getByTestId('reader-toc-button'));
    await fireEvent.press(getByTestId('toc-item-ch02'));
    await waitFor(() => expect(getByTestId('jump-back-pill')).toBeTruthy());

    const turn = (page: number) => ({
      type: 'position' as const,
      chapterId: 'ch02',
      page,
      pageCount: 10,
      chapterPage: page - 2,
      chapterPageCount: 8,
      anchor: { blockId: `ch02_p00${page}`, charOffset: 0 },
      bookProgress: 0.3,
    });

    await act(async () => {
      // The jump's own landing is not a turn…
      emitWebMessage(turn(3));
      // …these two are, and the reader is still on the pill.
      emitWebMessage(turn(4));
      emitWebMessage(turn(5));
    });
    expect(getByTestId('jump-back-pill')).toBeTruthy();

    await act(async () => {
      emitWebMessage(turn(6));
    });
    await waitFor(() => expect(queryByTestId('jump-back-pill')).toBeNull());
  });

  it('does not read background pagination churn as reading in the new spot (F26)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId, queryByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'position', chapterId: 'ch01', page: 2, pageCount: 10, bookProgress: 0.2 });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    await fireEvent.press(getByTestId('reader-toc-button'));
    await fireEvent.press(getByTestId('toc-item-ch02'));
    await waitFor(() => expect(getByTestId('jump-back-pill')).toBeTruthy());

    // The landing, then the engine re-paginating: the global page number climbs while the reader
    // is still on the same chapter page and the same text block. That is not reading.
    const report = (page: number) => ({
      type: 'position' as const,
      chapterId: 'ch02',
      page,
      pageCount: 10,
      chapterPage: 1,
      chapterPageCount: 8,
      anchor: { blockId: 'ch02_p0001', charOffset: 0 },
      bookProgress: 0.3,
    });

    await act(async () => {
      emitWebMessage(report(3));
      emitWebMessage(report(4));
      emitWebMessage(report(5));
      emitWebMessage(report(6));
      emitWebMessage(report(7));
    });

    await waitFor(() => expect(getByTestId('jump-back-pill')).toBeTruthy());
    // …and a real page turn in the new spot still retires it.
    await act(async () => {
      emitWebMessage({ ...report(8), chapterPage: 2, anchor: { blockId: 'ch02_p0002', charOffset: 0 } });
      emitWebMessage({ ...report(9), chapterPage: 3, anchor: { blockId: 'ch02_p0003', charOffset: 0 } });
      emitWebMessage({ ...report(10), chapterPage: 4, anchor: { blockId: 'ch02_p0004', charOffset: 0 } });
    });
    await waitFor(() => expect(queryByTestId('jump-back-pill')).toBeNull());
  });

  it('never lets the pill sit on top of the settings sheet (F26)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    const { getByTestId, queryByTestId } = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'position', chapterId: 'ch01', page: 2, pageCount: 10, bookProgress: 0.2 });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    await fireEvent.press(getByTestId('reader-toc-button'));
    await fireEvent.press(getByTestId('toc-item-ch02'));
    await waitFor(() => expect(getByTestId('jump-back-pill')).toBeTruthy());

    await fireEvent.press(getByTestId('reader-settings-button'));
    await waitFor(() => expect(queryByTestId('jump-back-pill')).toBeNull());

    await fireEvent.press(getByTestId('settings-dismiss-backdrop'));
    await waitFor(() => expect(getByTestId('jump-back-pill')).toBeTruthy());
  });

  it('offers the saved reading position as the way back when a book opens on a search hit (F26 / Codex #42 P2)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);
    // A search result in chapter 2 opens the reader directly on the hit…
    mockSearchParams = { id: 'book_123', blockId: 'ch02_p0005', charOffset: '7' };

    const { getByTestId, getByText } = await renderLoadedReader();

    // …the book still remembers the page the reader was actually reading (ch01, page 2)…
    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.anchor).toEqual({ blockId: 'ch02_p0005', charOffset: 7 });
    await waitFor(() => expect(getByTestId('jump-back-pill')).toBeTruthy());
    expect(getByText('ارجع لصفحة 2')).toBeTruthy();

    // …and the pill goes back to that remembered spot, not to the search hit again.
    await fireEvent.press(getByTestId('jump-back-pill'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'goto',
      anchor: { blockId: 'ch01_p0003', charOffset: 12 },
    });
  });

  it('keeps the reader’s place when a new search hit lands in an already-open reader (F26 / Codex #42 P2)', async () => {
    mockKv.clear();
    mockKv.set('reader_hud_hint_seen_v1', true);

    const utils = await renderLoadedReader();

    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch01_p0003', charOffset: 12 },
        chapterId: 'ch01',
        page: 2,
        pageCount: 10,
        bookProgress: 0.2,
      });
    });
    expect(utils.queryByTestId('jump-back-pill')).toBeNull();

    // A second search hit arrives while the reader is open: the goto must not swallow their place.
    mockSearchParams = { id: 'book_123', blockId: 'ch02_p0005', charOffset: '7' };
    // `rerender` runs inside act() itself; nesting another act here makes React warn about overlap.
    await utils.rerender(<ReaderScreen />);

    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'goto',
      anchor: { blockId: 'ch02_p0005', charOffset: 7 },
    });
    await waitFor(() => expect(utils.getByTestId('jump-back-pill')).toBeTruthy());
    expect(utils.getByText('ارجع لصفحة 2')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('jump-back-pill'));
    expect(JSON.parse(postedToWebView.at(-1)!)).toEqual({
      type: 'goto',
      anchor: { blockId: 'ch01_p0003', charOffset: 12 },
    });
  });

  it('sends the saved chapterId to the engine so an empty chapter can be restored (#44)', async () => {
    // An empty chapter has no block to anchor to: the saved anchor is the chapter id itself,
    // and `chapterId` is what lets the engine find it even when the anchor is missing.
    (readBookBundle as jest.Mock).mockResolvedValueOnce({
      book: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [
          { id: 'ch01', title: 'الفصل الأول', blocks: [], wordCount: 100, hash: 'h1' },
          { id: 'ch02', title: 'فصل فارغ', blocks: [], wordCount: 0, hash: 'h2' },
          { id: 'ch03', title: 'الفصل الثالث', blocks: [], wordCount: 120, hash: 'h3' },
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
        anchor: { blockId: 'ch02', charOffset: 0 },
        progress: 0.666667,
        chapterId: 'ch02',
        page: 3,
        pageCount: 4,
        updatedAt: 2000,
      },
    });

    await renderLoadedReader();

    const loadPayload = JSON.parse(postedToWebView[0]!);
    expect(loadPayload.type).toBe('load');
    expect(loadPayload.chapterId).toBe('ch02');
    expect(loadPayload.anchor).toEqual({ blockId: 'ch02', charOffset: 0 });
  });

  it('does not overwrite a saved position with a regressed 0% report before the reader navigates (#44)', async () => {
    (readBookBundle as jest.Mock).mockResolvedValueOnce({
      book: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [
          { id: 'ch01', title: 'الفصل الأول', blocks: [], wordCount: 100, hash: 'h1' },
          { id: 'ch02', title: 'فصل فارغ', blocks: [], wordCount: 0, hash: 'h2' },
          { id: 'ch03', title: 'الفصل الثالث', blocks: [], wordCount: 120, hash: 'h3' },
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
        anchor: { blockId: 'ch02', charOffset: 0 },
        progress: 0.666667,
        chapterId: 'ch02',
        page: 3,
        pageCount: 4,
        updatedAt: 2000,
      },
    });

    await renderLoadedReader();

    jest.useFakeTimers();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
      // The engine failed to restore and reported the start of the book. This must not be
      // written over the reader's real position.
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch01_p0001', charOffset: 0 },
        chapterId: 'ch01',
        page: 1,
        pageCount: 4,
        chapterPage: 1,
        chapterPageCount: 1,
        bookProgress: 0,
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(saveBookReaderState).not.toHaveBeenCalled();

    // A genuine page turn / jump resumes normal persistence immediately.
    await act(async () => {
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch03_p0001', charOffset: 0 },
        chapterId: 'ch03',
        page: 4,
        pageCount: 4,
        chapterPage: 1,
        chapterPageCount: 1,
        bookProgress: 1,
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    jest.useRealTimers();

    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_123',
      expect.objectContaining({
        chapterId: 'ch03',
        page: 4,
        progress: 1,
      }),
    );
  });

  it('Issue #44 (Codex P2): persists 0% immediately when the first position report is an explicit user swipe to page 1', async () => {
    (readBookBundle as jest.Mock).mockResolvedValueOnce({
      book: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [
          { id: 'ch01', title: 'الفصل الأول', blocks: [], wordCount: 100, hash: 'h1' },
          { id: 'ch02', title: 'فصل فارغ', blocks: [], wordCount: 0, hash: 'h2' },
          { id: 'ch03', title: 'الفصل الثالث', blocks: [], wordCount: 120, hash: 'h3' },
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
        anchor: { blockId: 'ch02', charOffset: 0 },
        chapterId: 'ch02',
        page: 2,
        pageCount: 4,
        progress: 0.33,
        updatedAt: 1000,
      },
    });
    (saveBookReaderState as jest.Mock).mockClear();

    await renderLoadedReader();
    jest.useFakeTimers();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({
        type: 'position',
        anchor: { blockId: 'ch01_p0001', charOffset: 0 },
        chapterId: 'ch01',
        page: 1,
        pageCount: 4,
        chapterPage: 1,
        chapterPageCount: 1,
        bookProgress: 0,
        userNavigated: true,
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    jest.useRealTimers();

    expect(saveBookReaderState).toHaveBeenCalledWith(
      'book_123',
      expect.objectContaining({
        chapterId: 'ch01',
        page: 1,
        progress: 0,
      }),
    );
  });

  it('never shows a raw English error to the reader', () => {
    const { readerErrorMessage, READER_OPEN_FAILED_MESSAGE } = jest.requireActual('@/screens/reader-screen');
    expect(readerErrorMessage(new Error("Call to function 'FileSystemFile.text' has been rejected"))).toBe(READER_OPEN_FAILED_MESSAGE);
    expect(readerErrorMessage(new Error('تعذّر العثور على ملف الكتاب.'))).toBe('تعذّر العثور على ملف الكتاب.');
    expect(readerErrorMessage(undefined)).toBe(READER_OPEN_FAILED_MESSAGE);
  });

  it('restores the saved pre-reader brightness on iOS instead of the Android restore call (P2)', async () => {
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, brightnessMode: 'custom', brightness: 0.45 },
      hasManualTheme: false,
    });
    const { getByTestId } = await renderLoadedReader();

    // The custom value is applied after the current device value was captured (mock: 0.8).
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(0.45));
    expect(Brightness.getBrightnessAsync).toHaveBeenCalled();
    const restoreCallsBefore = (Brightness.restoreSystemBrightnessAsync as jest.Mock).mock.calls.length;

    await openThemeSettingsTab(getByTestId);
    await fireEvent(getByTestId('settings-brightness-auto-switch'), 'valueChange', true);

    // iOS has no per-app restore: the saved value must be written back by hand.
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.8));
    expect((Brightness.restoreSystemBrightnessAsync as jest.Mock).mock.calls.length).toBe(
      restoreCallsBefore,
    );
  });

  it('hands the saved brightness back when the reader unmounts on iOS (P2)', async () => {
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, brightnessMode: 'custom', brightness: 0.45 },
      hasManualTheme: false,
    });
    const utils = await renderLoadedReader();
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(0.45));

    utils.unmount();

    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.8));
  });

  it('restores the saved brightness when the app goes to the background on iOS (P2)', async () => {
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, brightnessMode: 'custom', brightness: 0.45 },
      hasManualTheme: false,
    });
    await renderLoadedReader();
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(0.45));

    const listeners = (AppState.addEventListener as jest.Mock).mock.calls.map(
      ([, cb]: [string, (state: string) => void]) => cb,
    );
    expect(listeners.length).toBeGreaterThan(0);

    await act(async () => {
      for (const listener of listeners) listener('background');
    });

    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.8);
  });

  it('never posts React-Native-only lighting fields to the WebView (P2)', async () => {
    const { getByTestId } = await renderLoadedReader();
    await openThemeSettingsTab(getByTestId);
    const postedBefore = postedToWebView.length;

    await fireEvent.press(getByTestId('settings-dimmer-inc'));
    await fireEvent.press(getByTestId('settings-warmth-inc'));
    await fireEvent.press(getByTestId('settings-brightness-inc'));
    await fireEvent(getByTestId('settings-eye-rest-switch'), 'valueChange', false);

    // Dimmer, warmth, brightness and the eye-rest clock only repaint the RN chrome. Posting them
    // re-ran the engine's column layout for nothing.
    expect(postedToWebView.length).toBe(postedBefore);
  });

  it('drops every RN-only comfort key and keeps the real engine fields (P2)', () => {
    const rnOnly = {
      dimmer: 0.2,
      warmth: 0.3,
      brightness: 0.6,
      brightnessMode: 'custom',
      edgeBrightnessSwipe: false,
      eyeRestReminder: false,
      eyeRestIntervalMinutes: 20,
      autoThemeMode: 'manual',
      dayTheme: 'sepia',
      nightTheme: 'oled-crimson',
      nightStartHour: 20,
      nightEndHour: 6,
      scheduleStartHour: 20,
      scheduleEndHour: 6,
    } as never;

    expect(extractEngineSettingsPartial(rnOnly)).toEqual({});
    expect(extractEngineSettingsPartial({ ...(rnOnly as object), fontSize: 22, theme: 'sepia' } as never)).toEqual({
      fontSize: 22,
      theme: 'sepia',
    });
    expect(extractEngineSettingsPartial({})).toEqual({});
  });

  it('retires a visible eye-rest banner the moment the reminder is switched off (P3)', async () => {
    (loadThemePreference as jest.Mock).mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, eyeRestIntervalMinutes: 15 },
      hasManualTheme: false,
    });

    jest.useFakeTimers();
    const { getByTestId, queryByTestId } = await renderLoadedReader();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
    });
    await act(async () => {
      jest.advanceTimersByTime(15 * 60_000 + 1_000);
    });
    expect(queryByTestId('eye-rest-banner')).toBeTruthy();

    await act(async () => {
      emitWebMessage({ type: 'tap', zone: 'center' });
    });
    await fireEvent.press(getByTestId('reader-settings-button'));
    await fireEvent.press(getByTestId('settings-tab-theme'));
    await fireEvent(getByTestId('settings-eye-rest-switch'), 'valueChange', false);

    // Turning the reminder off used to stop only the future clock; the banner already on screen
    // stayed until the reader dismissed it. It must go immediately.
    expect(queryByTestId('eye-rest-banner')).toBeNull();
  });

  it('classifies an edge swipe on the brightness strip by its dominant axis (P2)', () => {
    expect(edgeSwipeIntent(EDGE_SWIPE_HORIZONTAL_MIN + 8, 0)).toBe('horizontal');
    expect(edgeSwipeIntent(-(EDGE_SWIPE_HORIZONTAL_MIN + 8), 0)).toBe('horizontal');
    expect(edgeSwipeIntent(0, 48)).toBe('vertical');
    expect(edgeSwipeIntent(12, 10)).toBe('none');
    // A diagonal that is clearly more vertical belongs to brightness, not the page.
    expect(edgeSwipeIntent(40, 60)).toBe('vertical');
  });

  it('turns the page in the reading direction for a horizontal edge swipe (P2)', () => {
    // RTL: a rightward flick goes forward, matching the book's own page order.
    expect(edgeSwipePage(60, 'rtl')).toBe('next');
    expect(edgeSwipePage(-60, 'rtl')).toBe('prev');
    expect(edgeSwipePage(60, 'ltr')).toBe('prev');
    expect(edgeSwipePage(-60, 'ltr')).toBe('next');
  });

  it('feeds the HUD scrubber a word-weighted chapter timeline with the reader bookmarks and highlights (F29)', async () => {
    // ch01 has 100 words, ch02 has 120: ch02 owns 120/220 of the rail, not half of it.
    const chapterBlocks = {
      ch01: [
        { id: 'ch01_p0001', kind: 'p', html: '<p>أول سطر في الفصل الأول</p>' },
        { id: 'ch01_p0002', kind: 'p', html: '<p>وسطر تاني</p>' },
      ],
      ch02: [
        { id: 'ch02_p0001', kind: 'p', html: '<p>ثم جاءت الريح</p>' },
        { id: 'ch02_p0002', kind: 'p', html: '<p>وسطر تاني في الفصل</p>' },
        { id: 'ch02_p0003', kind: 'p', html: '<p>وسطر تالت في الفصل</p>' },
        { id: 'ch02_p0004', kind: 'p', html: '<p>وسطر رابع في الفصل</p>' },
      ],
    } as const;
    (readBookBundle as jest.Mock).mockResolvedValue({
      book: {
        id: 'book_123',
        meta: { title: 'أوراق البحر', author: 'مؤلف', lang: 'ar', dir: 'rtl' },
        chapters: [
          { id: 'ch01', title: 'الفصل الأول', blocks: chapterBlocks.ch01, wordCount: 100, hash: 'h1' },
          { id: 'ch02', title: 'الفصل الثاني', blocks: chapterBlocks.ch02, wordCount: 120, hash: 'h2' },
        ],
        footnotes: {},
        wordCount: 220,
      },
      manifest: { id: 'book_123', meta: {}, chapters: [], wordCount: 220, parserVersion: 1 },
      state: {
        anchor: { blockId: 'ch02_p0001', charOffset: 0 },
        progress: 0.5,
        chapterId: 'ch02',
        page: 6,
        pageCount: 10,
        updatedAt: 1000,
        bookmarkItems: [
          {
            id: 'bm-ch02',
            anchor: { blockId: 'ch02_p0003', charOffset: 0 },
            chapterId: 'ch02',
            chapterTitle: 'الفصل الثاني',
            quote: 'وسطر تالت',
            contextBefore: '',
            contextAfter: '',
            createdAt: 1,
          },
        ],
        highlights: [
          {
            id: 'hl-ch01',
            anchor: { blockId: 'ch01_p0001', charOffset: 0 },
            length: 5,
            color: 'gold',
            quote: 'أول سطر',
            contextBefore: '',
            contextAfter: '',
            chapterId: 'ch01',
            chapterTitle: 'الفصل الأول',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });

    const { getByTestId } = await renderLoadedReader();
    await act(async () => {
      emitWebMessage({ type: 'ready' });
      emitWebMessage({ type: 'tap', zone: 'center' });
    });

    const flat = (id: string) =>
      (ReactNative.StyleSheet.flatten(getByTestId(id).props.style as never) ?? {}) as {
        left?: string | number;
      };
    const leftPct = (id: string) => parseFloat(String(flat(id).left));

    // One divider between two chapters, at the cumulative word weight of chapter 1 (100/220).
    const tick = getByTestId('timeline-tick-0');
    expect(tick.props.pointerEvents).toBe('none');
    expect(leftPct('timeline-tick-0')).toBeCloseTo((1 - 100 / 220) * 100, 1);

    // RTL: the bookmark in ch02's third block sits at the cumulative TEXT length of the two blocks
    // before it (not at "block 2 of 4"), i.e. 31/67 into the chapter.
    const ch02Lengths = chapterBlocks.ch02.map((block) => block.html.replace(/<[^>]*>/g, '').length);
    const ch02Total = ch02Lengths.reduce((sum, length) => sum + length, 0);
    const ch02Local = (ch02Lengths[0]! + ch02Lengths[1]!) / ch02Total;
    const bookmarkMarker = getByTestId('timeline-marker-bookmark-bm-ch02');
    expect(bookmarkMarker.props.pointerEvents).toBe('none');
    expect(leftPct('timeline-marker-bookmark-bm-ch02')).toBeCloseTo(
      (1 - (100 / 220 + (120 / 220) * ch02Local)) * 100,
      1,
    );

    // The highlight at the very first block of chapter 1 is on the physical right edge in RTL.
    const highlightMarker = getByTestId('timeline-marker-highlight-hl-ch01');
    expect(highlightMarker.props.pointerEvents).toBe('none');
    expect(leftPct('timeline-marker-highlight-hl-ch01')).toBeCloseTo(100, 1);
  });

  it('P2 #60 (Codex P2): isolates ~total and % with LRI..PDI and matches swipe hint to effectiveDir', () => {
    const { formatRunningFooterCounter, getHudHintText } = jest.requireActual('@/screens/reader-screen');
    expect(formatRunningFooterCounter(8, 13, false, 58)).toBe('صفحة 8 من 13 · \u206658%\u2069');
    expect(formatRunningFooterCounter(8, 13, true, 58)).toBe('صفحة 8 من \u2066~13\u2069 · \u206658%\u2069');
    expect(getHudHintText('rtl')).toContain('اسحب لليمين للصفحة الجاية');
    expect(getHudHintText('ltr')).toContain('اسحب لليسار للصفحة الجاية');
  });
});
