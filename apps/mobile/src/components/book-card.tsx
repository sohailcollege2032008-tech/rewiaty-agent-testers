import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

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
  onLongPress?: (book: BookLibraryRecord) => void;
  /** Omit for books that must not be deleted (e.g. the bundled novel). */
  onDelete?: (book: BookLibraryRecord) => void;
};

const PRESS_EASING = cubicBezier(0.22, 1, 0.36, 1);

export function BookCard({
  book,
  theme,
  isTablet = false,
  isNew = false,
  onPress,
  onLongPress,
  onDelete,
}: BookCardProps) {
  const [pressed, setPressed] = useState(false);
  const palette = getAppThemeTokens(theme);
  const pct = progressToPercent(book.progress);
  const isRtl = book.dir !== 'ltr';
  const titleScale = isTablet ? TYPOGRAPHY.scale.tileTitleTablet : TYPOGRAPHY.scale.tileTitle;

  // The bundled novel belongs to the app, not the user: no delete button and no long-press delete.
  const isBundled = Boolean(book.isBundled);
  const showDelete = !isBundled && Boolean(onDelete);
  const handleLongPress = !isBundled && onLongPress ? () => onLongPress(book) : undefined;

  const statusText = pct >= 98 ? 'مقروء' : isNew ? 'جديدة' : `${pct}%`;

  // Why (a11y): the open target and the delete button are SIBLINGS under a non-pressable view.
  // A Pressable nested inside a Pressable is one accessibility node for VoiceOver/TalkBack and the
  // inner tap fights the outer one (#67 review, P2 #3).
  return (
    <View style={styles.root}>
      <Pressable
        testID={`book-card-${book.id}`}
        accessibilityRole="button"
        accessibilityLabel={book.title}
        accessibilityHint={
          isBundled ? 'افتح الكتاب' : 'افتح الكتاب أو اضغط مطولاً للحذف'
        }
        onPress={() => onPress(book)}
        onLongPress={handleLongPress}
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

      {showDelete ? (
        <Pressable
          testID={`book-delete-${book.id}`}
          onPress={() => onDelete?.(book)}
          style={({ pressed: deletePressed }) => [
            styles.deleteBtn,
            deletePressed && styles.deleteBtnPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`حذف ${book.title}`}
          accessibilityHint="يحذف الكتاب من المكتبة بعد تأكيد"
        >
          <View
            style={[
              styles.deleteBtnVisual,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path
                d="M5 7h14M10 7V5h4v2M7.5 7l.8 12h7.4l.8-12M10 10.5v5.5M14 10.5v5.5"
                stroke={palette.danger}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
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
    position: 'relative',
  },
  // Why (a11y): the Pressable itself is the 48×48 touch target; the drawn circle inside may be
  // smaller. Never pad a 36dp button with a hitSlop that a parent clips (P2 #4).
  deleteBtn: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnVisual: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.94,
  },
  deleteBtnPressed: {
    opacity: 0.7,
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
