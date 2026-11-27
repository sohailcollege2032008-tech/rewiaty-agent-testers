import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import * as ReactNative from 'react-native';
import { Dimensions } from 'react-native';

import { ToastOverlay } from '@/components/toast-overlay';
import { ReaderScreen, SCENE_QUEUED_MESSAGE_AR } from '@/screens/reader-screen';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { ensureOfflineFontsDir } from '@/storage/font-assets';
import { DEFAULT_SETTINGS, loadThemePreference } from '@/storage/settings-store';
import { clearToast } from '@/utils/toast';

const postedToWebView: string[] = [];
let capturedOnLoadEnd: (() => void) | undefined;
let capturedOnMessage: ((event: { nativeEvent: { data: string } }) => void) | undefined;

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'book_scene' }),
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
  getBookDir: jest.fn(() => ({ uri: 'file:///mock/document/books/book_scene/' })),
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

const SCENE_PROMPT = {
  setting: 'شاطئ عند الغروب',
  mood: 'هادئ',
  characters: 'نور',
  style: 'حبر ورماد',
};

const SAMPLE_BUNDLE = {
  book: {
    id: 'book_scene',
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
    id: 'book_scene',
    meta: { title: 'حجر الماء', author: 'روايتي', lang: 'ar', dir: 'rtl' },
    chapters: [],
    wordCount: 12,
    parserVersion: 1,
  },
  state: {
    anchor: null,
    progress: 0,
    scenes: [
      {
        id: 'scene_1',
        afterBlockId: 'ch01_p0001',
        caption: 'المشهد الأول',
        prompt: SCENE_PROMPT,
        status: 'idle',
        collapsed: false,
      },
    ],
    updatedAt: 1000,
  },
};

