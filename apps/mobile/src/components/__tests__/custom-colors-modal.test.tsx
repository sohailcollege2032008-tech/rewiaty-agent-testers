import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { CustomColorsModal } from '@/components/custom-colors-modal';
import { contrastRatio, formatContrastRatio, wcagGrade } from '@/theme/wcag';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type ModalProps = React.ComponentProps<typeof CustomColorsModal>;

async function renderModal(overrides: Partial<ModalProps> = {}) {
  const onApply = jest.fn();
  const onDisable = jest.fn();
  const onClose = jest.fn();
  const props: ModalProps = {
    visible: true,
    initialBg: '#FFFFFF',
    initialText: '#000000',
    theme: 'warraq',
    onApply,
    onDisable,
    onClose,
    ...overrides,
  };
  const utils = await render(<CustomColorsModal {...props} />);
  return { ...utils, props, onApply, onDisable, onClose };
}

function badgeText(screen: { getByTestId: (id: string) => { props: Record<string, unknown> } }): string {
  const badge = screen.getByTestId('wcag-contrast-badge');
  return within(badge as never)
    .getAllByText(/.+/)
    .map((node) => String(node.props.children))
    .join(' · ');
}

function previewBackground(screen: { getByTestId: (id: string) => { props: Record<string, unknown> } }): string | undefined {
  const style = StyleSheet.flatten(
    screen.getByTestId('custom-preview-card').props.style as never,
  ) as { backgroundColor?: string } | undefined;
  return style?.backgroundColor;
}

describe('CustomColorsModal (F32)', () => {
  it('shows the live WCAG badge for the opening pair — black on white is 21.0:1 AAA', async () => {
    const screen = await renderModal();

    expect(badgeText(screen)).toContain('21.0:1');
    expect(badgeText(screen)).toContain('AAA');
    expect(screen.getByTestId('custom-preview-card')).toBeTruthy();
    // A full-tashkeel Arabic sentence renders inside the preview, in the picked ink.
    expect(screen.getByTestId('custom-preview-text').props.children).toContain('كَانَ الْبَحْرُ');
    expect(previewBackground(screen)).toBe('#FFFFFF');
  });

  it('warns gently — but still allows applying — when the pair is below AA (4.5:1)', async () => {
    const screen = await renderModal({ initialBg: '#A0A0A0', initialText: '#8E8E8E' });
    const ratio = contrastRatio('#8E8E8E', '#A0A0A0');

    expect(ratio).toBeLessThan(4.5);
    expect(badgeText(screen)).toContain(formatContrastRatio(ratio));
    expect(screen.getByTestId('wcag-contrast-warning')).toBeTruthy();
    // AA-large at worst: still not a blocking error.
    expect(wcagGrade(ratio).level).not.toBe('AAA');

    await fireEvent.press(screen.getByTestId('custom-colors-apply-btn'));
    expect(screen.onApply).toHaveBeenCalledWith({ bg: '#A0A0A0', text: '#8E8E8E' });
  });

  it('updates the preview and the ratio immediately when a swatch is tapped', async () => {
    const screen = await renderModal();

    await fireEvent.press(screen.getByTestId('custom-bg-101820'));
    expect(previewBackground(screen)).toBe('#101820');
    // Dark ink on the new dark paper is now a bad pair — the badge recomputes on the tap itself.
    expect(badgeText(screen)).toContain(formatContrastRatio(contrastRatio('#000000', '#101820')));
    expect(screen.getByTestId('wcag-contrast-warning')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('custom-text-f5f0e6'));
    const goodRatio = contrastRatio('#F5F0E6', '#101820');
    expect(badgeText(screen)).toContain(formatContrastRatio(goodRatio));
    expect(badgeText(screen)).toContain(wcagGrade(goodRatio).labelAr);
    expect(screen.queryByTestId('wcag-contrast-warning')).toBeNull();
  });

  it('accepts a hand-typed hex and normalises it on apply', async () => {
    const screen = await renderModal();

    await fireEvent.changeText(screen.getByTestId('custom-bg-hex-input'), '#101820');
    await fireEvent.changeText(screen.getByTestId('custom-text-hex-input'), '#f2e8d5');

    expect(previewBackground(screen)).toBe('#101820');
    const expected = wcagGrade(contrastRatio('#F2E8D5', '#101820'));
    expect(badgeText(screen)).toContain(formatContrastRatio(contrastRatio('#F2E8D5', '#101820')));
    expect(badgeText(screen)).toContain(expected.labelAr);

    await fireEvent.press(screen.getByTestId('custom-colors-apply-btn'));
    // Stored canonical (uppercase, hash), never what the keyboard happened to produce.
    expect(screen.onApply).toHaveBeenCalledWith({ bg: '#101820', text: '#F2E8D5' });
  });

  it('ignores a half-typed / invalid hex until it becomes a real colour', async () => {
    const screen = await renderModal();

    await fireEvent.changeText(screen.getByTestId('custom-bg-hex-input'), '#12');
    expect(previewBackground(screen)).toBe('#FFFFFF');
    expect(badgeText(screen)).toContain('21.0:1');

    await fireEvent.changeText(screen.getByTestId('custom-bg-hex-input'), '#12345');
    expect(previewBackground(screen)).toBe('#FFFFFF');

    // The 3-digit shorthand is a real colour, so it lands.
    await fireEvent.changeText(screen.getByTestId('custom-bg-hex-input'), '#101');
    expect(previewBackground(screen)).toBe('#110011');
  });

  it('«إلغاء التخصيص» hands the page back to the preset instead of discarding the pair', async () => {
    const screen = await renderModal({ initialBg: '#101820', initialText: '#F2E8D5' });

    await fireEvent.press(screen.getByTestId('custom-colors-disable-btn'));
    expect(screen.onDisable).toHaveBeenCalledTimes(1);
  });

  it('closes without applying when the backdrop is tapped', async () => {
    const screen = await renderModal();

    await fireEvent.press(screen.getByTestId('custom-colors-backdrop'));
    expect(screen.onClose).toHaveBeenCalledTimes(1);
    expect(screen.onApply).not.toHaveBeenCalled();
  });

  it('resets to the stored pair every time it is reopened (a cancelled edit is dropped)', async () => {
    const screen = await renderModal();

    await fireEvent.press(screen.getByTestId('custom-bg-101820'));
    expect(previewBackground(screen)).toBe('#101820');

    await screen.rerender(<CustomColorsModal {...screen.props} visible={false} />);
    await screen.rerender(<CustomColorsModal {...screen.props} visible />);

    expect(previewBackground(screen)).toBe('#FFFFFF');
  });
});
