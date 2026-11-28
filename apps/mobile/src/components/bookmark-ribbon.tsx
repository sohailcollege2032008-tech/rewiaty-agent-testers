import { useCallback, useLayoutEffect, useRef } from 'react';
import { Pressable, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Path } from 'react-native-svg';

import {
  RIBBON_TAP_SLOP,
  type RibbonCommit,
  clampRibbonOffset,
  resolveRibbonCommit,
  ribbonCrossesThreshold,
} from '@/utils/bookmark-ribbon';

/** Spring that returns the fabric to rest when the finger lifts. */
const RIBBON_SPRING = { damping: 18, stiffness: 220, mass: 0.6 };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type BookmarkRibbonProps = {
  /** True when the current position already carries a bookmark (the ribbon hangs extended). */
  isBookmarked: boolean;
  positionKey?: string;
  /** Theme's crimson silk. */
  color: string;
  /** Saves or removes the bookmark at the position the reader is on (same callback as tap). */
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
  /** Kept identical to the pre-F24 ribbon so the 48dp touch target holds in both HUD states. */
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
};

/**
 * F24 — the signature crimson bookmark ribbon.
 *
 * Tap keeps the old behaviour (toggle at the current position). The fabric gesture adds two
 * explicit directions: pull DOWN from the corner to save, pull UP on the extended ribbon to
 * remove. Only a release past the threshold commits, and a cancelled gesture never does. The
 * ribbon follows the finger during the drag and springs back to rest afterwards.
 */
export function BookmarkRibbon({
  isBookmarked,
  positionKey = '',
  color,
  onToggle,
  style,
  hitSlop,
}: BookmarkRibbonProps) {
  const pull = useSharedValue(0);
  const armed = useSharedValue(false);
  const livePosition = useSharedValue({ positionKey, isBookmarked });
  const dragPosition = useSharedValue({ positionKey, isBookmarked });
  const latest = useRef({ positionKey, isBookmarked, onToggle });
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    latest.current = { positionKey, isBookmarked, onToggle };
    livePosition.set({ positionKey, isBookmarked });
  }, [livePosition, positionKey, isBookmarked, onToggle]);

  const playTick = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);

  const commit = useCallback((action: RibbonCommit, startKey: string) => {
    const current = latest.current;
    if (current.positionKey !== startKey || action !== (current.isBookmarked ? 'remove' : 'add')) {
      return;
    }
    current.onToggle();
  }, []);

  const handlePressIn = (event: GestureResponderEvent) => {
    pressStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  };
  const handlePress = (event: GestureResponderEvent) => {
    const start = pressStart.current;
    pressStart.current = null;
    const touch = event?.nativeEvent;
    if (start && touch && Math.hypot(touch.pageX - start.x, touch.pageY - start.y) > RIBBON_TAP_SLOP) {
      return;
    }
    onToggle();
  };

  const pan = usePanGesture({
    testID: 'reader-bookmark-ribbon-gesture',
    // A 10pt vertical nudge activates the fabric; the Pressable still owns a clean tap.
    activeOffsetY: [-10, 10],
    failOffsetX: [-10, 10],
    onBegin: () => {
      'worklet';
      dragPosition.set(livePosition.get());
      armed.set(false);
    },
    onActivate: (event) => {
      'worklet';
      armed.set(false);
      pull.set(clampRibbonOffset(event.translationY));
    },
    onUpdate: (event) => {
      'worklet';
      const offset = clampRibbonOffset(event.translationY);
      pull.set(offset);
      // One tick per gesture, played at the crossing (not at release), and only when the pull
      // direction actually means something for the current state.
      const crossed = ribbonCrossesThreshold({
        translationY: offset,
        isBookmarked: dragPosition.get().isBookmarked,
      });
      if (!armed.get() && crossed) {
        armed.set(true);
        scheduleOnRN(playTick);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      const decision = resolveRibbonCommit({
        translationY: event.translationY,
        isBookmarked: dragPosition.get().isBookmarked,
        canceled: event.canceled,
      });
      if (decision !== 'none') {
        scheduleOnRN(commit, decision, dragPosition.get().positionKey);
      }
    },
    onFinalize: () => {
      'worklet';
      pull.set(withSpring(0, RIBBON_SPRING));
    },
  });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pull.get() }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <AnimatedPressable
        testID="reader-bookmark-ribbon"
        onPressIn={handlePressIn}
        onPress={handlePress}
        // Moving past a tap's tolerance cancels the press, so a short drag never toggles by
        // accident — the fabric only commits on its own threshold.
        pressRetentionOffset={RIBBON_TAP_SLOP}
        hitSlop={hitSlop}
        style={[style, dragStyle]}
        accessibilityRole="button"
        accessibilityLabel={isBookmarked ? 'إزالة العلامة المرجعية' : 'حفظ علامة مرجعية'}
        accessibilityState={{ selected: isBookmarked }}
        accessibilityHint="اسحب لأسفل للحفظ، ولأعلى على الشريطة الممدودة للإزالة"
      >
        {isBookmarked ? (
          <Svg
            testID="reader-bookmark-fabric"
            width={18}
            height={42}
            viewBox="0 0 18 42"
            style={{ opacity: 1 }}
          >
            <Path d="M0 0 H18 V42 L9 34 L0 42 Z" fill={color} />
          </Svg>
        ) : null}
      </AnimatedPressable>
    </GestureDetector>
  );
}
