import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TocEntry } from '@/types/reader';

export type TocModalProps = {
  visible: boolean;
  chapters: TocEntry[];
  activeChapterId: string;
  dir: 'rtl' | 'ltr';
  onSelectChapter: (chapterId: string) => void;
  onClose: () => void;
};

export function TocModal({
  visible,
  chapters,
  activeChapterId,
  dir,
  onSelectChapter,
  onClose,
}: TocModalProps) {
  const insets = useSafeAreaInsets();
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
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="إغلاق الفهرس" />
        <View
          style={[
            styles.sheet,
            {
              paddingTop: Math.max(insets.top, 16),
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>الفهرس</Text>
            <Pressable
              testID="toc-close-button"
              onPress={onClose}
              hitSlop={12}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
            >
              <Text style={styles.closeText}>✕</Text>
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
                    isActive && styles.rowActive,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <View style={styles.rowTextWrap}>
                    <Text
                      style={[
                        styles.rowTitle,
                        isActive && styles.rowTitleActive,
                        { writingDirection: isRtl ? 'rtl' : 'ltr' },
                      ]}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                    <Text style={styles.rowSub}>
                      {`الفصل ${index + 1} · ${item.pageCount} صفحة`}
                    </Text>
                  </View>
                  <Text style={[styles.pageNum, isActive && styles.pageNumActive]}>
                    {item.startPage}
                  </Text>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>لا توجد فصول متاحة</Text>
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
    backgroundColor: 'rgba(20, 18, 15, 0.45)',
  },
  sheet: {
    width: '84%',
    maxWidth: 380,
    height: '100%',
    backgroundColor: '#FAF8F5',
    borderStartWidth: 1,
    borderStartColor: '#E5DDD0',
    boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.18)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5DDD0',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#24211D',
  },
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  closeText: {
    fontSize: 18,
    color: '#6E675F',
    fontWeight: '600',
  },
  listContent: {
    padding: 12,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    minHeight: 54,
  },
  rowActive: {
    backgroundColor: 'rgba(139, 90, 43, 0.12)',
  },
  rowPressed: {
    backgroundColor: 'rgba(36, 33, 29, 0.06)',
  },
  rowTextWrap: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    color: '#24211D',
    textAlign: 'right',
  },
  rowTitleActive: {
    color: '#8B5A2B',
    fontWeight: '700',
  },
  rowSub: {
    fontSize: 12,
    color: '#6E675F',
    textAlign: 'right',
  },
  pageNum: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6E675F',
    fontVariant: ['tabular-nums'],
    minWidth: 28,
    textAlign: 'center',
  },
  pageNumActive: {
    color: '#8B5A2B',
  },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#6E675F',
  },
});
