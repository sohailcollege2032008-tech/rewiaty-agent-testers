import { type ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { HighlightToolbar } from '@/components/highlight-toolbar';

const RECT = { left: 100, top: 300, right: 220, bottom: 330, width: 120, height: 30 };

async function renderToolbar(
  overrides: Partial<ComponentProps<typeof HighlightToolbar>> = {},
) {
  const onPressAiExplain = jest.fn();
  const utils = await render(
    <HighlightToolbar
      visible
      rect={RECT}
      containerWidth={360}
      containerHeight={800}
      topInset={24}
      bottomInset={20}
      webviewOffsetTop={0}
      theme="warraq"
      onSelectColor={jest.fn()}
      onPressNote={jest.fn()}
      onPressDictionary={jest.fn()}
      onPressAiExplain={onPressAiExplain}
      {...overrides}
    />,
  );
  return { ...utils, onPressAiExplain };
}

describe('HighlightToolbar — F49 «اشرح» secondary action', () => {
  it('offers the AI explain button and calls its handler', async () => {
    const { getByTestId, getByLabelText, onPressAiExplain } = await renderToolbar();

    expect(getByTestId('highlight-ai-explain-button')).toBeTruthy();
    expect(getByLabelText('اشرح السياق بالذكاء الاصطناعي')).toBeTruthy();

    await fireEvent.press(getByTestId('highlight-ai-explain-button'));

    expect(onPressAiExplain).toHaveBeenCalledTimes(1);
  });

  it('hides the AI action when the reader has no handler', async () => {
    const { queryByTestId } = await renderToolbar({ onPressAiExplain: undefined });

    expect(queryByTestId('highlight-ai-explain-button')).toBeNull();
    expect(queryByTestId('highlight-dictionary-button')).toBeTruthy();
  });
});
