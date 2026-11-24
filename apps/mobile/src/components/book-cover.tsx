import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect } from 'react-native-svg';

import { resolveCoverPalette, type CoverPatternVariant } from '@/storage/cover';

export type BookCoverProps = {
  title: string;
  author?: string | null;
  coverColor?: string | null;
};

function CoverGeometricSvg({
  pattern,
  strokeColor,
}: {
  pattern: CoverPatternVariant;
  strokeColor: string;
}) {
  return (
    <Svg
      pointerEvents="none"
      width="100%"
      height="100%"
      viewBox="0 0 72 104"
      style={StyleSheet.absoluteFill}
    >
      <Rect
        x={9}
        y={5}
        width={58}
        height={94}
        rx={3}
        fill="none"
        stroke={strokeColor}
        strokeOpacity={0.38}
        strokeWidth={0.8}
      />

      {pattern === 'diamonds' ? (
        <G stroke={strokeColor} strokeOpacity={0.2} strokeWidth={0.75} fill="none">
          <Polygon points="38,14 54,32 38,50 22,32" />
          <Polygon points="38,54 54,72 38,90 22,72" />
          <Circle cx={38} cy={52} r={10} />
        </G>
      ) : null}

      {pattern === 'octagon' ? (
        <G stroke={strokeColor} strokeOpacity={0.2} strokeWidth={0.75} fill="none">
          <Rect x={24} y={38} width={28} height={28} />
          <Rect
            x={24}
            y={38}
            width={28}
            height={28}
            transform="rotate(45 38 52)"
          />
          <Circle cx={38} cy={52} r={6} />
        </G>
      ) : null}

      {pattern === 'arch' ? (
        <G stroke={strokeColor} strokeOpacity={0.22} strokeWidth={0.8} fill="none">
          <Path d="M16,92 L16,34 Q38,10 60,34 L60,92" />
          <Path d="M22,88 L22,38 Q38,20 54,38 L54,88" />
        </G>
      ) : null}

      {pattern === 'lattice' ? (
        <G stroke={strokeColor} strokeOpacity={0.18} strokeWidth={0.7} fill="none">
          <Line x1={12} y1={24} x2={64} y2={76} />
          <Line x1={64} y1={24} x2={12} y2={76} />
          <Line x1={12} y1={44} x2={64} y2={96} />
          <Line x1={64} y1={44} x2={12} y2={96} />
        </G>
      ) : null}
    </Svg>
  );
}

export function BookCover({ title, author, coverColor }: BookCoverProps) {
  const palette = resolveCoverPalette(title, coverColor);

  return (
    <View testID="book-cover" style={[styles.cover, { backgroundColor: palette.bg }]}>
      <CoverGeometricSvg pattern={palette.pattern} strokeColor={palette.border} />
      <View style={[styles.spine, { backgroundColor: palette.spine }]} />
      <View style={[styles.spineCrease, { backgroundColor: palette.border }]} />
      <View style={styles.inner}>
        <Text style={[styles.ornament, { color: palette.accent }]}>✦</Text>
        <Text
          style={[styles.title, { color: palette.text, writingDirection: 'rtl' }]}
          numberOfLines={3}
        >
          {title}
        </Text>
        {author ? (
          <Text
            style={[styles.author, { color: palette.accent, writingDirection: 'rtl' }]}
            numberOfLines={1}
          >
            {author}
          </Text>
        ) : (
          <View style={styles.authorSpacer} />
        )}
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
    width: 7,
    opacity: 0.9,
  },
  spineCrease: {
    width: 1,
    opacity: 0.35,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 7,
    paddingVertical: 10,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ornament: {
    fontSize: 9,
    opacity: 0.9,
  },
  title: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  author: {
    fontSize: 8.5,
    textAlign: 'center',
    opacity: 0.92,
  },
  authorSpacer: {
    height: 8,
  },
});
