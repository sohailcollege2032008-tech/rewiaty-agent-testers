import { useEffect, useState } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens, resolveSystemTheme } from '@/theme/reader-theme';
import { subscribeToasts, type ToastPayload } from '@/utils/toast';

/** Non-blocking root toast overlay that persists across screen navigation. */
export function ToastOverlay() {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const palette = getAppThemeTokens(resolveSystemTheme(colorScheme), colorScheme);

  useEffect(() => subscribeToasts(setToast), []);

  if (!toast) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.host,
        { bottom: Math.max(insets.bottom, 20) + 16 },
      ]}
    >
      <View
        testID="app-toast"
        accessibilityLiveRegion="polite"
        style={[
          styles.pill,
          {
            backgroundColor: palette.surfaceElevated,
            borderColor: palette.border,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            { color: palette.text, fontFamily: TYPOGRAPHY.uiFont },
          ]}
          numberOfLines={2}
        >
          {toast.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 100,
  },
  pill: {
    maxWidth: 420,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
  },
  text: {
    fontSize: 13.5,
    fontWeight: '600',
    textAlign: 'center',
  },
});