function postedMessages(): Array<Record<string, unknown>> {
  return postedToWebView.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

describe('ReaderScreen F46 scene placeholders bridge', () => {
  let colorSchemeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    postedToWebView.length = 0;
    capturedOnLoadEnd = undefined;
    capturedOnMessage = undefined;
    clearToast();
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

  async function renderReader(ui: ReactElement = <ReaderScreen />) {
    const utils = await render(ui);
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

  function lastSceneUpdate() {
    return postedMessages().filter((message) => message.type === 'scene-update').at(-1);
  }

  it('sends persisted scenes in the load message as scenePlaceholders', async () => {
    await renderReader();

    const loadMsg = JSON.parse(postedToWebView[0]!);
    expect(loadMsg.type).toBe('load');
    expect(loadMsg.scenePlaceholders).toEqual([
      expect.objectContaining({ id: 'scene_1', caption: 'المشهد الأول', status: 'idle' }),
    ]);
  });

  it('omits scenePlaceholders entirely when a pre-F46 state has no scenes', async () => {
    const { scenes: _ignored, ...legacyState } = SAMPLE_BUNDLE.state;
    (readBookBundle as jest.Mock).mockResolvedValue({ ...SAMPLE_BUNDLE, state: legacyState });

    await renderReader();

    const loadMsg = JSON.parse(postedToWebView[0]!);
    expect(loadMsg.type).toBe('load');
    expect(loadMsg).not.toHaveProperty('scenePlaceholders');
  });

  it('updates the prompt on scene-prompt-edit, echoes the placeholder and persists', async () => {
    await renderReader();

    const nextPrompt = { ...SCENE_PROMPT, mood: 'مفعم بالحنين' };
    await act(async () => {
      emit({ type: 'scene-prompt-edit', sceneId: 'scene_1', prompt: nextPrompt });
    });

    expect(lastSceneUpdate()).toEqual(
      expect.objectContaining({
        placeholder: expect.objectContaining({ id: 'scene_1', prompt: nextPrompt }),
      }),
    );

    await waitFor(() =>
      expect(saveBookReaderState).toHaveBeenCalledWith(
        'book_scene',
        expect.objectContaining({
          scenes: [expect.objectContaining({ id: 'scene_1', prompt: nextPrompt })],
        }),
      ),
    );
  });

  it('updates the collapsed flag on scene-toggle-collapse, echoes and persists', async () => {
    await renderReader();

    await act(async () => {
      emit({ type: 'scene-toggle-collapse', sceneId: 'scene_1', collapsed: true });
    });

    expect(lastSceneUpdate()).toEqual(
      expect.objectContaining({
        placeholder: expect.objectContaining({ id: 'scene_1', collapsed: true }),
      }),
    );

    await waitFor(() =>
      expect(saveBookReaderState).toHaveBeenCalledWith(
        'book_scene',
        expect.objectContaining({
          scenes: [expect.objectContaining({ id: 'scene_1', collapsed: true })],
        }),
      ),
    );
  });

  it('queues the scene calmly on scene-generate and shows the Arabic waiting toast', async () => {
    const utils = await renderReader(
      <>
        <ReaderScreen />
        <ToastOverlay />
      </>,
    );

    await act(async () => {
      emit({ type: 'scene-generate', sceneId: 'scene_1', prompt: SCENE_PROMPT });
    });

    expect(lastSceneUpdate()).toEqual(
      expect.objectContaining({
        placeholder: expect.objectContaining({ id: 'scene_1', status: 'queued' }),
      }),
    );
    expect(SCENE_QUEUED_MESSAGE_AR).toBe('في قائمة الانتظار');
    expect(utils.getByText('في قائمة الانتظار')).toBeTruthy();

    await waitFor(() =>
      expect(saveBookReaderState).toHaveBeenCalledWith(
        'book_scene',
        expect.objectContaining({
          scenes: [expect.objectContaining({ id: 'scene_1', status: 'queued' })],
        }),
      ),
    );
  });

  it('ignores an unknown scene id instead of crashing or persisting', async () => {
    await renderReader();

    await act(async () => {
      emit({ type: 'scene-generate', sceneId: 'missing_scene', prompt: SCENE_PROMPT });
    });

    expect(lastSceneUpdate()).toBeUndefined();
    expect(saveBookReaderState).not.toHaveBeenCalled();
  });

  it('preserves saved scenes when a subsequent position update saves reader state', async () => {
    await renderReader();

    await act(async () => {
      emit({ type: 'scene-toggle-collapse', sceneId: 'scene_1', collapsed: true });
    });
    await act(async () => {
      emit({
        type: 'position',
        chapterId: 'ch01',
        page: 2,
        pageCount: 5,
        bookProgress: 0.4,
        estimated: false,
      });
    });

    await waitFor(() =>
      expect(saveBookReaderState).toHaveBeenLastCalledWith(
        'book_scene',
        expect.objectContaining({
          page: 2,
          scenes: [expect.objectContaining({ id: 'scene_1', collapsed: true })],
        }),
      ),
    );
  });

  /**
   * Codex #64 P2 — the debounced scene save used to capture its state 500 ms early, so a
   * bookmark saved in that window was overwritten by the stale snapshot. Waiting past the
   * debounce and reading the LAST write proves the timer wrote the merged state.
   */
  async function waitPastDebounce() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
  }

  function lastSavedState(): Record<string, unknown> {
    const calls = (saveBookReaderState as jest.Mock).mock.calls;
    return calls[calls.length - 1]?.[1] as Record<string, unknown>;
  }

  it('keeps a bookmark added during the debounce window together with the scene edit', async () => {
    const { getByTestId } = await renderReader();

    await act(async () => {
      emit({
        type: 'scene-prompt-edit',
        sceneId: 'scene_1',
        prompt: { ...SCENE_PROMPT, mood: 'مفعم بالحنين' },
      });
    });

    // Bookmark lands before the 500 ms scene debounce flushes.
    await fireEvent.press(getByTestId('reader-bookmark-ribbon'));
    await waitPastDebounce();

    const state = lastSavedState();
    expect(state.scenes).toEqual([
      expect.objectContaining({
        id: 'scene_1',
        prompt: expect.objectContaining({ mood: 'مفعم بالحنين' }),
      }),
    ]);
    expect(state.bookmarkItems).toHaveLength(1);
  });

  it('keeps a highlight added during the debounce window together with the scene edit', async () => {
    const { getByTestId } = await renderReader();

    await act(async () => {
      emit({
        type: 'scene-prompt-edit',
        sceneId: 'scene_1',
        prompt: { ...SCENE_PROMPT, mood: 'مفعم بالحنين' },
      });
    });

    await act(async () => {
      emit({
        type: 'selection',
        selection: {
          anchor: { blockId: 'ch01_p0001', charOffset: 0 },
          length: 10,
          quote: 'كَانَتْ نُورُ',
          contextBefore: '',
          contextAfter: ' تَعْرِفُ',
          chapterId: 'ch01',
          rect: { left: 100, top: 240, right: 260, bottom: 270, width: 160, height: 30 },
        },
      });
    });
    // Highlight lands before the 500 ms scene debounce flushes.
    await fireEvent.press(getByTestId('highlight-color-gold'));
    await waitPastDebounce();

    const state = lastSavedState();
    expect(state.scenes).toEqual([
      expect.objectContaining({
        id: 'scene_1',
        prompt: expect.objectContaining({ mood: 'مفعم بالحنين' }),
      }),
    ]);
    expect(state.highlights).toEqual([
      expect.objectContaining({ color: 'gold', quote: 'كَانَتْ نُورُ' }),
    ]);
  });
});
