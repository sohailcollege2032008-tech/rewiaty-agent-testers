import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AboutScreen from '@/app/about';
import { AboutAttributionCard } from '@/components/about-attribution-card';
import { DictionarySheet } from '@/components/dictionary-sheet';
import {
  buildWiktionaryEntryUrl,
  DICTIONARY_ATTRIBUTION,
  DICTIONARY_DUMP_DATE,
  DICTIONARY_ENTRY_COUNT,
  readBundledDictionaryMeta,
  type DictionaryLookupResult,
} from '@/storage/dictionary';

jest.mock('@/storage/dictionary', () => {
  const actual = jest.requireActual('@/storage/dictionary');
  return {
    ...actual,
    readBundledDictionaryMeta: jest.fn(),
  };
});

const readBundledDictionaryMetaMock = readBundledDictionaryMeta as unknown as jest.Mock;

beforeEach(() => {
  readBundledDictionaryMetaMock.mockReset();
  readBundledDictionaryMetaMock.mockResolvedValue(null);
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/storage/settings-store', () => ({
  DEFAULT_SETTINGS: { theme: 'day' },
  loadThemePreference: async () => ({ settings: { theme: 'day' }, hasManualTheme: false }),
  selectManualTheme: jest.fn(async () => undefined),
}));

const openURL = jest.spyOn(Linking, 'openURL');

const FOUND_EXACT: DictionaryLookupResult = {
  status: 'found',
  query: 'كتاب',
  matchType: 'exact',
  matchedNorm: 'كتاب',
  entries: [
    {
      word: 'كتاب',
      norm: 'كتاب',
      pos: 'اسم',
      root: 'ك ت ب',
      definitions: ['صحائف مجموعة بين غلافين.', 'مجموع ما يُكتب.'],
    },
  ],
  attribution: DICTIONARY_ATTRIBUTION,
};

const FOUND_STEMMED: DictionaryLookupResult = {
  status: 'found',
  query: 'والكتاب',
  matchType: 'stemmed',
  matchedNorm: 'كتاب',
  entries: [
    {
      word: 'كتاب',
      norm: 'كتاب',
      pos: null,
      root: null,
      definitions: ['صحائف مجموعة بين غلافين.'],
    },
  ],
  attribution: DICTIONARY_ATTRIBUTION,
};

const NOT_FOUND: DictionaryLookupResult = {
  status: 'not_found',
  query: 'زقزقة',
  normalized: 'زقزقه',
  attribution: DICTIONARY_ATTRIBUTION,
};

const UNAVAILABLE: DictionaryLookupResult = {
  status: 'unavailable',
  query: 'كتاب',
  reasonAr: 'القاموس غير متاح حالياً على الجهاز.',
  attribution: DICTIONARY_ATTRIBUTION,
};

async function renderSheet(
  overrides: Partial<React.ComponentProps<typeof DictionarySheet>> = {},
) {
  return render(
    <DictionarySheet
      visible
      word="كتاب"
      result={FOUND_EXACT}
      onClose={jest.fn()}
      {...overrides}
    />,
  );
}

