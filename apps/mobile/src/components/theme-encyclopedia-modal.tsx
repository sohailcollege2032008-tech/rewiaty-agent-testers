import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RADIUS, TYPOGRAPHY } from '@/theme/layout';
import {
  listThemesForFilter,
  THEME_CATEGORIES,
  THEME_SAMPLE_TEXT,
  THEME_TAGLINES,
  type ThemeFilterId,
} from '@/theme/encyclopedia';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId } from '@/types/reader';

export type ThemeEncyclopediaModalProps = {
  visible: boolean;
  activeTheme: ThemeId;
  onSelect: (theme: ThemeId) => void;
  onClose: () => void;
};

/**
 * F31 — «موسوعة الثيمات».
 *
 * Sits *above* the 4-theme registry: browse by mood (الكل / فاتح / دافئ / داكن / OLED), read each
 * card's Arabic voweled sample in that theme's own ink, check its WCAG badge, tap to apply.
 * «حِبْر اللَّيْل» leads the shelf.
 */
export function ThemeEncyclopediaModal({
  visible,
  activeTheme,
  onSelect,
  onClose,
}: ThemeEncyclopediaModalProps) {
  const insets = useSafeAreaInsets();
  const palette = getAppThemeTokens(activeTheme);
  const [filter, setFilter] = useState<ThemeFilterId>('all');
  const themes = useMemo(() => listThemesForFilter(filter), [filter]);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.host} testID="theme-encyclopedia-modal">
        <Pressable
          testID="theme-encyclopedia-backdrop"
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="إغلاق موسوعة الثيمات"
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: palette.sheetBg,
              borderColor: palette.border,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={[styles.head, { borderBottomColor: palette.border }]}>
            <View style={styles.headTitles}>
              <Text
                style={[styles.title, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
              >
                موسوعة الثيمات
              </Text>
              <Text style={[styles.subtitle, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
                {`${themes.length} ثيمًا · تباين AAA على الأقل`}
              </Text>
            </View>
            <Pressable
              testID="close-theme-encyclopedia-btn"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [
                styles.closeBtn,
                { backgroundColor: palette.chipBg, borderColor: palette.border },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="إغلاق موسوعة الثيمات"
            >
              <Text style={[styles.closeText, { color: palette.muted }]}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.filtersRow}>
            {THEME_CATEGORIES.map((category) => {
              const active = filter === category.id;
              return (
                <Pressable
                  key={category.id}
                  testID={`theme-filter-${category.id}`}
                  onPress={() => setFilter(category.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  style={({ pressed }) => [
                    styles.filterChip,
                    {
                      backgroundColor: active ? palette.ctaBg : palette.surface,
                      borderColor: active ? palette.ctaBg : palette.border,
                    },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                    style={[
                      styles.filterText,
                      {
                        color: active ? palette.ctaText : palette.muted,
                        fontFamily: TYPOGRAPHY.uiFont,
                      },
                    ]}
                  >
                    {category.labelAr}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {themes.map((theme) => {
              const active = theme.id === activeTheme;
              return (
                <Pressable
                  key={theme.id}
                  testID={`encyclopedia-theme-${theme.id}`}
                  onPress={() => onSelect(theme.id)}
                  style={({ pressed }) => [
                    styles.themeCard,
                    {
                      backgroundColor: theme.bg,
                      borderColor: active ? palette.accent : palette.border,
                      borderWidth: active ? 2 : 1,
                    },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${theme.labelAr} — تباين ${theme.contrastLabel}`}
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.sample,
                      { color: theme.text, fontFamily: TYPOGRAPHY.displayFont },
                    ]}
                  >
                    {THEME_SAMPLE_TEXT}
                  </Text>
                  <View style={styles.cardFoot}>
                    <View style={styles.cardMeta}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                        style={[
                          styles.name,
                          { color: theme.accent, fontFamily: TYPOGRAPHY.uiFont },
                        ]}
                      >
                        {theme.labelAr}
                      </Text>
                      <Text
                        numberOfLines={2}
                        style={[styles.tagline, { color: theme.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                      >
                        {THEME_TAGLINES[theme.id]}
                      </Text>
                    </View>
                    {active ? (
                      <Text
                        testID={`encyclopedia-theme-active-${theme.id}`}
                        style={[styles.check, { color: theme.accent }]}
                      >
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.contrastBadge,
                      { borderColor: theme.muted, backgroundColor: theme.popoverBg },
                    ]}
                  >
                    <Text
                      style={[
                        styles.contrastText,
                        { color: theme.text, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {theme.contrastLabel}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  card: {
    maxHeight: '82%',
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    borderWidth: 1,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headTitles: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'right',
  },
  subtitle: {
    fontSize: 11,
    textAlign: 'right',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  filterChip: {
    flex: 1,
    minHeight: 30,
    paddingHorizontal: 8,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: {
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  themeCard: {
    width: '47.5%',
    minHeight: 168,
    borderRadius: RADIUS.card,
    padding: 12,
    gap: 10,
    justifyContent: 'space-between',
  },
  sample: {
    fontSize: 15,
    lineHeight: 26,
    textAlign: 'right',
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  cardMeta: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  tagline: {
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
  },
  check: {
    fontSize: 16,
    fontWeight: '700',
  },
  contrastBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  contrastText: {
    fontSize: 9.5,
    fontVariant: ['tabular-nums'],
  },
  pressed: {
    opacity: 0.78,
  },
});
