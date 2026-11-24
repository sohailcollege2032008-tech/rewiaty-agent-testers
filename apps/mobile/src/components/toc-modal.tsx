import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type { ThemeId, TocEntry } from '@/types/reader';

export type TocModalProps = {
  visible: boolean;
  chapters: TocEntry[];
  activeChapterId: string;
  dir: 'rtl' | 'ltr';
  theme?: ThemeId;
  onSelectChapter: (chapterId: string) => void;
  onClose: () => void;
};

export function TocModal({
  visible,
  chapters,
  activeChapterId,
  dir,
  theme,
  onSelectChapter,
  onClose,
}: TocModalProps) {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={[styles.scrim, { backgroundColor: palette.scrim }]}
          onPress={onClose}
          accessibilityLabel="إغلاق الفهرس"
        />
        <View
          style={[
            styles.sheet,
            {
              width: layout.tocDrawerWidth,
              paddingTop: Math.max(insets.top, layout.isTablet ? 20 : 16),
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: layout.isTablet ? palette.surface : palette.bg,
              borderStartColor: palette.border,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: palette.border }]}>
            <Text
              style={[
                styles.headerTitle,
                {
                  color: palette.text,
                  fontFamily: TYPOGRAPHY.displayFont,
                },
              ]}
            >
              فهرس الفصول
            </Text>
            <Pressable
              testID="toc-close-button"
              onPress={onClose}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M18 6L6 18M6 6l12 12"
                  stroke={palette.muted}
                  strokeWidth={1.9}
                  strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          </View>

          <FlatList
            data={chapters}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => {
              const isActive = item.id === activeChapterId;
              return (
                <Pressable
                  testID={`toc-item-${item.id}`}
                  onPress={() => {
                    onSelectChapter(item.id);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    isActive && { backgroundColor: palette.accentSoft },
                    pressed && !isActive && { backgroundColor: palette.chipBg },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <View style={styles.rowTextWrap}>
                    <Text
                      style={[
                        styles.rowTitle,
                        {
                          color: isActive ? palette.accent : palette.text,
                          fontFamily: TYPOGRAPHY.displayFont,
                          writingDirection: isRtl ? 'rtl' : 'ltr',
                        },
                      ]}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={[
                        styles.rowSub,
                        { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {`الفصل ${index + 1} · ${item.pageCount} صفحات`}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.pageNum,
                      {
                        color: isActive ? palette.accent : palette.muted,
                        fontFamily: TYPOGRAPHY.uiFont,
                      },
                    ]}
                  >
                    {item.startPage}
                  </Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text
                  style={[
                    styles.emptyText,
                    { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  لا توجد فصول متاحة
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    maxWidth: 380,
    height: '100%',
    borderStartWidth: 1,
    boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.20)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '700',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  listContent: {
    padding: 14,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 6,
    borderCurve: 'continuous',
    minHeight: 54,
  },
  rowTextWrap: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 16.5,
    lineHeight: 23,
    fontWeight: '700',
    textAlign: 'right',
  },
  rowSub: {
    fontSize: 11.5,
    textAlign: 'right',
  },
  pageNum: {
    fontSize: 12.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 28,
    textAlign: 'center',
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
});
