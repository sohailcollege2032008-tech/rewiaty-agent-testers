import { type ComponentProps } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  BOOK_QA_ASK_LABEL_AR,
  BOOK_QA_QUICK_PROMPTS_AR,
  BOOK_QA_SETTINGS_LABEL_AR,
  BookQaSheet,
  type BookQaAnswerView,
} from '@/components/book-qa-sheet';
import {
  STRICT_QA_EMPTY_CONTEXT_MESSAGE_AR,
  STRICT_QA_NO_BYOK_MESSAGE_AR,
  STRICT_QA_OFFLINE_MESSAGE_AR,
} from '@/storage/strict-qa';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const OK_VIEW: BookQaAnswerView = {
  status: 'ok',
  answer: 'بطل الحكاية ظهر في السوق ولسه مفيش حاجة عن اللي جاي.',
  citations: [{ block_id: 'ch01_p0003', quote: 'وقف في آخر السوق ينادي.' }],
  costUsd: 0.0012,
};

async function renderSheet(overrides: Partial<ComponentProps<typeof BookQaSheet>> = {}) {
  const onAsk = jest.fn(async () => OK_VIEW);
  const onClose = jest.fn();
  const onOpenSettings = jest.fn();

  const utils = await render(
    <BookQaSheet
      visible
      chapterTitle="الفصل التاني"
      byokConfigured
      onAsk={onAsk}
      onClose={onClose}
      onOpenSettings={onOpenSettings}
      {...overrides}
    />,
  );

  return { ...utils, onAsk, onClose, onOpenSettings };
}

