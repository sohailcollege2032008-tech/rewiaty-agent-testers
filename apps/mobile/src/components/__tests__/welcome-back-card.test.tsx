import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { CTA_MIN_HEIGHT, SWIPE_DISMISS_PX, WelcomeBackCard } from '@/components/welcome-back-card';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { WelcomeBackRecap } from '@/utils/welcome-back';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const RECAP: WelcomeBackRecap = {
  awayMs: 4 * 24 * 60 * 60 * 1000,
  awayLabel: 'غبت ٤ أيام',
  chapterTitle: 'الفصل الأول',
  paragraphs: [
    'وَعَادَ الصَّيَّادُونَ يَجُرُّونَ شِبَاكَهُمْ إِلَى الشَّاطِئِ.',
    'ثُمَّ أَشْرَقَتِ الشَّمْسُ عَلَى الْمَدِينَةِ الْقَدِيمَةِ.',
  ],
  mark: {
    kind: 'note',
    label: 'آخر ملاحظة',
    quote: 'وَعَادَ الصَّيَّادُونَ',
    note: 'جملة تستاهل الوقفة',
    chapterTitle: 'الفصل الأول',
  },
};

const RECAP_WITHOUT_MARK: WelcomeBackRecap = { ...RECAP, mark: null };

describe('WelcomeBackCard', () => {
  it('renders the Arabic header, away duration, chapter and last paragraphs', async () => {
    const { getByTestId, getByText } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={jest.fn()} />,
    );

    expect(getByTestId('welcome-back-card')).toBeTruthy();
    expect(getByText('فين كنا واقفين؟')).toBeTruthy();
    expect(getByText('غبت ٤ أيام · الفصل الأول')).toBeTruthy();
    expect(getByText(RECAP.paragraphs[0]!)).toBeTruthy();
    expect(getByText(RECAP.paragraphs[1]!)).toBeTruthy();
  });

  it('renders the latest mark callout with its quote and note', async () => {
    const { getByTestId, getByText } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={jest.fn()} />,
    );

    expect(getByTestId('welcome-back-mark')).toBeTruthy();
    expect(getByText('آخر ملاحظة')).toBeTruthy();
    expect(getByText('«وَعَادَ الصَّيَّادُونَ»')).toBeTruthy();
    expect(getByText('جملة تستاهل الوقفة')).toBeTruthy();
  });

  it('omits the callout when there is no bookmark or highlight', async () => {
    const { queryByTestId } = await render(
      <WelcomeBackCard recap={RECAP_WITHOUT_MARK} theme="warraq" onDismiss={jest.fn()} />,
    );
    expect(queryByTestId('welcome-back-mark')).toBeNull();
  });

  it('dismisses on a single tap anywhere on the card', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={onDismiss} />,
    );
    await fireEvent.press(getByTestId('welcome-back-card'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a single tap on the «كمّل القراية» button', async () => {
    const onDismiss = jest.fn();
    const { getByTestId, getByText } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={onDismiss} />,
    );
    expect(getByText('كمّل القراية')).toBeTruthy();
    await fireEvent.press(getByTestId('welcome-back-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a single tap on the backdrop', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={onDismiss} />,
    );
    await fireEvent.press(getByTestId('welcome-back-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays readable in the dark theme without Arabic letterSpacing', async () => {
    const dark = getAppThemeTokens('burnt-paper');
    const { getByTestId, getByText } = await render(
      <WelcomeBackCard recap={RECAP} theme="burnt-paper" onDismiss={jest.fn()} />,
    );

    const cardStyle = StyleSheet.flatten(getByTestId('welcome-back-card').props.style) as Record<
      string,
      unknown
    >;
    expect(cardStyle.backgroundColor).toBe(dark.surfaceElevated);

    const titleStyle = StyleSheet.flatten(getByText('فين كنا واقفين؟').props.style) as Record<
      string,
      unknown
    >;
    expect(titleStyle.writingDirection).toBe('rtl');
    expect(titleStyle.textAlign).toBe('right');
    expect(titleStyle.letterSpacing).toBeUndefined();

    const paragraphStyle = StyleSheet.flatten(getByText(RECAP.paragraphs[0]!).props.style) as Record<
      string,
      unknown
    >;
    expect(paragraphStyle.writingDirection).toBe('rtl');
    expect(paragraphStyle.letterSpacing).toBeUndefined();
  });

  it('renders immediately when animation is disabled', async () => {
    const { getByTestId } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" disableAnimation onDismiss={jest.fn()} />,
    );
    expect(getByTestId('welcome-back-card')).toBeTruthy();
  });

  it('bounds its height inside the safe area and scrolls only the excerpt (Codex P2)', async () => {
    const { getByTestId } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={jest.fn()} />,
    );

    const card = getByTestId('welcome-back-card');
    const cardStyle = StyleSheet.flatten(card.props.style) as Record<string, unknown>;
    expect(typeof cardStyle.maxHeight).toBe('number');
    expect(cardStyle.maxHeight as number).toBeGreaterThan(0);

    // The excerpt body is the scrollable part…
    const scroll = getByTestId('welcome-back-scroll');
    expect(scroll).toBeTruthy();
    expect(within(scroll).getByText(RECAP.paragraphs[0]!)).toBeTruthy();
    expect(within(scroll).getByTestId('welcome-back-mark')).toBeTruthy();

    // …while the CTA stays pinned outside it and can never be clipped.
    expect(within(scroll).queryByTestId('welcome-back-dismiss')).toBeNull();
    const ctaStyle = StyleSheet.flatten(
      getByTestId('welcome-back-dismiss').props.style,
    ) as Record<string, unknown>;
    expect(ctaStyle.minHeight as number).toBeGreaterThanOrEqual(48);
    expect(CTA_MIN_HEIGHT).toBeGreaterThanOrEqual(48);
  });

  it('keeps the title pinned above the scrolling excerpt', async () => {
    const { getByTestId, getByText } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={jest.fn()} />,
    );
    const scroll = getByTestId('welcome-back-scroll');
    expect(within(scroll).queryByText('فين كنا واقفين؟')).toBeNull();
    expect(getByText('فين كنا واقفين؟')).toBeTruthy();
  });

  it('dismisses on a horizontal swipe of the backdrop and keeps a short drag inert', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={onDismiss} />,
    );
    const backdrop = getByTestId('welcome-back-backdrop');

    await fireEvent(backdrop, 'touchStart', { nativeEvent: { pageX: 100 } });
    await fireEvent(backdrop, 'touchMove', {
      nativeEvent: { pageX: 100 + SWIPE_DISMISS_PX - 1 },
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await fireEvent(backdrop, 'touchEnd', { nativeEvent: { pageX: 0 } });

    await fireEvent(backdrop, 'touchStart', { nativeEvent: { pageX: 100 } });
    await fireEvent(backdrop, 'touchMove', { nativeEvent: { pageX: 100 + SWIPE_DISMISS_PX } });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a horizontal swipe that starts on the card itself', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(
      <WelcomeBackCard recap={RECAP} theme="warraq" onDismiss={onDismiss} />,
    );
    const card = getByTestId('welcome-back-card');
    await fireEvent(card, 'touchStart', { nativeEvent: { pageX: 200 } });
    await fireEvent(card, 'touchMove', { nativeEvent: { pageX: 200 - SWIPE_DISMISS_PX } });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
