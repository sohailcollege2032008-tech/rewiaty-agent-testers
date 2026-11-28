import { type ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ReaderHud } from '@/components/reader-hud';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

async function renderHud(overrides: Partial<ComponentProps<typeof ReaderHud>> = {}) {
  const onOpenQa = jest.fn();
  const utils = await render(
    <ReaderHud
      visible
      bookTitle="رواية الاختبار"
      chapterTitle="الفصل التاني"
      page={3}
      pageCount={20}
      dir="rtl"
      theme="warraq"
      onBack={jest.fn()}
      onOpenToc={jest.fn()}
      onOpenSettings={jest.fn()}
      onOpenQa={onOpenQa}
      onSeekPage={jest.fn()}
      {...overrides}
    />,
  );
  return { ...utils, onOpenQa };
}

describe('ReaderHud — F49 «اسأل» button', () => {
  it('shows a calm QA button in the header and opens the sheet on tap', async () => {
    const { getByTestId, getByText, onOpenQa } = await renderHud();

    expect(getByTestId('hud-qa-btn')).toBeTruthy();
    expect(getByText('اسأل')).toBeTruthy();

    await fireEvent.press(getByTestId('hud-qa-btn'));

    expect(onOpenQa).toHaveBeenCalledTimes(1);
  });

  it('does not render the QA button when the reader has no QA handler', async () => {
    const { queryByTestId } = await renderHud({ onOpenQa: undefined });

    expect(queryByTestId('hud-qa-btn')).toBeNull();
    // The other HUD actions stay exactly where they were.
    expect(queryByTestId('reader-toc-button')).toBeTruthy();
    expect(queryByTestId('reader-settings-button')).toBeTruthy();
  });
});
