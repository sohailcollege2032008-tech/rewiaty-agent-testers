import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  onPressDelete?: () => void;
};

const TOOLBAR_HEIGHT = 54;
const TOOLBAR_GAP = 10;
/** Width the «المعجم» button adds, so the clamp keeps swatches + note + dictionary + delete. */
const DICTIONARY_BUTTON_WIDTH = 56;
/** Narrowest the toolbar may get on a 360dp phone before the outer clamp takes over. */
const MIN_TOOLBAR_WIDTH = 240;
/** Horizontal breathing room kept on both sides of the toolbar. */
const TOOLBAR_SIDE_MARGIN = 12;

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
  onPressDelete,
}: HighlightToolbarProps) {
  if (!visible || !rect) return null;

  const palette = getAppThemeTokens(theme);
  // Why (L4 budget): the toolbar must never overflow a 360dp screen. The desired width grows with
  // the extra actions, then clamps to `containerWidth - 24` (never below 240) so at 360dp with
  // swatches + note + dictionary + delete it is 336 wide at left=12 (right edge 348).
  const desiredWidth =
    (isEditing ? 316 : 264) + (onPressDictionary ? DICTIONARY_BUTTON_WIDTH : 0);
  const toolbarWidth = Math.min(
    desiredWidth,
    Math.max(MIN_TOOLBAR_WIDTH, containerWidth - TOOLBAR_SIDE_MARGIN * 2),
  );
  const safeTop = Math.max(8, topInset + 6);
  const safeBottom = Math.max(8, bottomInset + 6);

  const selectionTop = rect.top + webviewOffsetTop;
  const selectionBottom = rect.bottom + webviewOffsetTop;

  const preferredAbove = selectionTop - TOOLBAR_HEIGHT - TOOLBAR_GAP;
  const preferredBelow = selectionBottom + TOOLBAR_GAP;
  const maxTop = Math.max(safeTop, containerHeight - safeBottom - TOOLBAR_HEIGHT);

  let top = preferredAbove >= safeTop ? preferredAbove : preferredBelow;
  top = Math.max(safeTop, Math.min(maxTop, top));

  const centerX = (rect.left + rect.right) / 2;
  const maxLeft = Math.max(TOOLBAR_SIDE_MARGIN, containerWidth - toolbarWidth - TOOLBAR_SIDE_MARGIN);
  const left = Math.max(
    TOOLBAR_SIDE_MARGIN,
    Math.min(maxLeft, centerX - toolbarWidth / 2),
  );

  return (
    <View
      testID="highlight-toolbar-container"
      pointerEvents="box-none"
      style={styles.overlayContainer}
    >
      <View
        testID="highlight-toolbar"
        style={[
          styles.toolbarPositioner,
          {
            top,
            left,
            width: toolbarWidth,
            height: TOOLBAR_HEIGHT,
          },
        ]}
      >
        <View
          style={[
            styles.toolbar,
            {
              backgroundColor: palette.popoverBg,
              borderColor: palette.popoverBorder,
            },
          ]}
        >
          <View style={styles.colorsRow}>
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
                  <View style={[styles.colorDot, { backgroundColor: swatch }]} />
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
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
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
              // 48dp box + 4dp slop on every side = 56dp effective touch target (L4 budget).
              hitSlop={4}
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
    height: TOOLBAR_HEIGHT,
    maxWidth: '100%',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.24)',
  },
  colorsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  colorBtn: {
    // 32dp visual + hitSlop 4 keeps the four swatches inside the 336dp phone budget.
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  divider: {
    width: 1,
    height: 24,
    marginHorizontal: 2,
    flexShrink: 0,
  },
  noteBtn: {
    minHeight: 40,
    paddingHorizontal: 9,
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  noteText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  dictionaryBtn: {
    // L4 budget: an explicit 48x48 target; with hitSlop 4 it is 56dp effective.
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dictionaryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.75,
  },
});