describe('DictionarySheet', () => {
  it('shows the headword, POS/root pills, and numbered definitions', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderSheet();

    expect(getByTestId('dictionary-sheet-word')).toBeTruthy();
    expect(getByTestId('dictionary-sheet-pos')).toBeTruthy();
    expect(getByTestId('dictionary-sheet-root')).toBeTruthy();
    expect(getByText('الجذر: ك ت ب')).toBeTruthy();
    expect(getByText('صحائف مجموعة بين غلافين.')).toBeTruthy();
    expect(getByText('مجموع ما يُكتب.')).toBeTruthy();
    expect(queryByTestId('dictionary-sheet-stem-hint')).toBeNull();
  });

  it('shows the stem hint when the match came from a stem', async () => {
    const { getByTestId } = await renderSheet({ result: FOUND_STEMMED, word: 'والكتاب' });

    expect(getByTestId('dictionary-sheet-stem-hint')).toHaveTextContent(
      'عُثر عليها تحت الصيغة: كتاب',
    );
  });

  it('shows a calm empty state when the word is missing', async () => {
    const { getByTestId, getByText } = await renderSheet({
      result: NOT_FOUND,
      word: 'زقزقة',
    });

    expect(getByTestId('dictionary-sheet-empty')).toBeTruthy();
    expect(getByText('لم نعثر على الكلمة في القاموس.')).toBeTruthy();
    expect(getByText('صيغة البحث: زقزقه')).toBeTruthy();
  });

  it('shows the unavailable reason instead of crashing', async () => {
    const { getByTestId, getByText } = await renderSheet({ result: UNAVAILABLE });

    expect(getByTestId('dictionary-sheet-unavailable')).toBeTruthy();
    expect(getByText('القاموس غير متاح حالياً على الجهاز.')).toBeTruthy();
  });

  it('shows a loading state', async () => {
    const { getByTestId, getByText } = await renderSheet({ result: null, loading: true });

    expect(getByTestId('dictionary-sheet-loading')).toBeTruthy();
    expect(getByText('بندوّر على الكلمة…')).toBeTruthy();
  });

  it('always shows the CC BY-SA 4.0 Wiktionary attribution', async () => {
    const { getByTestId, getByText } = await renderSheet();

    expect(getByTestId('dictionary-sheet-attribution')).toBeTruthy();
    expect(getByText(DICTIONARY_ATTRIBUTION.noticeAr)).toBeTruthy();
    expect(getByText(/CC BY-SA 4\.0/)).toBeTruthy();
    expect(getByTestId('dictionary-sheet-attribution')).toHaveTextContent(
      /ar\.wiktionary\.org/,
    );
  });

  it('closes through the close button and backdrop', async () => {
    const onClose = jest.fn();
    const { getByTestId } = await renderSheet({ onClose });

    await fireEvent.press(getByTestId('dictionary-sheet-close'));
    await fireEvent.press(getByTestId('dictionary-sheet-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('links every entry back to its Wiktionary page and contributors history', async () => {
    const { getByTestId, getAllByTestId } = await renderSheet();

    expect(getByTestId('dictionary-sheet-entry-source-0')).toBeTruthy();
    // One row per displayed entry, not one for the whole sheet.
    expect(getAllByTestId(/^dictionary-sheet-entry-source-/)).toHaveLength(1);

    const { pageUrl, historyUrl } = buildWiktionaryEntryUrl('كتاب');
    openURL.mockClear();
    openURL.mockResolvedValue(true as never);

    await fireEvent.press(getByTestId('dictionary-sheet-entry-page-link-0'));
    expect(openURL).toHaveBeenLastCalledWith(pageUrl);
    expect(String(openURL.mock.calls.at(-1)?.[0])).toBe(
      'https://ar.wiktionary.org/wiki/%D9%83%D8%AA%D8%A7%D8%A8',
    );

    await fireEvent.press(getByTestId('dictionary-sheet-entry-history-link-0'));
    expect(openURL).toHaveBeenLastCalledWith(historyUrl);
    expect(String(openURL.mock.calls.at(-1)?.[0])).toContain('action=history');
  });

  it('shows one source row per definition block when several entries match', async () => {
    const multiEntry: DictionaryLookupResult = {
      status: 'found',
      query: 'كتاب',
      matchType: 'exact',
      matchedNorm: 'كتاب',
      entries: [
        { word: 'كتاب', norm: 'كتاب', pos: 'اسم', root: 'ك ت ب', definitions: ['أول.'] },
        { word: 'كتابة', norm: 'كتابه', pos: 'اسم', root: 'ك ت ب', definitions: ['ثاني.'] },
      ],
      attribution: DICTIONARY_ATTRIBUTION,
    };

    const { getByTestId, getAllByTestId, getAllByText } = await renderSheet({
      result: multiEntry,
    });

    expect(getAllByTestId(/^dictionary-sheet-entry-source-/)).toHaveLength(2);
    expect(getByTestId('dictionary-sheet-entry-source-0')).toHaveTextContent(/ويكاموس: كتاب/);
    expect(getByTestId('dictionary-sheet-entry-source-1')).toHaveTextContent(/ويكاموس: كتابة/);
    expect(getAllByText('مساهمو الصفحة', { exact: true })).toHaveLength(2);
  });

  it('does not link anything when the word is missing', async () => {
    const { queryByTestId } = await renderSheet({ result: NOT_FOUND, word: 'زقزقة' });

    expect(queryByTestId('dictionary-sheet-entry-source-0')).toBeNull();
  });
});

describe('AboutAttributionCard', () => {
  it('credits Arabic Wiktionary contributors and keeps CC BY-SA 4.0 terms', async () => {
    const { getByTestId, getByText, getAllByText } = await render(<AboutAttributionCard />);

    expect(getByTestId('about-attribution-card')).toBeTruthy();
    expect(getByText('القاموس: ويكاموس العربي')).toBeTruthy();
    expect(getAllByText(/مساهمي ويكاموس العربي/).length).toBeGreaterThan(0);
    expect(getByText('CC BY-SA 4.0')).toBeTruthy();
    expect(getByText(/بشروطه دون تغيير/)).toBeTruthy();
  });

  it('discloses that entries are extracted, stripped of wiki markup and indexed', async () => {
    const { getByTestId } = await render(<AboutAttributionCard />);

    const disclosure = getByTestId('about-attribution-processing');
    expect(disclosure).toHaveTextContent(/مُستخلصة من ويكاموس العربي/);
    expect(disclosure).toHaveTextContent(/مُنظّفة من ترميز الويكي/);
    expect(disclosure).toHaveTextContent(/مُفهرسة للبحث السريع دون إنترنت/);
    expect(disclosure).toHaveTextContent(/CC BY-SA 4\.0/);
  });

  it('never claims the data is redistributed unmodified or that the app is GPL-3.0', async () => {
    const { queryByText, queryByTestId } = await render(<AboutAttributionCard />);

    expect(queryByText(/دون أي تعديل/)).toBeNull();
    expect(queryByText(/دون تعديل البيانات/)).toBeNull();
    expect(queryByText(/GPL-3\.0/)).toBeNull();
    expect(queryByTestId('about-attribution-processing')).not.toBeNull();
  });

  it('shows the readable license and Wiktionary URLs plus the dump metadata', async () => {
    const { getByText } = await render(<AboutAttributionCard />);

    expect(getByText('https://creativecommons.org/licenses/by-sa/4.0/')).toBeTruthy();
    expect(getByText('https://ar.wiktionary.org')).toBeTruthy();
    expect(getByText(/2026-11-01/)).toBeTruthy();
    expect(getByText(/15735/)).toBeTruthy();
  });

  it('renders the entry count and dump date read live from the bundled database', async () => {
    readBundledDictionaryMetaMock.mockResolvedValue({
      dumpDate: '2031-05-06',
      entryCount: 42137,
    });

    const { getByTestId } = await render(<AboutAttributionCard />);

    await waitFor(() =>
      expect(getByTestId('about-dictionary-meta')).toHaveTextContent(/2031-05-06/),
    );
    expect(getByTestId('about-dictionary-meta')).toHaveTextContent(/42137 مدخل/);
    expect(getByTestId('about-dictionary-meta')).not.toHaveTextContent('15735');
  });

  it('keeps the static fallback metadata when the bundled database is unavailable', async () => {
    readBundledDictionaryMetaMock.mockResolvedValue(null);

    const { getByTestId } = await render(<AboutAttributionCard />);

    await waitFor(() =>
      expect(getByTestId('about-dictionary-meta')).toHaveTextContent(
        new RegExp(`${DICTIONARY_DUMP_DATE} . ${DICTIONARY_ENTRY_COUNT} مدخل`),
      ),
    );
  });

  it('lets explicit props win and skips the database read entirely', async () => {
    readBundledDictionaryMetaMock.mockResolvedValue({
      dumpDate: '2031-05-06',
      entryCount: 42137,
    });

    const { getByTestId } = await render(
      <AboutAttributionCard dumpDate="1999-01-01" entryCount={7} />,
    );

    expect(getByTestId('about-dictionary-meta')).toHaveTextContent(/1999-01-01 . 7 مدخل/);
    expect(readBundledDictionaryMetaMock).not.toHaveBeenCalled();
  });
});

describe('AboutScreen license disclosure', () => {
  it('describes the Expo template MIT notice instead of claiming a GPL-3.0 file', async () => {
    const { getByText, getByTestId, queryByText } = await render(<AboutScreen />);

    expect(getByText('رخصة الكود المصدري')).toBeTruthy();
    expect(getByText(/MIT \(إشعار قالب Expo في apps\/mobile\/LICENSE\)/)).toBeTruthy();
    expect(getByText('رخصة بيانات القاموس')).toBeTruthy();
    expect(getByText(/CC BY-SA 4\.0 \(مساهمو ويكاموس العربي\)/)).toBeTruthy();

    const footnote = getByTestId('about-license-footnote');
    expect(footnote).toHaveTextContent(/apps\/mobile\/LICENSE/);
    expect(footnote).toHaveTextContent(/إشعار MIT الخاص بقالب Expo/);
    expect(footnote).toHaveTextContent(/لا يوجد ملف رخصة مستقل في جذر المستودع/);
    expect(footnote).toHaveTextContent(/مُستخلصة من ويكاموس العربي/);
    expect(footnote).toHaveTextContent(/CC BY-SA 4\.0/);

    expect(queryByText(/GPL-3\.0/)).toBeNull();
    expect(queryByText(/دون أي تعديل/)).toBeNull();
  });
});
