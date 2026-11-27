import { useCallback, useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';
import type { WelcomeBackRecap } from '@/utils/welcome-back';

export type WelcomeBackCardProps = {
  recap: WelcomeBackRecap;
  theme?: ThemeId;
  dir?: 'rtl' | 'ltr';
  disableAnimation?: boolean;
  /** A single tap anywhere (card, backdrop or CTA) dismisses the card for this open. */
  onDismiss: () => void;
};

const ANIMATION_MS = 240;
/** A horizontal drag this far dismisses the card as well, like swiping a sheet away. */
export const SWIPE_DISMISS_PX = 24;
/** Breathing room between the card and the safe-area edges (Codex P2). */
const SAFE_AREA_GAP = 16;
const MIN_CARD_HEIGHT = 220;
/** The CTA must stay a comfortable, always-visible target on a short screen or 200% font. */
export const CTA_MIN_HEIGHT = 48;

function readTouchPageX(event: GestureResponderEvent): number | null {
  const native = event?.nativeEvent;
  if (!native) return null;
  if (typeof native.pageX === 'number' && Number.isFinite(native.pageX)) return native.pageX;
  const touch = native.touches?.[0];
  return typeof touch?.pageX === 'number' && Number.isFinite(touch.pageX) ? touch.pageX : null;
}

/**
 * F28 — a warm, quiet floating card shown once when a reader comes back to a book after more
 * than three days. It never traps the reader: any tap or a horizontal swipe dismisses it, and
 * once dismissed the page underneath is completely free.
 *
 * The card is height-bounded inside the safe area and only its excerpt body scrolls, so the
 * «كمّل القراية» button can never be pushed off a short screen or a large system font.
 */
export function WelcomeBackCard({
  recap,
  theme,
  dir = 'rtl',
  disableAnimation = false,
  onDismiss,
}: WelcomeBackCardProps) {
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';
  const textAlign = isRtl ? 'right' : 'left';
  const writingDirection = isRtl ? 'rtl' : 'ltr';
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // Never taller than the space actually available between the safe-area edges.
  const maxCardHeight = Math.max(
    MIN_CARD_HEIGHT,
    Math.round(windowHeight - (insets.top + SAFE_AREA_GAP) - (insets.bottom + SAFE_AREA_GAP)),
  );

  // A light horizontal-swipe detector: a quick tap still goes through Pressable's `onPress`,
  // while a horizontal drag of SWIPE_DISMISS_PX or more dismisses the card.
  const swipeStartXRef = useRef<number | null>(null);
  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    swipeStartXRef.current = readTouchPageX(event);
  }, []);
  const handleTouchMove = useCallback(
    (event: GestureResponderEvent) => {
      const startX = swipeStartXRef.current;
      if (startX === null) return;
      const currentX = readTouchPageX(event);
      if (currentX === null) return;
      if (Math.abs(currentX - startX) >= SWIPE_DISMISS_PX) {
        swipeStartXRef.current = null;
        onDismiss();
      }
    },
    [onDismiss],
  );
  const handleTouchEnd = useCallback(() => {
    swipeStartXRef.current = null;
  }, []);

  const appear = useSharedValue(disableAnimation ? 1 : 0);
  useEffect(() => {
    appear.set(withTiming(1, { duration: disableAnimation ? 0 : ANIMATION_MS }));
  }, [appear, disableAnimation]);

  const animatedStyle = useAnimatedStyle(() => {
    const value = appear.get();
    return {
      opacity: value,
      transform: [{ translateY: (1 - value) * 18 }],
    };
  });

  return (
    <View testID="welcome-back-overlay" pointerEvents="box-none" style={styles.host}>
      <Pressable
        testID="welcome-back-backdrop"
        accessibilityRole="button"
        accessibilityLabel="إغلاق ملخص العودة"
        onPress={onDismiss}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={[styles.backdrop, { backgroundColor: palette.scrim }]}
      />

      <Animated.View
        pointerEvents="box-none"
        style={[styles.cardWrap, { maxHeight: maxCardHeight }, animatedStyle]}
      >
        <Pressable
          testID="welcome-back-card"
          accessibilityRole="button"
          accessibilityLabel="فين كنا واقفين؟ اضغط لمتابعة القراية"
          onPress={onDismiss}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          style={[
            styles.card,
            {
              maxHeight: maxCardHeight,
              backgroundColor: palette.surfaceElevated,
              borderColor: palette.border,
            },
          ]}
        >
          <View style={[styles.headerRow, { flexDirection: isRtl ? 'row-reverse' : 'row' }]}>
            <Text style={[styles.ornament, { color: palette.accent }]}>✦</Text>
            <Text
              style={[
                styles.title,
                {
                  color: palette.text,
                  fontFamily: TYPOGRAPHY.uiFont,
                  textAlign,
                  writingDirection,
                },
              ]}
            >
              فين كنا واقفين؟
            </Text>
          </View>

          <Text
            testID="welcome-back-away"
            style={[
              styles.away,
              {
                color: palette.muted,
                fontFamily: TYPOGRAPHY.uiFont,
                textAlign,
                writingDirection,
              },
            ]}
          >
            {`${recap.awayLabel} · ${recap.chapterTitle}`}
          </Text>

          {/* Only the excerpt scrolls; the title above and the CTA below stay pinned. */}
          <ScrollView
            testID="welcome-back-scroll"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollContent}
          >
            {recap.paragraphs.map((paragraph, index) => (
              <Text
                key={`${index}-${paragraph.slice(0, 12)}`}
                style={[
                  styles.paragraph,
                  {
                    color: palette.text,
                    fontFamily: TYPOGRAPHY.displayFont,
                    textAlign,
                    writingDirection,
                  },
                ]}
              >
                {paragraph}
              </Text>
            ))}

            {recap.mark ? (
              <View
                testID="welcome-back-mark"
                style={[
                  styles.callout,
                  {
                    backgroundColor: palette.accentSoft,
                    borderColor: palette.accent,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.markLabel,
                    {
                      color: palette.accent,
                      fontFamily: TYPOGRAPHY.uiFont,
                      textAlign,
                      writingDirection,
                    },
                  ]}
                >
                  {recap.mark.label}
                </Text>
                {recap.mark.quote ? (
                  <Text
                    style={[
                      styles.markQuote,
                      {
                        color: palette.text,
                        fontFamily: TYPOGRAPHY.displayFont,
                        textAlign,
                        writingDirection,
                      },
                    ]}
                  >
                    {`«${recap.mark.quote}»`}
                  </Text>
                ) : null}
                {recap.mark.note ? (
                  <Text
                    style={[
                      styles.markNote,
                      {
                        color: palette.muted,
                        fontFamily: TYPOGRAPHY.uiFont,
                        textAlign,
                        writingDirection,
                      },
                    ]}
                  >
                    {recap.mark.note}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          <Pressable
            testID="welcome-back-dismiss"
            accessibilityRole="button"
            accessibilityLabel="كمّل القراية"
            onPress={onDismiss}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: palette.ctaBg },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.ctaText,
                {
                  color: palette.ctaText,
                  fontFamily: TYPOGRAPHY.uiFont,
                  writingDirection,
                },
              ]}
            >
              كمّل القراية
            </Text>
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    zIndex: 60,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 430,
  },
  card: {
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderRadius: RADIUS.sheet,
    borderWidth: 1,
    boxShadow: '0 18px 42px rgba(0, 0, 0, 0.24)',
  },
  headerRow: {
    alignItems: 'center',
    gap: 8,
  },
  ornament: {
    fontSize: 15,
  },
  title: {
    flexShrink: 1,
    fontSize: 19,
    lineHeight: 28,
    fontWeight: '700',
  },
  away: {
    marginTop: 4,
    fontSize: 12.5,
    lineHeight: 20,
  },
  scrollBody: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: 12,
  },
  scrollContent: {
    paddingBottom: 2,
  },
  paragraph: {
    marginTop: 12,
    fontSize: 16.5,
    lineHeight: 28,
  },
  callout: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderStartWidth: 3,
  },
  markLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  markQuote: {
    marginTop: 4,
    fontSize: 15.5,
    lineHeight: 25,
  },
  markNote: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 21,
  },
  cta: {
    marginTop: 16,
    minHeight: CTA_MIN_HEIGHT,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
