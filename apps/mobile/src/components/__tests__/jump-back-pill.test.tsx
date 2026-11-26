import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { JumpBackPill } from '@/components/jump-back-pill';
import type { JumpOrigin } from '@/utils/jump-back';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const ORIGIN: JumpOrigin = {
  anchor: { blockId: 'ch01_p0001', charOffset: 0 },
  chapterId: 'ch01',
  chapterTitle: 'الفصل الأول',
  page: 42,
  createdAt: 1_000,
};

async function renderPill(overrides: Partial<React.ComponentProps<typeof JumpBackPill>> = {}) {
  const props = {
    origin: ORIGIN,
    dir: 'rtl' as const,
    theme: 'warraq' as const,
    onReturn: jest.fn(),
    onDismiss: jest.fn(),
    ...overrides,
  };
  const utils = await render(<JumpBackPill {...props} />);
  return { ...utils, props };
}

describe('JumpBackPill', () => {
  it('names the page the reader left', async () => {
    const { getByTestId, getByText } = await renderPill();

    expect(getByTestId('jump-back-pill')).toBeTruthy();
    expect(getByText('ارجع لصفحة 42')).toBeTruthy();
  });

  it('falls back to the chapter title when the page is unknown', async () => {
    const { getByText } = await renderPill({ origin: { ...ORIGIN, page: 0 } });

    expect(getByText('ارجع لـ الفصل الأول')).toBeTruthy();
  });

  it('returns the reader to the recorded origin when tapped', async () => {
    const { getByTestId, props } = await renderPill();

    await fireEvent.press(getByTestId('jump-back-pill'));

    expect(props.onReturn).toHaveBeenCalledTimes(1);
    expect(props.onReturn).toHaveBeenCalledWith(ORIGIN);
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it('can be dismissed by hand from the close button', async () => {
    const { getByTestId, props } = await renderPill();

    await fireEvent.press(getByTestId('jump-back-dismiss'));

    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    expect(props.onReturn).not.toHaveBeenCalled();
  });

  it('is a real button for screen readers', async () => {
    const { getByTestId } = await renderPill();
    const pill = getByTestId('jump-back-pill');

    expect(pill.props.accessibilityRole).toBe('button');
    expect(pill.props.accessibilityLabel).toBe('ارجع لصفحة 42');
  });

  it('renders nothing without an origin', async () => {
    const { queryByTestId } = await renderPill({ origin: null });

    expect(queryByTestId('jump-back-pill')).toBeNull();
    expect(queryByTestId('jump-back-pill-host')).toBeNull();
  });

  it('leaves the page underneath touchable: the host strips touches but keeps the pill live', async () => {
    const { getByTestId } = await renderPill();
    const host = getByTestId('jump-back-pill-host');
    const flat = StyleSheet.flatten(host.props.style) as Record<string, unknown>;

    expect(host.props.pointerEvents).toBe('box-none');
    expect(flat.position).toBe('absolute');
    expect(Number(flat.zIndex)).toBe(25);
    expect(Number(flat.bottom)).toBeGreaterThanOrEqual(48);
  });
});
