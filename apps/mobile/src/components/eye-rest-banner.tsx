import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import type { AppThemeTokens } from '@/theme/reader-theme';

export const EYE_REST_BANNER_TEXT = 'أرح عينيك ٢٠ ثانية — انظر لنقطة بعيدة';
export const EYE_REST_BANNER_DISMISS = 'تم';

export type EyeRestBannerProps = {
  visible: boolean;
  /** Height of the status bar / notch, so the banner never hides under it. */
  topInset: number;
  palette: AppThemeTokens;
  onDismiss: () => void;
};

/**
 * F31 — «تذكير هادي لراحة العين».
 *
 * Deliberately non-blocking: it never covers the page with a modal, never pauses reading and never
 * steals focus — the reader can keep reading and the banner waits. «تم» (or a tap anywhere on it)
 * starts a fresh 45-minute stretch.
 */
export function EyeRestBanner({ visible, topInset, palette, onDismiss }: EyeRestBannerProps) {
  if (!visible) return null;
  return (
    <Pressable
      testID="eye-rest-banner"
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel={EYE_REST_BANNER_TEXT}
      style={({ pressed }) => [
        styles.wrap,
        {
          top: topInset + 8,
          backgroundColor: palette.surface,
          borderColor: palette.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.body}>
        <Text style={[styles.ornament, { color: palette.accent }]}>✦</Text>
        <Text
          style={[styles.text, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
          numberOfLines={2}
        >
          {EYE_REST_BANNER_TEXT}
        </Text>
      </View>
      <Pressable
        testID="eye-rest-banner-dismiss"
        onPress={onDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        style={({ pressed }) => [
          styles.dismiss,
          { backgroundColor: palette.ctaBg },
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="إخفاء تذكير راحة العين"
      >
        <Text
          style={[styles.dismissText, { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont }]}
        >
          {EYE_REST_BANNER_DISMISS}
        </Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 33,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    boxShadow: '0 10px 26px rgba(0, 0, 0, 0.18)',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ornament: {
    fontSize: 12,
  },
  text: {
    flex: 1,
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'right',
  },
  dismiss: {
    minHeight: 30,
    paddingHorizontal: 14,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 12,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
