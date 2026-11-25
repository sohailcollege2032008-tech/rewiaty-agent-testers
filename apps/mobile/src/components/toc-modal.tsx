import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { HighlightNoteModal } from '@/components/highlight-note-modal';
import { ReadingStatsPanel } from '@/components/reading-stats-panel';
import { resolveBookmarkAnchor, sortBookmarksNewestFirst } from '@/storage/bookmarks';
import { resolveHighlightRange, sortHighlightsNewestFirst } from '@/storage/highlights';
import {
  emptyReadingStats,
  toArabicDigits,
  type ReadingSnapshot,
  type ReadingStats,
} from '@/storage/reading-stats';
import { RADIUS, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens } from '@/theme/reader-theme';
import {
  HIGHLIGHT_COLORS,
  type BookmarkItem,
  type HighlightColor,
  type HighlightItem,
  type ThemeId,
  type TocEntry,
} from '@/types/reader';
import type { Anchor, Book } from '@rewiaty/book-format';

type TocTab = 'chapters' | 'bookmarks' | 'highlights' | 'stats';

const TABS: ReadonlyArray<{ id: TocTab; label: string; testID: string }> = [
  { id: 'chapters', label: 'الفصول', testID: 'toc-tab-chapters' },
  { id: 'bookmarks', label: 'العلامات', testID: 'toc-tab-bookmarks' },
  { id: 'highlights', label: 'الاقتباسات', testID: 'toc-tab-highlights' },
  { id: 'stats', label: 'الإحصائيات', testID: 'toc-tab-stats' },
];

function getHighlightSwatchColor(color: HighlightColor, isDark: boolean): string {
  const found = HIGHLIGHT_COLORS.find((c) => c.id === color) ?? HIGHLIGHT_COLORS[0]!;
  return isDark ? found.swatchDark : found.swatchLight;
}

export type TocModalProps = {
  visible: boolean;
  chapters: TocEntry[];
  activeChapterId: string;
  dir: 'rtl' | 'ltr';
  theme?: ThemeId;
  onSelectChapter: (chapterId: string) => void;
  onClose: () => void;
  /** Text-anchored bookmarks (F16). */
  bookmarks?: BookmarkItem[];
  /** The parsed book, used to re-anchor a bookmark before jumping to it. */
  book?: Book | null;
  onOpenBookmark?: (item: BookmarkItem, anchor: Anchor | null) => void;
  onDeleteBookmark?: (id: string) => void;
  /** Text-anchored highlights & notes (F17). */
  highlights?: HighlightItem[];
  onOpenHighlight?: (item: HighlightItem, anchor: Anchor | null) => void;
  onDeleteHighlight?: (id: string) => void;
  onUpdateHighlightNote?: (id: string, note: string) => void;
  onExportHighlights?: () => void;
  /** F23 reading statistics shown in the stats tab. */
  readingStats?: ReadingStats | null;
  readingSnapshot?: ReadingSnapshot | null;
  now?: number;
};

