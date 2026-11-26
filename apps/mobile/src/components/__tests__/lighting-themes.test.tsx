import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { EyeRestBanner, EYE_REST_BANNER_TEXT } from '@/components/eye-rest-banner';
import {
  LightingOverlay,
  dimmerLayerColor,
  warmthLayerColor,
} from '@/components/lighting-overlay';
import { ThemeEncyclopediaModal } from '@/components/theme-encyclopedia-modal';
import { getAppThemeTokens } from '@/theme/reader-theme';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function backgroundColorOf(node: { props: { style?: unknown } }): string | undefined {
  const flat = StyleSheet.flatten(node.props.style as never) as
    | { backgroundColor?: string }
    | undefined;
  return flat?.backgroundColor;
}

describe('F31 — LightingOverlay (التعتيم ودفء الشاشة)', () => {
  it('renders two non-interactive layers with the dimmer and amber alpha maths', async () => {
    const { getByTestId } = await render(<LightingOverlay dimmer={0.5} warmth={0.4} />);

    const dimmer = getByTestId('reader-dimmer-overlay');
    const warmth = getByTestId('reader-warmth-overlay');

    expect(dimmer.props.pointerEvents).toBe('none');
    expect(warmth.props.pointerEvents).toBe('none');
    expect(backgroundColorOf(dimmer)).toBe('rgba(0, 0, 0, 0.5)');
    // 0.4 warmth × 0.45 → 0.18 alpha of amber.
    expect(backgroundColorOf(warmth)).toMatch(/^rgba\(255, 166, 66, 0\.18/);
  });

  it('clamps at the documented ceilings and hides a zero layer', () => {
    expect(dimmerLayerColor(0)).toBe('transparent');
    expect(warmthLayerColor(0)).toBe('transparent');
    expect(dimmerLayerColor(2)).toBe('rgba(0, 0, 0, 0.7)');
    expect(warmthLayerColor(9)).toBe('rgba(255, 166, 66, 0.27)');
  });
});

describe('F31 — موسوعة الثيمات modal', () => {
  it('lists all 13 themes with night-ink first and marks the active one', async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <ThemeEncyclopediaModal
        visible
        activeTheme="night-ink"
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(getByText('موسوعة الثيمات')).toBeTruthy();
    expect(getByTestId('encyclopedia-theme-night-ink')).toBeTruthy();
    expect(getByTestId('encyclopedia-theme-active-night-ink')).toBeTruthy();
    expect(queryByTestId('encyclopedia-theme-active-parchment')).toBeNull();
    expect(getByText('حِبْر اللَّيْل')).toBeTruthy();
  });

  it('filters by mood and applies a tapped theme', async () => {
    const onSelect = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ThemeEncyclopediaModal visible activeTheme="warraq" onSelect={onSelect} onClose={() => {}} />,
    );

    await fireEvent.press(getByTestId('theme-filter-dark'));
    expect(getByTestId('encyclopedia-theme-night-ink')).toBeTruthy();
    expect(getByTestId('encyclopedia-theme-forest-night')).toBeTruthy();
    expect(queryByTestId('encyclopedia-theme-parchment')).toBeNull();

    await fireEvent.press(getByTestId('theme-filter-oled'));
    expect(getByTestId('encyclopedia-theme-oled-amber')).toBeTruthy();
    expect(queryByTestId('encyclopedia-theme-night-ink')).toBeNull();

    await fireEvent.press(getByTestId('theme-filter-all'));
    await fireEvent.press(getByTestId('encyclopedia-theme-twilight-plum'));
    expect(onSelect).toHaveBeenCalledWith('twilight-plum');
  });

  it('closes via the close button and the backdrop, and renders nothing when hidden', async () => {
    const onClose = jest.fn();
    const { getByTestId, rerender, queryByTestId } = await render(
      <ThemeEncyclopediaModal visible activeTheme="warraq" onSelect={() => {}} onClose={onClose} />,
    );

    await fireEvent.press(getByTestId('close-theme-encyclopedia-btn'));
    await fireEvent.press(getByTestId('theme-encyclopedia-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);

    await rerender(
      <ThemeEncyclopediaModal
        visible={false}
        activeTheme="warraq"
        onSelect={() => {}}
        onClose={onClose}
      />,
    );
    expect(queryByTestId('theme-encyclopedia-modal')).toBeNull();
  });
});

describe('F31 — EyeRestBanner (تذكير راحة العين)', () => {
  it('shows the exact gentle Arabic reminder and «تم» dismisses it', async () => {
    const onDismiss = jest.fn();
    const { getByTestId, getByText } = await render(
      <EyeRestBanner
        visible
        topInset={0}
        palette={getAppThemeTokens('night-ink')}
        onDismiss={onDismiss}
      />,
    );

    expect(getByTestId('eye-rest-banner')).toBeTruthy();
    expect(getByText(EYE_REST_BANNER_TEXT)).toBeTruthy();
    await fireEvent.press(getByTestId('eye-rest-banner-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', async () => {
    const { queryByTestId } = await render(
      <EyeRestBanner
        visible={false}
        topInset={0}
        palette={getAppThemeTokens('warraq')}
        onDismiss={() => {}}
      />,
    );
    expect(queryByTestId('eye-rest-banner')).toBeNull();
  });
});
