import { StyleSheet, Text, View, type DimensionValue } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect } from 'react-native-svg';

import { resolveCoverPalette, type CoverPatternVariant } from '@/storage/cover';
import { TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export type BookCoverProps = {
  title: string;
  author?: string | null;
  coverColor?: string | null;
  dir?: 'rtl' | 'ltr';
  theme?: ThemeId;
  variant?: 'hero' | 'tile' | 'compact';
  width?: DimensionValue;
  height?: DimensionValue;
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
      viewBox="0 0 120 176"
      preserveAspectRatio="none"
      style={StyleSheet.absoluteFill}
    >
      {pattern === 'diamonds' ? (
        <G stroke={strokeColor} strokeOpacity={0.22} strokeWidth={0.9} fill="none">
          <Polygon points="60,26 98,88 60,150 22,88" />
          <Polygon points="60,46 86,88 60,130 34,88" />
          <Circle cx={60} cy={88} r={14} />
        </G>
      ) : null}

      {pattern === 'octagon' ? (
        <G stroke={strokeColor} strokeOpacity={0.22} strokeWidth={0.9} fill="none">
          <Circle cx={60} cy={88} r={42} />
          <Circle cx={60} cy={88} r={28} />
          <Line x1={60} y1={32} x2={60} y2={144} />
          <Line x1={18} y1={88} x2={102} y2={88} />
        </G>
      ) : null}

      {pattern === 'arch' ? (
        <G stroke={strokeColor} strokeOpacity={0.24} strokeWidth={1} fill="none">
          <Path d="M22 152 V64 A38 38 0 0 1 98 64 V152" />
          <Path d="M34 152 V70 A26 26 0 0 1 86 70 V152" />
        </G>
      ) : null}

      {pattern === 'lattice' ? (
        <G stroke={strokeColor} strokeOpacity={0.2} strokeWidth={0.8} fill="none">
          <Rect x={26} y={54} width={68} height={68} />
          <Rect x={26} y={54} width={68} height={68} transform="rotate(45 60 88)" />
          <Circle cx={60} cy={88} r={12} />
        </G>
      ) : null}
    </Svg>
  );
}

export function BookCover({
  title,
  author,
  coverColor,
  dir = 'rtl',
  theme,
  variant = 'tile',
  width,
  height,
}: BookCoverProps) {
  const themeTokens = getAppThemeTokens(theme);
  const palette = resolveCoverPalette(title, coverColor, themeTokens.coverPalettes);
  const isRtl = dir !== 'ltr';

  const spineWidth = variant === 'hero' ? 10 : variant === 'compact' ? 7 : 9;
  const titleFontSize = variant === 'hero' ? 18 : variant === 'compact' ? 12 : 16;
  const titleLineHeight = variant === 'hero' ? 26 : variant === 'compact' ? 17 : 23;
  const authorFontSize = variant === 'hero' ? 10.5 : variant === 'compact' ? 8.5 : 10;

  const sizeStyle =
    variant === 'tile'
      ? { width: width ?? ('100%' as const), aspectRatio: 2 / 2.9 }
      : {
          width: width ?? (variant === 'hero' ? 108 : 72),
          height: height ?? (variant === 'hero' ? 158 : 104),
        };

  return (
    <View
      testID="book-cover"
      style={[
        styles.cover,
        sizeStyle,
        {
          backgroundColor: palette.bg,
          borderColor: themeTokens.coverRim,
          borderTopRightRadius: isRtl ? 2 : 4,
          borderBottomRightRadius: isRtl ? 2 : 4,
          borderTopLeftRadius: isRtl ? 4 : 2,
          borderBottomLeftRadius: isRtl ? 4 : 2,
        },
      ]}
    >
      <CoverGeometricSvg pattern={palette.pattern} strokeColor={palette.border} />

      {/* Arabic cloth spine sits on the RIGHT; LTR spine sits on the LEFT */}
      <View
        pointerEvents="none"
        style={[
          styles.spineBand,
          {
            width: spineWidth,
            backgroundColor: palette.spine,
            right: isRtl ? 0 : undefined,
            left: isRtl ? undefined : 0,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.spineCreaseHighlight,
          {
            right: isRtl ? spineWidth - 2 : undefined,
            left: isRtl ? undefined : spineWidth - 2,
          },
        ]}
      />

      {/* Subtle page-block highlight on the fore-edge */}
      <View
        pointerEvents="none"
        style={[
          styles.foreEdge,
          {
            left: isRtl ? 0 : undefined,
            right: isRtl ? undefined : 0,
            backgroundColor: themeTokens.isDark
              ? 'rgba(255, 250, 240, 0.22)'
              : 'rgba(255, 252, 245, 0.36)',
          },
        ]}
      />

      {/* Inner embossed gilt frame */}
      <View
        pointerEvents="none"
        style={[
          styles.innerFrame,
          {
            borderColor: palette.border,
            right: isRtl ? spineWidth + 5 : 8,
            left: isRtl ? 8 : spineWidth + 5,
          },
        ]}
      />

      <View
        style={[
          styles.inner,
          {
            paddingRight: isRtl ? spineWidth + 8 : 10,
            paddingLeft: isRtl ? 10 : spineWidth + 8,
          },
        ]}
      >
        <Text style={[styles.ornament, { color: palette.accent }]}>✦</Text>
        <Text
          style={[
            styles.title,
            {
              color: palette.text,
              fontSize: titleFontSize,
              lineHeight: titleLineHeight,
              fontFamily: TYPOGRAPHY.displayFont,
              writingDirection: isRtl ? 'rtl' : 'ltr',
            },
          ]}
          numberOfLines={3}
        >
          {title}
        </Text>
        {author ? (
          <Text
            style={[
              styles.author,
              {
                color: palette.accent,
                fontSize: authorFontSize,
                fontFamily: TYPOGRAPHY.uiFont,
                writingDirection: isRtl ? 'rtl' : 'ltr',
              },
            ]}
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
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    boxShadow: '-3px 6px 14px rgba(25, 19, 14, 0.20)',
  },
  spineBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    opacity: 0.72,
  },
  spineCreaseHighlight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  foreEdge: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    width: 2,
  },
  innerFrame: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    borderWidth: 1,
    opacity: 0.25,
  },
  inner: {
    flex: 1,
    paddingVertical: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ornament: {
    fontSize: 9,
    opacity: 0.82,
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 3,
  },
  author: {
    textAlign: 'center',
    opacity: 0.84,
  },
  authorSpacer: {
    height: 10,
  },
});
