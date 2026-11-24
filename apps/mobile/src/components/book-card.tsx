import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';

import { BookCover } from './book-cover';
import type { BookLibraryRecord } from '@/types/reader';

export type BookCardProps = {
  book: BookLibraryRecord;
  onPress: (book: BookLibraryRecord) => void;
  onLongPress: (book: BookLibraryRecord) => void;
};

const PRESS_EASING = cubicBezier(0.23, 1, 0.32, 1);

export function BookCard({ book, onPress, onLongPress }: BookCardProps) {
  const [pressed, setPressed] = useState(false);
  const pct = Math.max(0, Math.min(100, Math.round(book.progress * 100)));
  const isRtl = book.dir === 'rtl';

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
    >
      <Animated.View
        style={[
          styles.card,
          {
            transitionProperty: 'transform',
            transitionDuration: '120ms',
            transitionTimingFunction: PRESS_EASING,
          },
          pressed && styles.cardPressed,
        ]}
      >
        <BookCover title={book.title} author={book.author} coverColor={book.coverColor} />
        <View style={styles.meta}>
          <View style={styles.textBlock}>
            <Text
              style={[styles.title, { writingDirection: isRtl ? 'rtl' : 'ltr' }]}
              numberOfLines={2}
            >
              {book.title}
            </Text>
            {book.author ? (
              <Text
                style={[styles.author, { writingDirection: isRtl ? 'rtl' : 'ltr' }]}
                numberOfLines={1}
              >
                {book.author}
              </Text>
            ) : null}
          </View>

          <View style={styles.progressSection}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.progressLabel}>{pct}%</Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: '#E8E0D4',
    boxShadow: '0 2px 6px rgba(36, 33, 29, 0.05)',
    transform: [{ scale: 1 }],
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
  },
  meta: {
    flex: 1,
    minHeight: 96,
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  textBlock: {
    gap: 4,
  },
  title: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: '#24211D',
    textAlign: 'right',
  },
  author: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6E675F',
    textAlign: 'right',
  },
  progressSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#EFE8DC',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#8B5A2B',
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6E675F',
    fontVariant: ['tabular-nums'],
    minWidth: 34,
    textAlign: 'left',
  },
});