export function TocModal({
  visible,
  chapters,
  activeChapterId,
  dir,
  theme,
  onSelectChapter,
  onClose,
  bookmarks,
  book,
  onOpenBookmark,
  onDeleteBookmark,
  highlights,
  onOpenHighlight,
  onDeleteHighlight,
  onUpdateHighlightNote,
  onExportHighlights,
  readingStats,
  readingSnapshot,
  now = Date.now(),
}: TocModalProps) {
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const palette = getAppThemeTokens(theme);
  const isRtl = dir === 'rtl';

  const [activeTab, setActiveTab] = useState<TocTab>('chapters');
  const [editingNoteItem, setEditingNoteItem] = useState<HighlightItem | null>(null);
  useEffect(() => {
    if (visible) {
      setActiveTab('chapters');
      setEditingNoteItem(null);
    }
  }, [visible]);

  const sortedBookmarks = sortBookmarksNewestFirst(bookmarks ?? []);
  const sortedHighlights = sortHighlightsNewestFirst(highlights ?? []);

  const handleOpenBookmark = (item: BookmarkItem) => {
    const resolved = book ? resolveBookmarkAnchor(book, item) : item.anchor;
    const usable = resolved.blockId ? resolved : null;
    onOpenBookmark?.(item, usable);
    onClose();
  };

  const handleOpenHighlight = (item: HighlightItem) => {
    const resolved = book ? resolveHighlightRange(book, item).anchor : item.anchor;
    const usable = resolved.blockId ? resolved : null;
    onOpenHighlight?.(item, usable);
    onClose();
  };

  const renderHighlight = ({ item }: { item: HighlightItem }) => {
    const swatch = getHighlightSwatchColor(item.color, palette.isDark);
    return (
      <Pressable
        testID={`toc-highlight-${item.id}`}
        onPress={() => handleOpenHighlight(item)}
        style={({ pressed }) => [
          styles.highlightRow,
          { borderColor: palette.border, backgroundColor: palette.surface },
          pressed && { backgroundColor: palette.chipBg },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`اقتباس${item.chapterTitle ? ` في ${item.chapterTitle}` : ''}`}
      >
        <View style={[styles.highlightSwatchBar, { backgroundColor: swatch }]} />
        <View style={styles.bookmarkTextWrap}>
          <Text
            style={[
              styles.bookmarkChapter,
              {
                color: palette.text,
                fontFamily: TYPOGRAPHY.displayFont,
                writingDirection: isRtl ? 'rtl' : 'ltr',
              },
            ]}
            numberOfLines={1}
          >
            {item.chapterTitle || 'اقتباس محفوظ'}
          </Text>
          {item.quote ? (
            <Text
              style={[
                styles.bookmarkQuote,
                {
                  color: palette.text,
                  fontFamily: TYPOGRAPHY.uiFont,
                  writingDirection: isRtl ? 'rtl' : 'ltr',
                },
              ]}
              numberOfLines={3}
            >
              {`«${item.quote}»`}
            </Text>
          ) : null}
          {item.note ? (
            <Text
              testID={`toc-highlight-note-${item.id}`}
              style={[
                styles.highlightNote,
                {
                  color: palette.muted,
                  backgroundColor: palette.chipBg,
                  fontFamily: TYPOGRAPHY.uiFont,
                  writingDirection: isRtl ? 'rtl' : 'ltr',
                },
              ]}
              numberOfLines={3}
            >
              {`ملاحظة: ${item.note}`}
            </Text>
          ) : null}
        </View>
        <View style={styles.highlightActions}>
          <Pressable
            testID={`highlight-edit-note-${item.id}`}
            onPress={() => setEditingNoteItem(item)}
            hitSlop={8}
            style={styles.highlightActionBtn}
            accessibilityRole="button"
            accessibilityLabel={item.note ? 'تعديل الملاحظة' : 'إضافة ملاحظة'}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path
                d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3z"
                stroke={palette.accent}
                strokeWidth={1.8}
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>
          <Pressable
            testID={`highlight-delete-${item.id}`}
            onPress={() => onDeleteHighlight?.(item.id)}
            hitSlop={8}
            style={styles.highlightActionBtn}
            accessibilityRole="button"
            accessibilityLabel="حذف الاقتباس"
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path
                d="M18 6L6 18M6 6l12 12"
                stroke={palette.muted}
                strokeWidth={1.9}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  const renderBookmark = ({ item }: { item: BookmarkItem }) => (
    <Pressable
      testID={`toc-bookmark-${item.id}`}
      onPress={() => handleOpenBookmark(item)}
      style={({ pressed }) => [
        styles.bookmarkRow,
        pressed && { backgroundColor: palette.chipBg },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`علامة مرجعية${item.chapterTitle ? ` في ${item.chapterTitle}` : ''}`}
    >
      <View style={styles.bookmarkTextWrap}>
        <Text
          style={[
            styles.bookmarkChapter,
            {
              color: palette.text,
              fontFamily: TYPOGRAPHY.displayFont,
              writingDirection: isRtl ? 'rtl' : 'ltr',
            },
          ]}
          numberOfLines={1}
        >
          {item.chapterTitle || 'موضع محفوظ'}
        </Text>
        {item.quote ? (
          <Text
            style={[styles.bookmarkQuote, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
            numberOfLines={2}
          >
            {`«${item.quote}»`}
          </Text>
        ) : null}
        {item.page !== undefined ? (
          <Text
            style={[styles.bookmarkPage, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
          >
            {`صفحة ${toArabicDigits(item.page)}`}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID={`bookmark-delete-${item.id}`}
        onPress={() => onDeleteBookmark?.(item.id)}
        hitSlop={12}
        style={styles.bookmarkDelete}
        accessibilityRole="button"
        accessibilityLabel="حذف العلامة المرجعية"
      >
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path
            d="M18 6L6 18M6 6l12 12"
            stroke={palette.muted}
            strokeWidth={1.9}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
    </Pressable>
  );

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
                  color: palette.heading ?? palette.text,
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

          <View style={[styles.tabsRow, { borderBottomColor: palette.border }]}>
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <Pressable
                  key={tab.id}
                  testID={tab.testID}
                  onPress={() => setActiveTab(tab.id)}
                  style={[
                    styles.tabButton,
                    isActive && { borderBottomColor: palette.accent },
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text
                    style={[
                      styles.tabLabel,
                      {
                        color: isActive ? palette.accent : palette.muted,
                        fontFamily: TYPOGRAPHY.uiFont,
                      },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {activeTab === 'chapters' ? (
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
                        {`الفصل ${index + 1} · ${item.estimated ? '~' : ''}${item.pageCount} صفحات`}
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
          ) : null}

          {activeTab === 'bookmarks' ? (
            <FlatList
              data={sortedBookmarks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={renderBookmark}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text
                    testID="bookmarks-empty"
                    style={[
                      styles.emptyText,
                      { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                  >
                    لا توجد علامات مرجعية بعد. المس الشريطة لحفظ موضعك.
                  </Text>
                </View>
              }
            />
          ) : null}

          {activeTab === 'highlights' ? (
            <View style={styles.highlightsContainer}>
              {sortedHighlights.length > 0 ? (
                <View style={[styles.exportBar, { borderBottomColor: palette.border }]}>
                  <Text
                    style={[
                      styles.exportCount,
                      { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                  >
                    {`${toArabicDigits(sortedHighlights.length)} اقتباس`}
                  </Text>
                  <Pressable
                    testID="highlights-export-button"
                    onPress={() => onExportHighlights?.()}
                    style={({ pressed }) => [
                      styles.exportBtn,
                      { backgroundColor: palette.accentSoft, borderColor: palette.border },
                      pressed && { opacity: 0.78 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="تصدير الاقتباسات والملاحظات"
                  >
                    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                      <Path
                        d="M12 3v12M8 7l4-4 4 4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4"
                        stroke={palette.accent}
                        strokeWidth={1.9}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                    <Text
                      style={[
                        styles.exportBtnText,
                        { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      تصدير Markdown
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              <FlatList
                data={sortedHighlights}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={renderHighlight}
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Text
                      testID="highlights-empty"
                      style={[
                        styles.emptyText,
                        { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      لا توجد اقتباسات بعد. اضغط مطولاً واسحب على أي جملة لتظليلها.
                    </Text>
                  </View>
                }
              />
            </View>
          ) : null}

          {activeTab === 'stats' ? (
            <ReadingStatsPanel
              stats={readingStats ?? emptyReadingStats()}
              snapshot={readingSnapshot ?? null}
              theme={theme}
              dir={dir}
              now={now}
            />
          ) : null}
        </View>
      </View>

      <HighlightNoteModal
        visible={editingNoteItem !== null}
        quote={editingNoteItem?.quote ?? ''}
        initialNote={editingNoteItem?.note ?? ''}
        theme={theme}
        dir={dir}
        onCancel={() => setEditingNoteItem(null)}
        onSave={(note) => {
          if (editingNoteItem) {
            onUpdateHighlightNote?.(editingNoteItem.id, note);
          }
          setEditingNoteItem(null);
        }}
      />
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
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 8,
  },
  tabButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
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
  bookmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 6,
    borderCurve: 'continuous',
    minHeight: 58,
  },
  bookmarkTextWrap: {
    flex: 1,
    gap: 2,
  },
  bookmarkChapter: {
    fontSize: 14.5,
    fontWeight: '700',
    textAlign: 'right',
  },
  bookmarkQuote: {
    fontSize: 12.5,
    lineHeight: 19,
    textAlign: 'right',
  },
  bookmarkPage: {
    fontSize: 11,
    textAlign: 'right',
    opacity: 0.85,
  },
  bookmarkDelete: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  empty: {
    paddingVertical: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  highlightsContainer: {
    flex: 1,
  },
  exportBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  exportCount: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: RADIUS.button,
    borderWidth: 1,
  },
  exportBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  highlightSwatchBar: {
    width: 4,
    borderRadius: 2,
    flexShrink: 0,
  },
  highlightNote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginTop: 4,
  },
  highlightActions: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 2,
  },
  highlightActionBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
});
