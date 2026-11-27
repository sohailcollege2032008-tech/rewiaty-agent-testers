import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ReaderHud } from '@/components/reader-hud';
import { TocModal } from '@/components/toc-modal';
import { buildCustomAppTheme } from '@/theme/custom-theme';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { AppThemeTokens } from '@/theme/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const CUSTOM = buildCustomAppTheme(getAppThemeTokens('warraq'), '#101820', '#F2E8D5');

function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

function hud(overrides: Partial<React.ComponentProps<typeof ReaderHud>> = {}) {
  return render(
    <ReaderHud
      visible
      bookTitle="حَجَرُ الْمَاءِ"
      chapterTitle="الْفَصْلُ الْأَوَّلُ"
      page={3}
      pageCount={20}
      dir="rtl"
      theme="warraq"
      tokens={CUSTOM}
      onBack={jest.fn()}
      onOpenToc={jest.fn()}
      onOpenSettings={jest.fn()}
      onSeekPage={jest.fn()}
      {...overrides}
    />,
  );
}

describe('custom colours in the reader chrome (F32)', () => {
  it('paints the HUD with the custom tokens, not the preset theme', async () => {
    const screen = await hud();

    const header = screen.getByTestId('reader-hud-header');
    expect(flatStyle(header).backgroundColor).toBe(CUSTOM.hudBg);
    expect(flatStyle(screen.getByTestId('reader-hud-footer')).backgroundColor).toBe(CUSTOM.hudBg);

    const title = screen.getByTestId('reader-book-title');
    expect(flatStyle(title).color).toBe(CUSTOM.heading ?? CUSTOM.text);
    // And it is genuinely different from what the preset would have painted.
    expect(CUSTOM.hudBg).not.toBe(getAppThemeTokens('warraq').hudBg);
  });

  it('never marks a preset as active while a custom pair is painting', async () => {
    const screen = await hud({ customColorsActive: true });

    await fireEvent.press(screen.getByTestId('reader-theme-button'));

    // Warraq is the base theme behind the pair, but the page is not Warraq right now.
    expect(screen.getByTestId('theme-quick-warraq').props.accessibilityState).toMatchObject({
      selected: false,
    });
    expect(screen.getByTestId('theme-quick-burnt-paper').props.accessibilityState).toMatchObject({
      selected: false,
    });

    const label = screen.getByText('ورق دافئ');
    expect(flatStyle(label).color).toBe(CUSTOM.text);
  });

  it('still marks the preset when no custom pair is painting', async () => {
    const screen = await hud({ customColorsActive: false, tokens: undefined });
    await fireEvent.press(screen.getByTestId('reader-theme-button'));

    expect(screen.getByTestId('theme-quick-warraq').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('draws the table of contents from the same custom tokens', async () => {
    const tokens: AppThemeTokens = CUSTOM;
    const screen = await render(
      <TocModal
        visible
        chapters={[]}
        activeChapterId=""
        dir="rtl"
        theme="warraq"
        tokens={tokens}
        onSelectChapter={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // The drawer title is the first word-bearing element; its ink is the custom heading.
    expect(flatStyle(screen.getByText('فهرس الفصول')).color).toBe(tokens.heading ?? tokens.text);
    const palette = getAppThemeTokens('warraq');
    expect(tokens.heading).not.toBe(palette.heading);
  });
});
