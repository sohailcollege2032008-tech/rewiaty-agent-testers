import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';

import { BookCover } from './book-cover';
import { TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { BookLibraryRecord, ThemeId } from '@/types/reader';
import { progressToPercent } from '@/utils/progress';

export type BookCardProps = {
  book: BookLibraryRecord;
  theme?: ThemeId;
  isTablet?: boolean;
  isNew?: boolean;
  onPress: (book: BookLibraryRecord) => void;
  onLongPress: (book: BookLibraryRecord) => void;
};

const PRESS_EASING = cubicBezier(0.22, 1, 0.36, 1);

export function BookCard({
  book,
  theme,
  isTablet = false,
  isNew = false,
  onPress,
  onLongPress,
}: BookCardProps) {
  const [pressed, setPressed] = useState(false);
  const palette = getAppThemeTokens(theme);
  const pct = progressToPercent(book.progress);
  const isRtl = book.dir !== 'ltr';
  const titleScale = isTablet ? TYPOGRAPHY.scale.tileTitleTablet : TYPOGRAPHY.scale.tileTitle;

  const statusText = pct >= 98 ? 'مقروء' : isNew ? 'جديدة' : `${pct}%`;

  return (
    <Pressable
      testID={`book-card-${book.id}`}
      accessibilityRole="button"
      accessibilityLabel={book.title}
      accessibilityHint="افتح الكتاب أو اضغط مطولاً للحذف"
      onPress={() => onPress(book)}
      onLongPress={() => onLongPress(book)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      delayLongPress={450}
      pressRetentionOffset={16}
      style={styles.pressable}
    >
      <Animated.View
        style={[
          styles.tile,
          {
            transitionProperty: 'transform',
            transitionDuration: '140ms',
            transitionTimingFunction: PRESS_EASING,
          },
          pressed && styles.tilePressed,
        ]}
      >
        <View style={styles.coverBox}>
          <BookCover
            title={book.title}
            author={book.author}
            coverColor={book.coverColor}
            dir={book.dir}
            theme={theme}
            variant="tile"
          />
        </View>

        <Text
          style={[
            styles.title,
            {
              color: palette.text,
              fontFamily: TYPOGRAPHY.displayFont,
              fontSize: titleScale.fontSize,
              lineHeight: titleScale.lineHeight,
              writingDirection: isRtl ? 'rtl' : 'ltr',
            },
          ]}
          numberOfLines={2}
        >
          {book.title}
        </Text>

        {book.author ? (
          <Text
            style={[
              styles.author,
              {
                color: palette.muted,
                fontFamily: TYPOGRAPHY.uiFont,
                fontSize: isTablet ? 13 : 12,
                writingDirection: isRtl ? 'rtl' : 'ltr',
              },
            ]}
            numberOfLines={1}
          >
            {book.author}
          </Text>
        ) : (
          <View style={styles.authorSpacer} />
        )}

        <View style={styles.footRow}>
          <View style={[styles.hairTrack, { backgroundColor: palette.border }]}>
            <View
              style={[
                styles.hairFill,
                {
                  width: `${pct}%`,
                  backgroundColor: palette.accent,
                },
              ]}
            />
          </View>
          <Text
            style={[
              styles.pctLabel,
              {
                color: palette.muted,
                fontFamily: TYPOGRAPHY.uiFont,
              },
            ]}
          >
            {statusText}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    flex: 1,
  },
  tile: {
    flex: 1,
    transform: [{ scale: 1 }],
  },
  tilePressed: {
    transform: [{ translateY: 1 }, { scale: 0.985 }],
  },
  coverBox: {
    width: '100%',
    marginBottom: 10,
  },
  title: {
    fontWeight: '700',
    textAlign: 'right',
    marginBottom: 2,
  },
  author: {
    textAlign: 'right',
    marginBottom: 8,
  },
  authorSpacer: {
    height: 18,
  },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hairTrack: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  hairFill: {
    height: '100%',
    borderRadius: 1,
  },
  pctLabel: {
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
});
