import { render } from '@testing-library/react-native';
import { I18nManager, StyleSheet } from 'react-native';

import { ReadingStatsPanel } from '../reading-stats-panel';
import { getAppThemeTokens } from '@/theme/reader-theme';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

const SAMPLE_STATS = {
  version: 1 as const,
  effectiveWpm: 150,
  days: { '2026-11-27': { dateKey: '2026-11-27', activeMs: 300_000, words: 750 } },
};

describe('P2 #60 — RTL alignment, safe-area padding & Arabic labels', () => {
  it('adds bottom safe-area clearance and resolves heading textAlign explicitly for both isRTL=false and isRTL=true (Codex P3)', async () => {
    const originalIsRTL = I18nManager.isRTL;
    try {
      (I18nManager as { isRTL: boolean }).isRTL = false;
      const ltrRender = await render(
        <ReadingStatsPanel stats={SAMPLE_STATS} now={new Date(2026, 10, 27, 12, 0, 0).getTime()} />,
      );
      const scroll = ltrRender.getByTestId('reading-stats-panel');
      const contentStyle = StyleSheet.flatten(scroll.props.contentContainerStyle);
      expect(contentStyle.paddingBottom).toBeGreaterThanOrEqual(62);
      expect(StyleSheet.flatten(ltrRender.getByText('سرعة القراءة').props.style).textAlign).toBe('right');
      ltrRender.unmount();

      (I18nManager as { isRTL: boolean }).isRTL = true;
      const rtlRender = await render(
        <ReadingStatsPanel stats={SAMPLE_STATS} now={new Date(2026, 10, 27, 12, 0, 0).getTime()} />,
      );
      expect(StyleSheet.flatten(rtlRender.getByText('سرعة القراءة').props.style).textAlign).toBe('left');
      rtlRender.unmount();
    } finally {
      (I18nManager as { isRTL: boolean }).isRTL = originalIsRTL;
    }
  });

  it('uses plain Arabic label for dark OLED theme', () => {
    const oled = getAppThemeTokens('oled-crimson');
    expect(oled.labelAr).not.toContain('OLED');
  });
});
