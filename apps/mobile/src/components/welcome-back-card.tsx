import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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

/**
 * F28 — a warm, quiet floating card shown once when a reader comes back to a book after more
 * than three days. It never traps the reader: any tap dismisses it, and once dismissed the page
 * underneath is completely free.
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
        style={[styles.backdrop, { backgroundColor: palette.scrim }]}
      />

      <Animated.View pointerEvents="box-none" style={[styles.cardWrap, animatedStyle]}>
        <Pressable
          testID="welcome-back-card"
          accessibilityRole="button"
          accessibilityLabel="فين كنا واقفين؟ اضغط لمتابعة القراية"
          onPress={onDismiss}
          style={[
            styles.card,
            {
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
    minHeight: 44,
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
