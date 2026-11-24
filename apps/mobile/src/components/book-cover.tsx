import { StyleSheet, Text, View } from 'react-native';

import { resolveCoverPalette } from '@/storage/cover';

export type BookCoverProps = {
  title: string;
  author?: string | null;
  coverColor?: string | null;
};

export function BookCover({ title, author, coverColor }: BookCoverProps) {
  const palette = resolveCoverPalette(title, coverColor);

  return (
    <View style={[styles.cover, { backgroundColor: palette.bg }]}>
      <View style={[styles.spine, { backgroundColor: palette.accent }]} />
      <View style={styles.inner}>
        <Text style={[styles.ornament, { color: palette.accent }]}>✦</Text>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={3}>
          {title}
        </Text>
        {author ? (
          <Text style={[styles.author, { color: palette.accent }]} numberOfLines={1}>
            {author}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    width: 72,
    height: 104,
    borderRadius: 8,
    borderCurve: 'continuous',
    overflow: 'hidden',
    flexDirection: 'row',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.16)',
  },
  spine: {
    width: 5,
    opacity: 0.45,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ornament: {
    fontSize: 10,
    opacity: 0.85,
  },
  title: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  author: {
    fontSize: 9,
    textAlign: 'center',
    opacity: 0.9,
  },
});
