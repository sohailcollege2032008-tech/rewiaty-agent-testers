/**
 * F49 long-press dictionary — wired into the reader.
 *
 * Proves three things the L4 QA budget asks for:
 *  1. the toolbar still fits a 360dp phone with the extra «المعجم» action
 *     (left >= 12 and left + width <= 348 in both create and edit mode),
 *  2. the button's effective touch target is at least 48dp,
 *  3. tapping it opens the sheet with the definitions + the CC BY-SA credit,
 *     and an unavailable dictionary says so calmly instead of crashing.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as ReactNative from 'react-native';
import { Dimensions } from 'react-native';

import { ReaderScreen, extractLookupWord } from '@/screens/reader-screen';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { DICTIONARY_ATTRIBUTION, DICTIONARY_UNAVAILABLE_REASON } from '@/storage/dictionary';
import { ensureOfflineFontsDir } from '@/storage/font-assets';
import { DEFAULT_SETTINGS, loadThemePreference } from '@/storage/settings-store';

const postedToWebView: string[] = [];
let capturedOnLoadEnd: (() => void) | undefined;
let capturedOnMessage: ((event: { nativeEvent: { data: string } }) => void) | undefined;

type ReaderRenderResult = Awaited<ReturnType<typeof render>>;

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'book_dict' }),
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
  getBookDir: jest.fn(() => ({ uri: 'file:///mock/document/books/book_dict/' })),
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

jest.mock('@/storage/dictionary', () => {
  const actual = jest.requireActual('@/storage/dictionary');
  return {
    ...actual,
    openBundledDictionaryDb: jest.fn(),
    lookupDictionaryWord: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dictionaryStorage = require('@/storage/dictionary') as {
  openBundledDictionaryDb: jest.Mock;
  lookupDictionaryWord: jest.Mock;
};

const FOUND_RESULT = {
  status: 'found' as const,
  query: 'البحر',
  matchType: 'exact' as const,
  matchedNorm: 'البحر',
  entries: [
    {
      word: 'البحر',
      norm: 'البحر',
      pos: 'اسم',
      root: 'ب ح ر',
      definitions: ['الْمَاءُ الْكَثِيرُ الْمَالِحُ أَوِ الْعَذْبُ.', 'مُصْطَلَحٌ يُطْلَقُ عَلَى مَسَاحَةٍ وَاسِعَةٍ مِنَ الْمَاءِ.'],
    },
  ],
  attribution: DICTIONARY_ATTRIBUTION,
};

const UNAVAILABLE_RESULT = {
  status: 'unavailable' as const,
  query: 'البحر',
  reasonAr: DICTIONARY_UNAVAILABLE_REASON,
  attribution: DICTIONARY_ATTRIBUTION,
};

const SAMPLE_BUNDLE = {
  book: {
    id: 'book_dict',
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
    id: 'book_dict',
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
        note: null,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    updatedAt: 1000,
  },
};

describe('extractLookupWord', () => {
  it('strips diacritics and picks the first Arabic word of a phrase', () => {
    expect(extractLookupWord('تَعْرِفُ الْبَحْرَ قَبْلَ')).toBe('تعرف');
    expect(extractLookupWord('«الْبَحْرُ»')).toBe('البحر');
  });

  it('returns an empty string when there is nothing Arabic to look up', () => {
    expect(extractLookupWord('')).toBe('');
    expect(extractLookupWord('123 — ok')).toBe('');
    expect(extractLookupWord('ب')).toBe('');
  });
});

describe('ReaderScreen F49 dictionary integration', () => {
  let colorSchemeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    postedToWebView.length = 0;
    capturedOnLoadEnd = undefined;
    capturedOnMessage = undefined;
    // 360dp is the narrow phone the L4 budget is written against.
    Dimensions.set({
      window: { width: 360, height: 780, scale: 2, fontScale: 1 },
      screen: { width: 360, height: 780, scale: 2, fontScale: 1 },
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
    dictionaryStorage.openBundledDictionaryDb.mockResolvedValue({ getAllAsync: jest.fn() });
    dictionaryStorage.lookupDictionaryWord.mockResolvedValue(FOUND_RESULT);
  });

  afterEach(() => {
    colorSchemeSpy.mockRestore();
  });

  async function renderReader(props: { qaClient?: unknown; qaResolveByok?: () => Promise<unknown> } = {}) {
    const utils = await render(
      <ReaderScreen
        qaClient={props.qaClient as never}
        qaResolveByok={props.qaResolveByok as never}
      />,
    );
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

  async function selectWord() {
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
  }

  function readToolbarBox(utils: ReaderRenderResult): { left: number; width: number } {
    const positioner = utils.getByTestId('highlight-toolbar');
    const style = StyleSheet.flatten(positioner.props.style) as {
      left: number;
      width?: number;
      maxWidth?: number;
    };
    return { left: style.left, width: style.width ?? style.maxWidth ?? 0 };
  }

  it('fits the toolbar with the dictionary action on a 360dp screen (create mode)', async () => {
    const utils = await renderReader();
    await selectWord();

    expect(utils.getByTestId('highlight-toolbar')).toBeTruthy();
    const { left, width } = readToolbarBox(utils);
    expect(width).toBeLessThanOrEqual(336);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + width).toBeLessThanOrEqual(348);

    // 48dp effective touch target: 48dp box, plus 4dp slop on each side.
    const dictBtn = utils.getByTestId('highlight-dictionary-button');
    const btnStyle = StyleSheet.flatten(dictBtn.props.style) as {
      minHeight?: number;
      minWidth?: number;
    };
    const slop = dictBtn.props.hitSlop as number | undefined;
    expect(Math.min(btnStyle.minWidth ?? 0, btnStyle.minHeight ?? 0)).toBeGreaterThanOrEqual(48);
    expect((btnStyle.minWidth ?? 0) + 2 * (slop ?? 0)).toBeGreaterThanOrEqual(48);
    expect(dictBtn.props.accessibilityLabel).toBe('البحث في المعجم');
  });

  it('fits the toolbar with swatches + note + dictionary + delete (edit mode)', async () => {
    const utils = await renderReader();
    await act(async () => {
      emit({
        type: 'highlight-tap',
        highlightId: 'existing_hl',
        rect: { left: 80, top: 200, right: 190, bottom: 230, width: 110, height: 30 },
      });
    });

    expect(utils.getByTestId('highlight-delete-button')).toBeTruthy();
    expect(utils.getByTestId('highlight-dictionary-button')).toBeTruthy();
    const { left, width } = readToolbarBox(utils);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + width).toBeLessThanOrEqual(348);
  });

  it('opens the dictionary sheet with definitions and the Wiktionary credit', async () => {
    const utils = await renderReader();
    await selectWord();

    await fireEvent.press(utils.getByTestId('highlight-dictionary-button'));

    await waitFor(() => expect(utils.getByTestId('dictionary-sheet')).toBeTruthy());
    // The lookup resolves asynchronously; wait for the found entry, not the placeholder.
    await waitFor(() => expect(utils.getByTestId('dictionary-sheet-pos')).toBeTruthy());
    expect(utils.queryByTestId('dictionary-sheet-empty')).toBeNull();

    expect(dictionaryStorage.lookupDictionaryWord).toHaveBeenCalledWith('تعرف', expect.anything());
    expect(utils.getByTestId('dictionary-sheet-word').props.children).toBe('البحر');
    expect(utils.getByTestId('dictionary-sheet-root')).toBeTruthy();
    expect(utils.getByText(/الْمَاءُ الْكَثِيرُ/)).toBeTruthy();

    const attribution = utils.getByTestId('dictionary-sheet-attribution');
    expect(attribution).toBeTruthy();
    expect(utils.getByText(DICTIONARY_ATTRIBUTION.noticeAr)).toBeTruthy();
    expect(utils.getByText(/CC BY-SA 4\.0/)).toBeTruthy();
    expect(utils.getByText(/ar\.wiktionary\.org/)).toBeTruthy();
  });

  it('explains the selected word with the cutoff at the end of the selection', async () => {
    const blockText = 'كَانَتْ نُورُ تَعْرِفُ الْبَحْرَ قَبْلَ أَنْ تَعْرِفَ اسْمَهُ.';
    const selectedPhrase = 'تَعْرِفُ الْبَحْرَ';
    const selectionStart = blockText.indexOf(selectedPhrase);
    const selectionEnd = selectionStart + selectedPhrase.length;

    const askBookQuestion = jest.fn(async () => ({
      book_id: 'book_dict',
      answer: 'شرح الكلمة من اللي قريته.',
      cutoff_block_id: 'ch01_p0001',
      citations: [],
      cost_usd: 0.0005,
      spoiler_free: true,
    }));
    const utils = await renderReader({
      qaClient: { askBookQuestion },
      qaResolveByok: async () => ({
        mode: 'ephemeral',
        provider: 'openai',
        api_key: 'test-byok-key-fixture',
        model: 'gpt-4.1',
      }),
    });
    await act(async () => {
      emit({
        type: 'selection',
        selection: {
          anchor: { blockId: 'ch01_p0001', charOffset: selectionStart },
          length: selectedPhrase.length,
          quote: selectedPhrase,
          contextBefore: 'كَانَتْ نُورُ ',
          contextAfter: ' قَبْلَ أَنْ',
          chapterId: 'ch01',
          rect: { left: 100, top: 240, right: 260, bottom: 270, width: 160, height: 30 },
        },
      });
    });
    await fireEvent.press(utils.getByTestId('highlight-ai-explain-button'));

    await waitFor(() => expect(askBookQuestion).toHaveBeenCalledTimes(1));
    const body = (
      askBookQuestion.mock.calls[0] as unknown as [
        string,
        {
          up_to_chapter_id: string;
          up_to_block_id: string;
          up_to_char_offset: number;
          context_excerpts: Array<{ block_id: string; text: string }>;
        },
      ]
    )[1];

    // The cutoff is the end of the selection, inside its own block — using the page anchor
    // would have sent offset 0 (no context at all) or stopped before the selected word.
    expect(body.up_to_chapter_id).toBe('ch01');
    expect(body.up_to_block_id).toBe('ch01_p0001');
    expect(body.up_to_char_offset).toBe(selectionEnd);
    const excerpt = body.context_excerpts.find((item) => item.block_id === 'ch01_p0001');
    expect(excerpt?.text).toBe(blockText.slice(0, selectionEnd));
    expect(excerpt?.text).toContain(selectedPhrase);
    expect(excerpt?.text).not.toContain('قَبْلَ');
  });

  it('closes the toolbar selection when the dictionary opens', async () => {
    const utils = await renderReader();
    await selectWord();
    await fireEvent.press(utils.getByTestId('highlight-dictionary-button'));

    expect(utils.queryByTestId('highlight-toolbar')).toBeNull();
    const messages = postedToWebView.map((raw) => JSON.parse(raw));
    expect(messages.some((m) => m.type === 'clear-selection')).toBe(true);
  });

  it('shows the calm unavailable message when no bundled database is present', async () => {
    dictionaryStorage.openBundledDictionaryDb.mockResolvedValue(null);
    dictionaryStorage.lookupDictionaryWord.mockResolvedValue(UNAVAILABLE_RESULT);

    const utils = await renderReader();
    await selectWord();
    await fireEvent.press(utils.getByTestId('highlight-dictionary-button'));

    await waitFor(() => expect(utils.getByTestId('dictionary-sheet-unavailable')).toBeTruthy());
    expect(utils.getByText(DICTIONARY_UNAVAILABLE_REASON)).toBeTruthy();
    expect(utils.getByTestId('dictionary-sheet-attribution')).toBeTruthy();
  });

  it('closes the sheet from its close button', async () => {
    const utils = await renderReader();
    await selectWord();
    await fireEvent.press(utils.getByTestId('highlight-dictionary-button'));
    await waitFor(() => expect(utils.getByTestId('dictionary-sheet')).toBeTruthy());

    await fireEvent.press(utils.getByTestId('dictionary-sheet-close'));
    await waitFor(() => expect(utils.queryByTestId('dictionary-sheet')).toBeNull());
  });
});
