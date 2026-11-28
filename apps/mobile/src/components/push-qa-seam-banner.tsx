/**
 * F38 / #92 — QA-only status banner.
 *
 * Rendered only in a build compiled with `EXPO_PUBLIC_PUSH_QA_SEAM=1`; every normal release has
 * `PUSH_QA_SEAM_ENABLED === false`, so this returns `null` before drawing anything.
 *
 * It is the journey's observable proof: `push-qa:registered` means the real registration function
 * completed with the stubbed OS/API edges, and `push-qa:route:/reader/<id>` is the target the real
 * notification router produced for the intent payload.
 */
import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getPushQaStatusSnapshot,
  PUSH_QA_SEAM_ENABLED,
  subscribePushQaStatus,
} from '@/config/push-qa-seam';

export function PushQaSeamBanner() {
  const insets = useSafeAreaInsets();
  const status = useSyncExternalStore(
    subscribePushQaStatus,
    getPushQaStatusSnapshot,
    getPushQaStatusSnapshot,
  );

  if (!PUSH_QA_SEAM_ENABLED) return null;

  return (
    <View
      testID="qa-push-seam-banner"
      collapsable={false}
      pointerEvents="none"
      style={[styles.host, { top: Math.max(insets.top, 48) + 8 }]}
    >
      <Text testID="qa-push-seam-status" style={styles.text}>
        push-qa:{status.registration}
      </Text>
      {status.route ? (
        <Text testID="qa-push-seam-route" style={styles.text}>
          push-qa:route:{status.route}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 6,
    elevation: 20,
    zIndex: 1000,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 10,
    lineHeight: 13,
  },
});
