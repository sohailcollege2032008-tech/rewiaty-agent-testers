import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
  type SelectionRect,
  type ThemeId,
} from '@/types/reader';

export type HighlightToolbarProps = {
  visible: boolean;
  rect: SelectionRect | null;
  containerWidth: number;
  containerHeight: number;
  topInset: number;
  bottomInset: number;
  webviewOffsetTop: number;
  activeColor?: HighlightColor;
  isEditing?: boolean;
  theme?: ThemeId;
  onSelectColor: (color: HighlightColor) => void;
  onPressNote: () => void;
  /** F49: long-press dictionary lookup for the selected quote. */
  onPressDictionary?: () => void;
  /** F49: BYOK word/phrase explanation, bounded by the reader's strict cutoff. */
  onPressAiExplain?: () => void;
  onPressDelete?: () => void;
};

const TOOLBAR_HEIGHT = 54;
const TOOLBAR_GAP = 10;
/** Page gutter the pill keeps on both sides (`left` ∈ [12, containerWidth - width - 12]). */
const TOOLBAR_GUTTER = 12;
/**
 * Touch target budget (a11y, Issue #49 QA r1): every control's own box is 48×48dp — the target
 * is real layout, never a `hitSlop` halo that overlaps its neighbour. The coloured circle
 * inside keeps its visual size (28dp) so the pill still looks like a palette, not four blocks.
 */
const CONTROL_SIZE = 48;
const SWATCH_GAP = 8;
const SWATCH_DOT = 28;
/** Width the «المعجم» button adds before `onLayout` measures the real pill. */
const DICTIONARY_BUTTON_WIDTH = 56;
/** Width the compact «اشرح» button adds before `onLayout` measures the real pill. */
const AI_EXPLAIN_BUTTON_WIDTH = 58;
/**
 * Natural content width before `onLayout` has measured the pill. Only used for the first
 * frame's `left`; the real width takes over immediately after (Issue #59 QA r1: a fixed
 * width clipped the fourth (gold) swatch at 200% font scale). Both are clamped to
 * `containerWidth - 24` and the pill wraps when it cannot fit on one row.
 */
const ESTIMATED_WIDTH_VIEW = 320;
const ESTIMATED_WIDTH_EDIT = 372;