describe('BookQaSheet — «اسأل عن الكتاب (بدون حرق)»', () => {
  it('shows the spoiler-free scope badge with the reader’s current chapter', async () => {
    const { getByTestId, getByText } = await renderSheet();

    expect(getByTestId('book-qa-spoiler-badge')).toBeTruthy();
    expect(
      getByText('النطاق المسموح: حتى الفصل التاني — بدون حرق للأحداث الجاية'),
    ).toBeTruthy();
    expect(getByText(BOOK_QA_QUICK_PROMPTS_AR[0])).toBeTruthy();
    expect(getByText(BOOK_QA_QUICK_PROMPTS_AR[1])).toBeTruthy();
  });

  it('asks the typed question and shows the answer, citations and cost', async () => {
    const { getByTestId, getByText, onAsk } = await renderSheet();

    await fireEvent.changeText(getByTestId('book-qa-input'), 'مين بطل الحكاية؟');
    await fireEvent.press(getByTestId('book-qa-ask-button'));

    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('مين بطل الحكاية؟'));
    await waitFor(() => expect(getByTestId('book-qa-answer')).toBeTruthy());

    expect(getByTestId('book-qa-answer-text')).toHaveTextContent(
      'بطل الحكاية ظهر في السوق ولسه مفيش حاجة عن اللي جاي.',
    );
    expect(getByTestId('book-qa-citation-0')).toBeTruthy();
    expect(getByTestId('book-qa-citations')).toBeTruthy();
    expect(getByTestId('book-qa-cost')).toHaveTextContent('التكلفة $0.0012');
    expect(getByText(BOOK_QA_ASK_LABEL_AR)).toBeTruthy();
  });

  it('uses a quick starter chip as the question', async () => {
    const { getByTestId, onAsk } = await renderSheet();

    await fireEvent.press(getByTestId('book-qa-quick-0'));

    await waitFor(() => expect(onAsk).toHaveBeenCalledWith(BOOK_QA_QUICK_PROMPTS_AR[0]));
  });

  it('when BYOK is missing: says so and never calls the API', async () => {
    const { getByTestId, getByText, onAsk } = await renderSheet({ byokConfigured: false });

    expect(getByTestId('book-qa-byok-hint')).toBeTruthy();
    expect(getByText(STRICT_QA_NO_BYOK_MESSAGE_AR)).toBeTruthy();

    await fireEvent.changeText(getByTestId('book-qa-input'), 'سؤال');
    await fireEvent.press(getByTestId('book-qa-ask-button'));

    await waitFor(() => expect(getByTestId('book-qa-message')).toBeTruthy());
    expect(getByTestId('book-qa-message')).toHaveTextContent(STRICT_QA_NO_BYOK_MESSAGE_AR, { exact: false });
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('routes the missing-key prompt to AI settings', async () => {
    const { getByTestId, onOpenSettings } = await renderSheet({ byokConfigured: false });

    await fireEvent.press(getByTestId('book-qa-byok-hint-settings'));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('renders an answer whose response carried no citations without crashing', async () => {
    // The endpoint's `citations` is optional in practice; a missing array must render as "no
    // citations", never as a crash on `.length`.
    const onAsk = jest.fn(
      async (): Promise<BookQaAnswerView> =>
        ({
          status: 'ok',
          answer: 'إجابة من غير اقتباسات.',
          costUsd: 0.0004,
        }) as BookQaAnswerView,
    );
    const { getByTestId, queryByTestId } = await renderSheet({ onAsk });

    await fireEvent.changeText(getByTestId('book-qa-input'), 'سؤال');
    await fireEvent.press(getByTestId('book-qa-ask-button'));

    await waitFor(() =>
      expect(getByTestId('book-qa-answer-text')).toHaveTextContent('إجابة من غير اقتباسات.'),
    );
    expect(queryByTestId('book-qa-citations')).toBeNull();
  });

  it('shows the offline hint without pretending an answer exists', async () => {
    const { getByTestId, getByText } = await renderSheet({ offline: true });

    expect(getByTestId('book-qa-offline-hint')).toBeTruthy();
    expect(getByText('السؤال محتاج إنترنت.')).toBeTruthy();
    expect(() => getByTestId('book-qa-answer')).toThrow();
  });

  it('renders an offline answer from the ask result', async () => {
    const onAsk = jest.fn(async (): Promise<BookQaAnswerView> => ({
      status: 'offline',
      messageAr: STRICT_QA_OFFLINE_MESSAGE_AR,
    }));
    const { getByTestId } = await renderSheet({ onAsk });

    await fireEvent.changeText(getByTestId('book-qa-input'), 'سؤال');
    await fireEvent.press(getByTestId('book-qa-ask-button'));

    await waitFor(() =>
      expect(getByTestId('book-qa-message')).toHaveTextContent(STRICT_QA_OFFLINE_MESSAGE_AR),
    );
  });

  it('shows the empty-context message when nothing was read yet', async () => {
    const onAsk = jest.fn(async (): Promise<BookQaAnswerView> => ({
      status: 'empty_context',
      messageAr: STRICT_QA_EMPTY_CONTEXT_MESSAGE_AR,
    }));
    const { getByTestId } = await renderSheet({ onAsk });

    await fireEvent.changeText(getByTestId('book-qa-input'), 'سؤال');
    await fireEvent.press(getByTestId('book-qa-ask-button'));

    await waitFor(() =>
      expect(getByTestId('book-qa-message')).toHaveTextContent(STRICT_QA_EMPTY_CONTEXT_MESSAGE_AR),
    );
  });

  it('validates an empty question locally', async () => {
    const { getByTestId, onAsk } = await renderSheet();

    await fireEvent.press(getByTestId('book-qa-ask-button'));

    expect(onAsk).not.toHaveBeenCalled();
    expect(getByTestId('book-qa-message')).toHaveTextContent('اكتب سؤالك الأول.');
  });

  it('exposes the settings action label for screen readers', async () => {
    const { getByLabelText } = await renderSheet({ byokConfigured: false });
    expect(getByLabelText(BOOK_QA_SETTINGS_LABEL_AR)).toBeTruthy();
  });

  it('closes from the header', async () => {
    const { getByTestId, onClose } = await renderSheet();

    await fireEvent.press(getByTestId('book-qa-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
