import { render } from '@testing-library/react-native';
import { I18nManager, StyleSheet } from 'react-native';

import { ReadingStatsPanel } from '../reading-stats-panel';
import { getAppThemeTokens } from '@/theme/reader-theme';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

describe('P2 #60 — RTL alignment, safe-area padding, and Arabic labels', () => {
  it('adds bottom safe-area clearance and start-aligned headings in ReadingStatsPanel', async () => {
    const { getByTestId, getByText } = await render(
      <ReadingStatsPanel
        stats={{
          version: 1,
          effectiveWpm: 150,
          days: { '2026-11-27': { dateKey: '2026-11-27', activeMs: 300_000, words: 750 } },
        }}
        now={new Date(2026, 10, 27, 12, 0, 0).getTime()}
      />,
    );

    const scroll = getByTestId('reading-stats-panel');
    const contentStyle = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(contentStyle.paddingBottom).toBeGreaterThanOrEqual(62);

    const headingStyle = StyleSheet.flatten(getByText('سرعة القراءة').props.style);
    expect(headingStyle.textAlign).toBe(I18nManager.isRTL ? 'left' : 'right');
  });

  it('uses plain Arabic label for dark OLED theme', () => {
    const oled = getAppThemeTokens('oled-crimson');
    expect(oled.labelAr).not.toContain('OLED');
  });
});