export function HighlightToolbar({
  visible,
  rect,
  containerWidth,
  containerHeight,
  topInset,
  bottomInset,
  webviewOffsetTop,
  activeColor,
  isEditing = false,
  theme,
  onSelectColor,
  onPressNote,
  onPressDictionary,
  onPressAiExplain,
  onPressDelete,
}: HighlightToolbarProps) {
  // Hooks must run before the early return; a hidden toolbar simply keeps its last measurement.
  const [measured, setMeasured] = useState({ width: 0, height: 0 });

  if (!visible || !rect) return null;

  const palette = getAppThemeTokens(theme);
  const maxToolbarWidth = Math.max(0, containerWidth - TOOLBAR_GUTTER * 2);
  const widthEstimate =
    (isEditing ? ESTIMATED_WIDTH_EDIT : ESTIMATED_WIDTH_VIEW) +
    (onPressDictionary ? DICTIONARY_BUTTON_WIDTH : 0) +
    (onPressAiExplain ? AI_EXPLAIN_BUTTON_WIDTH : 0);
  const toolbarWidth = Math.min(
    measured.width > 0 ? measured.width : widthEstimate,
    maxToolbarWidth,
  );
  const toolbarHeight = measured.height > 0 ? measured.height : TOOLBAR_HEIGHT;
  const safeTop = Math.max(8, topInset + 6);
  const safeBottom = Math.max(8, bottomInset + 6);

  const selectionTop = rect.top + webviewOffsetTop;
  const selectionBottom = rect.bottom + webviewOffsetTop;

  const preferredAbove = selectionTop - toolbarHeight - TOOLBAR_GAP;
  const preferredBelow = selectionBottom + TOOLBAR_GAP;
  const maxTop = Math.max(safeTop, containerHeight - safeBottom - toolbarHeight);

  let top = preferredAbove >= safeTop ? preferredAbove : preferredBelow;
  top = Math.max(safeTop, Math.min(maxTop, top));

  const centerX = (rect.left + rect.right) / 2;
  // Clamp against the *measured* width so the pill can never be pushed past the right edge,
  // however wide the content grows (font scale, dictionary button, delete button, long Arabic label).
  const maxLeft = Math.max(TOOLBAR_GUTTER, containerWidth - toolbarWidth - TOOLBAR_GUTTER);
  const left = Math.max(TOOLBAR_GUTTER, Math.min(maxLeft, centerX - toolbarWidth / 2));

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setMeasured((prev) =>
      Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    );
  };

  return (
    <View
      testID="highlight-toolbar-container"
      pointerEvents="box-none"
      style={styles.overlayContainer}
    >
      <View
        testID="highlight-toolbar"
        onLayout={handleLayout}
        style={[
          styles.toolbarPositioner,
          {
            top,
            left,
            maxWidth: maxToolbarWidth,
          },
        ]}
      >
        <View
          testID="highlight-toolbar-pill"
          style={[
            styles.toolbar,
            {
              maxWidth: maxToolbarWidth,
              backgroundColor: palette.popoverBg,
              borderColor: palette.popoverBorder,
            },
          ]}
        >
          <View testID="highlight-toolbar-colors" style={styles.colorsRow}>
            {HIGHLIGHT_COLORS.map((item) => {
              const swatch = palette.isDark ? item.swatchDark : item.swatchLight;
              const selected = isEditing && activeColor === item.id;
              return (
                <Pressable
                  key={item.id}
                  testID={`highlight-color-${item.id}`}
                  onPress={() => onSelectColor(item.id)}
                  style={({ pressed }) => [
                    styles.colorBtn,
                    selected && {
                      borderColor: palette.text,
                      backgroundColor: palette.chipBg,
                    },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={item.labelAr}
                  accessibilityState={{ selected }}
                >
                  <View
                    testID={`highlight-color-dot-${item.id}`}
                    style={[styles.colorDot, { backgroundColor: swatch }]}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <Pressable
            testID="highlight-note-button"
            onPress={onPressNote}
            style={({ pressed }) => [
              styles.noteBtn,
              { backgroundColor: palette.accentSoft },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="ملاحظة"
          >
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3z"
                stroke={palette.accent}
                strokeWidth={1.9}
                strokeLinejoin="round"
              />
            </Svg>
            <Text
              style={[styles.noteText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
              numberOfLines={1}
            >
              ملاحظة
            </Text>
          </Pressable>

          {onPressDictionary ? (
            <Pressable
              testID="highlight-dictionary-button"
              onPress={onPressDictionary}
              style={({ pressed }) => [
                styles.dictionaryBtn,
                { backgroundColor: palette.chipBg, borderColor: palette.border },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="البحث في المعجم"
            >
              <Text
                style={[
                  styles.dictionaryText,
                  { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                ]}
                numberOfLines={1}
              >
                المعجم
              </Text>
            </Pressable>
          ) : null}

          {onPressAiExplain ? (
            <Pressable
              testID="highlight-ai-explain-button"
              onPress={onPressAiExplain}
              style={({ pressed }) => [
                styles.aiBtn,
                { backgroundColor: palette.chipBg, borderColor: palette.border },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="اشرح السياق بالذكاء الاصطناعي"
            >
              <Text
                style={[styles.aiText, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
                numberOfLines={1}
              >
                اشرح
              </Text>
            </Pressable>
          ) : null}

          {isEditing && onPressDelete ? (
            <Pressable
              testID="highlight-delete-button"
              onPress={onPressDelete}
              style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="حذف التظليل"
            >
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"
                  stroke={palette.danger}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFill,
    direction: 'ltr',
    zIndex: 35,
  },
  toolbarPositioner: {
    position: 'absolute',
    zIndex: 35,
  },
  toolbar: {
    direction: 'rtl',
    minHeight: TOOLBAR_HEIGHT,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Issue #59: on a narrow screen (or 200% font scale) the actions drop to a second row
    // instead of the last control being clipped off the pill.
    flexWrap: 'wrap',
    gap: 4,
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.24)',
  },
  colorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SWATCH_GAP,
  },
  colorBtn: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: CONTROL_SIZE / 2,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDot: {
    width: SWATCH_DOT,
    height: SWATCH_DOT,
    borderRadius: SWATCH_DOT / 2,
  },
  divider: {
    width: 1,
    height: 24,
    marginHorizontal: 0,
  },
  noteBtn: {
    minWidth: CONTROL_SIZE,
    minHeight: CONTROL_SIZE,
    paddingHorizontal: 8,
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  noteText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dictionaryBtn: {
    minWidth: CONTROL_SIZE,
    minHeight: CONTROL_SIZE,
    paddingHorizontal: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dictionaryText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  aiBtn: {
    minWidth: CONTROL_SIZE,
    minHeight: CONTROL_SIZE,
    paddingHorizontal: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  deleteBtn: {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    borderRadius: CONTROL_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
