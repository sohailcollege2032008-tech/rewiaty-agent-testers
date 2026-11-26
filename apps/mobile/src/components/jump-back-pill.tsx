import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';
import { jumpBackLabel, type JumpOrigin } from '@/utils/jump-back';

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IN = Easing.bezier(0.4, 0, 1, 1);
const ENTER_MS = 220;
const EXIT_MS = 160;
/** Sits clear of the quiet running footer (`bottom ~48px`). */
const DEFAULT_BOTTOM = 48;
const UI_FONT = TYPOGRAPHY.uiFont;

// A return arrow drawn pointing right, which is "back" in an Arabic book; LTR mirrors it.
const RETURN_ARROW_PATH = 'M5 10 H19 M14 5 L19 10 L14 15';

export type JumpBackPillProps = {
  /** Where to return to; `null` hides the pill. */
  origin: JumpOrigin | null;
  dir?: 'rtl' | 'ltr';
  theme?: ThemeId;
  onReturn: (origin: JumpOrigin) => void;
  onDismiss: () => void;
  /** Distance from the bottom edge; defaults just above the running footer. */
  bottomOffset?: number;
};

/**
 * F26: a calm floating «ارجع لصفحة N» pill. Only the pill itself takes touches — the host strip is
 * `pointerEvents="box-none"`, so the reading page underneath stays fully interactive.
 */
export function JumpBackPill({
  origin,
  dir = 'rtl',
  theme,
  onReturn,
  onDismiss,
  bottomOffset,
}: JumpBackPillProps) {
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(theme);
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(origin ? 1 : 0);
  const [rendered, setRendered] = useState(origin !== null);

  // Keep the last origin while the exit animation plays, so the label does not blank out.
  const lastOriginRef = useRef<JumpOrigin | null>(origin);
  if (origin) lastOriginRef.current = origin;
  const shownOrigin = origin ?? lastOriginRef.current;

  const exitMs = reducedMotion ? 0 : EXIT_MS;

  useEffect(() => {
    if (origin) {
      setRendered(true);
      progress.set(withTiming(1, { duration: reducedMotion ? 0 : ENTER_MS, easing: EASE_OUT }));
      return;
    }
    if (!rendered) return;
    progress.set(withTiming(0, { duration: exitMs, easing: EASE_IN }));
    const timer = setTimeout(() => setRendered(false), exitMs);
    return () => clearTimeout(timer);
  }, [origin, rendered, reducedMotion, exitMs, progress]);

  const pillStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: p,
      transform: [{ translateY: reducedMotion ? 0 : (1 - p) * 14 }],
    };
  }, [reducedMotion]);

  if (!rendered || !shownOrigin) return null;

  const label = jumpBackLabel(shownOrigin);
  const resolvedBottom = bottomOffset ?? Math.max(insets.bottom, 10) + DEFAULT_BOTTOM;

  return (
    <View
      testID="jump-back-pill-host"
      pointerEvents="box-none"
      style={[styles.host, { bottom: resolvedBottom }]}
    >
      <Animated.View style={pillStyle}>
        <View
          style={[
            styles.pill,
            {
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.border,
              boxShadow: '0 10px 26px rgba(0, 0, 0, 0.18)',
            },
          ]}
        >
          <Pressable
            testID="jump-back-pill"
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onReturn(shownOrigin)}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Svg
              width={16}
              height={16}
              viewBox="0 0 24 20"
              style={dir === 'rtl' ? undefined : styles.mirrored}
            >
              <Path
                d={RETURN_ARROW_PATH}
                fill="none"
                stroke={palette.accent}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text
              style={[styles.label, { color: palette.text, fontFamily: UI_FONT }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </Pressable>
          <Pressable
            testID="jump-back-dismiss"
            accessibilityRole="button"
            accessibilityLabel="إخفاء زر الرجوع"
            hitSlop={10}
            onPress={onDismiss}
            style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
          >
            <Text style={[styles.dismissGlyph, { color: palette.muted }]}>×</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 25,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingStart: 14,
    paddingEnd: 4,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    maxWidth: 320,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    minHeight: 36,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'center',
  },
  dismiss: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissGlyph: {
    fontSize: 18,
    lineHeight: 20,
    opacity: 0.72,
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  pressed: {
    opacity: 0.72,
  },
});
