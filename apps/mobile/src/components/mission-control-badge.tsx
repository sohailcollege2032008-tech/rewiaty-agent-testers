import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { toArabicDigits } from '@/storage/reading-stats';
import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export const MISSION_CONTROL_BADGE_TEST_ID = 'mission-control-badge';
export const MISSION_CONTROL_PULSE_DOT_TEST_ID = 'mission-control-pulse-dot';
export const MISSION_CONTROL_BADGE_COUNT_TEST_ID = 'mission-control-badge-count';

export type MissionControlBadgeProps = {
  activeCount: number;
  /** Defaults to opening `/mission-control`. */
  onPress?: () => void;
  theme?: ThemeId;
};

const PULSE_DURATION_MS = 1800;

/**
 * F48 — the calm mission-control entry point. It only breathes while there is
 * real work in flight; an idle library shows a quiet resting dot, never a badge.
 */
export function MissionControlBadge({ activeCount, onPress, theme }: MissionControlBadgeProps) {
  const router = useRouter();
  const palette = getAppThemeTokens(theme);
  const isActive = activeCount > 0;

  const pulse = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      pulse.value = withRepeat(withTiming(1, { duration: PULSE_DURATION_MS }), -1, true);
    } else {
      pulse.value = 0;
    }
  }, [isActive, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.value * 0.55,
    transform: [{ scale: 1 + pulse.value * 0.16 }],
  }));

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    router.push('/mission-control');
  };

  return (
    <Pressable
      testID={MISSION_CONTROL_BADGE_TEST_ID}
      onPress={handlePress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        isActive ? `مركز المهام — ${activeCount} مهام جارية` : 'مركز المهام'
      }
      style={({ pressed }) => [
        styles.badge,
        {
          borderColor: palette.chipBorder,
          backgroundColor: pressed ? palette.accentSoft : palette.chipBg,
        },
      ]}
    >
      <Animated.View
        testID={isActive ? MISSION_CONTROL_PULSE_DOT_TEST_ID : undefined}
        style={[
          styles.dot,
          { backgroundColor: isActive ? palette.accent : palette.muted },
          isActive ? pulseStyle : styles.dotIdle,
        ]}
      />
      {isActive ? (
        <Text
          testID={MISSION_CONTROL_BADGE_COUNT_TEST_ID}
          style={[
            styles.count,
            { color: palette.text, fontFamily: TYPOGRAPHY.uiFont },
          ]}
        >
          {toArabicDigits(activeCount)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 40,
    minHeight: 40,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: RADIUS.pill,
  },
  dotIdle: {
    opacity: 0.5,
  },
  count: {
    fontSize: 12.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
