import { type ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import {
  DICTIONARY_AI_EXPLAIN_LABEL_AR,
  DICTIONARY_AI_SETTINGS_LABEL_AR,
  DICTIONARY_AI_THINKING_AR,
  DictionarySheet,
  type DictionaryAiExplainState,
} from '@/components/dictionary-sheet';
import { DICTIONARY_ATTRIBUTION, type DictionaryLookupResult } from '@/storage/dictionary';
import {
  STRICT_QA_NO_BYOK_MESSAGE_AR,
  STRICT_QA_OFFLINE_MESSAGE_AR,
} from '@/storage/strict-qa';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const FOUND: DictionaryLookupResult = {
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
      definitions: ['صحائف مجموعة بين غلافين.'],
    },
  ],
  attribution: DICTIONARY_ATTRIBUTION,
};

async function renderSheet(
  aiExplain: DictionaryAiExplainState = { status: 'idle' },
  overrides: Partial<ComponentProps<typeof DictionarySheet>> = {},
) {
  const onPressAiExplain = jest.fn();
  const onOpenAiSettings = jest.fn();
  const onClose = jest.fn();

  const utils = await render(
    <DictionarySheet
      visible
      word="كتاب"
      result={FOUND}
      onClose={onClose}
      onPressAiExplain={onPressAiExplain}
      aiExplain={aiExplain}
      onOpenAiSettings={onOpenAiSettings}
      {...overrides}
    />,
  );

  return { ...utils, onPressAiExplain, onOpenAiSettings, onClose };
}

describe('DictionarySheet — F49 BYOK «اشرح السياق»', () => {
  it('offers the AI explain action as a secondary control', async () => {
    const { getByTestId, getByText, onPressAiExplain } = await renderSheet();

    expect(getByTestId('dictionary-ai-section')).toBeTruthy();
    expect(getByText(DICTIONARY_AI_EXPLAIN_LABEL_AR)).toBeTruthy();

    await fireEvent.press(getByTestId('dictionary-sheet-ai-explain'));

    expect(onPressAiExplain).toHaveBeenCalledTimes(1);
  });

  it('never shows the AI action when the screen does not provide it', async () => {
    const { queryByTestId } = await renderSheet(
      { status: 'idle' },
      { onPressAiExplain: undefined },
    );

    expect(queryByTestId('dictionary-ai-section')).toBeNull();
  });

  it('shows the thinking state while the explanation is being prepared', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderSheet({ status: 'loading' });

    expect(getByText(DICTIONARY_AI_THINKING_AR)).toBeTruthy();
    expect(getByTestId('dictionary-ai-loading')).toBeTruthy();
    // The action is disabled, not removed, so the layout does not jump.
    expect(queryByTestId('dictionary-ai-answer')).toBeNull();
  });

  it('renders the explanation, citations and cost inside the sheet', async () => {
    const { getByTestId, getByText } = await renderSheet({
      status: 'ok',
      explanation: 'الكلمة هنا بمعنى الكتاب اللي بيقراه البطل في أول فصل.',
      citations: [{ block_id: 'ch01_p0004', quote: 'فتح الكتاب على أول صفحة.' }],
      costUsd: 0.002,
    });

    expect(getByTestId('dictionary-ai-answer')).toBeTruthy();
    expect(getByText('الكلمة هنا بمعنى الكتاب اللي بيقراه البطل في أول فصل.')).toBeTruthy();
    expect(getByTestId('dictionary-ai-citations')).toBeTruthy();
    expect(getByTestId('dictionary-ai-cost')).toHaveTextContent('التكلفة $0.0020');
    // The primary dictionary meaning is still visible underneath.
    expect(getByText('صحائف مجموعة بين غلافين.')).toBeTruthy();
  });

  it('shows the add-your-key prompt when BYOK is not configured', async () => {
    const { getByTestId, getByText, onOpenAiSettings } = await renderSheet({
      status: 'no_byok',
      messageAr: STRICT_QA_NO_BYOK_MESSAGE_AR,
    });

    expect(getByTestId('dictionary-ai-message')).toHaveTextContent(STRICT_QA_NO_BYOK_MESSAGE_AR, { exact: false });
    expect(getByText(DICTIONARY_AI_SETTINGS_LABEL_AR)).toBeTruthy();

    await fireEvent.press(getByTestId('dictionary-ai-settings'));

    expect(onOpenAiSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the calm offline sentence', async () => {
    const { getByTestId } = await renderSheet({
      status: 'offline',
      messageAr: STRICT_QA_OFFLINE_MESSAGE_AR,
    });

    expect(getByTestId('dictionary-ai-message')).toHaveTextContent(STRICT_QA_OFFLINE_MESSAGE_AR);
    expect(() => getByTestId('dictionary-ai-settings')).toThrow();
  });
});
