import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { BookCard } from '@/components/book-card';
import { BookCover } from '@/components/book-cover';
import { ImportGuideSheet } from '@/components/import-guide-sheet';
import { deleteBookBundle, ensureSampleBookSeeded } from '@/storage/bundle';
import { getKv, listBooks, setKv } from '@/storage/database';
import { pickAndImportBook } from '@/storage/importer';
import { RADIUS, SPACING, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens, resolveSystemTheme } from '@/theme/reader-theme';
import type { BookLibraryRecord } from '@/types/reader';
import { progressToPercent } from '@/utils/progress';
import { showToast } from '@/utils/toast';

export const IMPORT_GUIDE_COUNT_KV_KEY = 'library_import_guide_count_v1';
export const IMPORT_GUIDE_MAX_SHOWS = 3;

type GridItem = BookLibraryRecord | { readonly __spacer: true; readonly id: string };

function isSpacerItem(item: GridItem): item is { readonly __spacer: true; readonly id: string } {
  return '__spacer' in item && item.__spacer === true;
}

export function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const colorScheme = useColorScheme();
  const themeId = resolveSystemTheme(colorScheme);
  const palette = getAppThemeTokens(themeId, colorScheme);

  const [books, setBooks] = useState<BookLibraryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const importLockRef = useRef(false);
  const [importGuideVisible, setImportGuideVisible] = useState(false);
  const [importGuideShowHelp, setImportGuideShowHelp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const seededOnceRef = useRef(false);

  const refreshBooks = useCallback(async () => {
    try {
      setErrorMsg(null);
      if (!seededOnceRef.current) {
        seededOnceRef.current = true;
        await ensureSampleBookSeeded();
      }
      const rows = await listBooks();
      setBooks(rows);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذّر تحميل المكتبة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshBooks();
    }, [refreshBooks]),
  );

  const runFilePickerImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const imported = await pickAndImportBook();
      if (imported) {
        const rows = await listBooks();
        setBooks(rows);
        showToast(`اتضافت «${imported.title}»`);
        router.push({ pathname: '/reader/[id]', params: { id: imported.id } });
      }
    } catch (err) {
      Alert.alert(
        'تعذّر الاستيراد',
        err instanceof Error ? err.message : 'حدث خطأ أثناء استيراد الملف.',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    // Synchronous lock: two quick taps must not open the guide twice or the picker twice.
    if (importing || importLockRef.current) return;
    importLockRef.current = true;
    try {
      await openImportFlow();
    } finally {
      importLockRef.current = false;
    }
  };

  const openImportFlow = async () => {
    const shownCount = await getKv<number>(IMPORT_GUIDE_COUNT_KV_KEY, 0).catch(() => IMPORT_GUIDE_MAX_SHOWS);
    if (shownCount < IMPORT_GUIDE_MAX_SHOWS) {
      await setKv(IMPORT_GUIDE_COUNT_KV_KEY, shownCount + 1).catch(() => undefined);
      setImportGuideShowHelp(false);
      setImportGuideVisible(true);
      return;
    }
    await runFilePickerImport();
  };

  const handleOpenHowToGetBooks = () => {
    setImportGuideShowHelp(true);
    setImportGuideVisible(true);
  };

  const handleOpenBook = (book: BookLibraryRecord) => {
    router.push({ pathname: '/reader/[id]', params: { id: book.id } });
  };

  const handleLongPressBook = (book: BookLibraryRecord) => {
    Alert.alert(
      'حذف الكتاب',
      `هل تريد حذف «${book.title}» من المكتبة؟`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteBookBundle(book.id);
                const rows = await listBooks();
                setBooks(rows);
              } catch (err) {
                Alert.alert(
                  'تعذّر الحذف',
                  err instanceof Error ? err.message : 'حدث خطأ أثناء حذف الكتاب.',
                );
              }
            })();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const heroBook = books[0] ?? null;
  const shelfBooks = useMemo(() => books.slice(1), [books]);
  const newestUnopenedBookId = useMemo(() => {
    let newest: BookLibraryRecord | null = null;
    for (const b of books) {
      if (b.progress === 0 && b.lastOpenedAt <= b.addedAt) {
        if (!newest || b.addedAt > newest.addedAt) {
          newest = b;
        }
      }
    }
    return newest?.id ?? null;
  }, [books]);
  const gridColumns = layout.libraryColumns;

  const gridData: GridItem[] = useMemo(() => {
    if (shelfBooks.length === 0) return [];
    const remainder = shelfBooks.length % gridColumns;
    if (remainder === 0) return shelfBooks;
    const padded: GridItem[] = [...shelfBooks];
    for (let i = 0; i < gridColumns - remainder; i++) {
      padded.push({ __spacer: true, id: `__spacer_${i}` });
    }
    return padded;
  }, [shelfBooks, gridColumns]);

  const horizontalPadding = layout.isTablet ? (layout.isTabletLandscape ? 48 : 36) : 24;
  const brandScale = layout.isTablet
    ? TYPOGRAPHY.scale.libraryBrandTablet
    : TYPOGRAPHY.scale.libraryBrand;
  const heroTitleScale = layout.isTablet
    ? TYPOGRAPHY.scale.heroTitleTablet
    : TYPOGRAPHY.scale.heroTitle;
  const shelfTitleScale = layout.isTablet
    ? TYPOGRAPHY.scale.shelfTitleTablet
    : TYPOGRAPHY.scale.shelfTitle;

  const renderHeroHeader = () => {
    if (!heroBook) return null;
    const heroPct = progressToPercent(heroBook.progress);
    const isHeroRtl = heroBook.dir !== 'ltr';

    return (
      <View>
        <Pressable
          testID={`book-card-${heroBook.id}`}
          onPress={() => handleOpenBook(heroBook)}
          onLongPress={() => handleLongPressBook(heroBook)}
          delayLongPress={450}
          accessibilityRole="button"
          accessibilityLabel={heroBook.title}
          accessibilityHint="افتح الكتاب أو اضغط مطولاً للحذف"
          style={[
            styles.heroSpread,
            layout.isTablet && styles.heroSpreadTablet,
            { borderBottomColor: palette.border },
          ]}
        >
          <View
            style={[
              styles.heroCoverWrap,
              {
                width: layout.heroCoverSize.width,
                height: layout.heroCoverSize.height,
              },
            ]}
          >
            <BookCover
              title={heroBook.title}
              author={heroBook.author}
              coverColor={heroBook.coverColor}
              dir={heroBook.dir}
              theme={themeId}
              variant="hero"
              width={layout.heroCoverSize.width}
              height={layout.heroCoverSize.height}
            />
          </View>

          <View style={styles.heroInfo}>
            <View>
              <View style={styles.heroStateRow}>
                <View style={styles.heroState}>
                  <View style={[styles.heroDot, { backgroundColor: palette.accent }]} />
                  <Text
                    style={[
                      styles.heroStateText,
                      { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                  >
                    قراءة حالية
                  </Text>
                </View>

                {layout.isTablet ? (
                  <View
                    style={[
                      styles.heroModeTag,
                      {
                        backgroundColor: palette.surface,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.heroModeTagText,
                        { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {layout.isTabletLandscape
                        ? 'يفتح بوضع صفحتين جنب بعض'
                        : 'يفتح بصفحة مريحة وهوامش واسعة'}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text
                style={[
                  styles.heroTitle,
                  {
                    color: palette.text,
                    fontFamily: TYPOGRAPHY.displayFont,
                    fontSize: heroTitleScale.fontSize,
                    lineHeight: heroTitleScale.lineHeight,
                    writingDirection: isHeroRtl ? 'rtl' : 'ltr',
                  },
                ]}
                numberOfLines={2}
              >
                {heroBook.title}
              </Text>

              {heroBook.author ? (
                <Text
                  style={[
                    styles.heroAuthor,
                    {
                      color: palette.muted,
                      fontFamily: TYPOGRAPHY.uiFont,
                      fontSize: layout.isTablet ? 15 : 13,
                      writingDirection: isHeroRtl ? 'rtl' : 'ltr',
                    },
                  ]}
                  numberOfLines={1}
                >
                  {heroBook.author}
                </Text>
              ) : null}
            </View>

            <View style={styles.heroBottom}>
              <View style={styles.heroProgressWrap}>
                <View style={[styles.hairTrack, { backgroundColor: palette.border }]}>
                  <View
                    style={[
                      styles.hairFill,
                      {
                        width: `${heroPct}%`,
                        backgroundColor: palette.accent,
                      },
                    ]}
                  />
                </View>
                <View style={styles.heroMetaRow}>
                  <Text
                    style={[
                      styles.heroPctLabel,
                      { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                  >
                    {`${heroPct}%`}
                  </Text>
                  {heroPct === 0 || heroPct >= 98 ? (
                    <Text
                      style={[
                        styles.heroStatusLabel,
                        { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                      ]}
                    >
                      {heroPct === 0 ? 'لم تبدأ بعد' : 'مقروء'}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                testID="continue-reading-button"
                onPress={() => handleOpenBook(heroBook)}
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                style={({ pressed }) => [
                  styles.continueCta,
                  { backgroundColor: palette.ctaBg },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={heroPct === 0 ? 'ابدأ القراية' : 'كمّل القراية'}
              >
                <Text
                  style={[
                    styles.continueCtaText,
                    { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  {heroPct === 0 ? 'ابدأ القراية' : 'كمّل القراية'}
                </Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M15 18l-6-6 6-6"
                    stroke={palette.ctaText}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            </View>
          </View>
        </Pressable>

        {shelfBooks.length > 0 ? (
          <View style={styles.shelfHead}>
            <Text
              style={[
                styles.shelfTitle,
                {
                  color: palette.text,
                  fontFamily: TYPOGRAPHY.displayFont,
                  fontSize: shelfTitleScale.fontSize,
                  lineHeight: shelfTitleScale.lineHeight,
                },
              ]}
            >
              رفّ الكتب
            </Text>
            <Text
              style={[
                styles.shelfCount,
                { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              {`${books.length} روايات`}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View
      testID="library-screen"
      style={[
        styles.container,
        {
          backgroundColor: palette.bg,
          paddingTop: insets.top,
        },
      ]}
    >
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />

      {/* Editorial Header */}
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: horizontalPadding,
            paddingTop: layout.isTablet ? 20 : 14,
            paddingBottom: layout.isTablet ? 18 : 14,
            borderBottomColor: palette.border,
            backgroundColor: palette.bg,
          },
        ]}
      >
        <View style={styles.brandLockup}>
          <Svg
            width={layout.isTablet ? 30 : 26}
            height={layout.isTablet ? 30 : 26}
            viewBox="0 0 26 26"
            fill="none"
          >
            <Path
              d="M4.5 5.5C8.5 5.5 11.2 6.8 13 8.8C14.8 6.8 17.5 5.5 21.5 5.5V19.8C17.6 19.8 14.9 20.8 13 22.5C11.1 20.8 8.4 19.8 4.5 19.8V5.5Z"
              stroke={palette.text}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            <Path d="M13 8.8V22.5" stroke={palette.text} strokeWidth={1.3} />
            <Path
              d="M17.2 5.7V13.2L15.4 11.7L13.6 13.2V7.9"
              fill={palette.ribbon}
            />
          </Svg>
          <Text
            testID="library-brand-name"
            style={[
              styles.brandName,
              {
                color: palette.text,
                fontFamily: TYPOGRAPHY.displayFont,
                fontSize: brandScale.fontSize,
                lineHeight: brandScale.lineHeight,
              },
            ]}
          >
            روايتي
          </Text>
          {layout.isTablet ? (
            <View style={[styles.brandDivider, { borderStartColor: palette.border }]}>
              <Text
                style={[
                  styles.brandSub,
                  { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                {`مكتبة الوَرّاق · ${books.length} كتب`}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.headerActions}>
          <Pressable
            testID="library-search-button"
            onPress={() => router.push('/search')}
            hitSlop={6}
            style={({ pressed }) => [
              styles.searchBtn,
              {
                borderColor: palette.border,
                backgroundColor: pressed ? palette.accentSoft : palette.surface,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="بحث في المكتبة"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Circle cx={11} cy={11} r={7} stroke={palette.text} strokeWidth={1.8} />
              <Path
                d="M20 20l-3.5-3.5"
                stroke={palette.text}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </Svg>
          </Pressable>

          <Pressable
            testID="import-book-button"
            onPress={() => void handleImport()}
            disabled={importing}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            style={({ pressed }) => [
              styles.importBtn,
              {
                borderColor: palette.accent,
                backgroundColor: pressed ? palette.accent : 'transparent',
              },
              importing && styles.importBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="استيراد كتاب جديد"
          >
            {({ pressed }) => (
              <Text
                style={[
                  styles.importBtnText,
                  {
                    color: pressed ? palette.ctaText : palette.accent,
                    fontFamily: TYPOGRAPHY.uiFont,
                  },
                ]}
              >
                {importing ? 'جاري الاستيراد...' : layout.isTablet ? '+ استيراد رواية' : '+ استيراد'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View testID="library-loading-state" style={styles.centerState}>
          <ActivityIndicator size="large" color={palette.accent} />
          <Text style={[styles.stateText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
            جاري تحضير المكتبة...
          </Text>
        </View>
      ) : errorMsg ? (
        <View testID="library-error-state" style={styles.centerState}>
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <Text style={[styles.errorOrnament, { color: palette.danger }]}>✦</Text>
            <Text
              style={[
                styles.errorText,
                { color: palette.danger, fontFamily: TYPOGRAPHY.uiFont },
              ]}
              selectable
            >
              {errorMsg}
            </Text>
            <Pressable
              testID="library-retry-button"
              onPress={() => void refreshBooks()}
              hitSlop={4}
              style={({ pressed }) => [
                styles.retryBtn,
                { backgroundColor: palette.ctaBg },
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.retryBtnText,
                  { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                إعادة المحاولة
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList<GridItem>
          key={`library-grid-${gridColumns}`}
          testID="library-book-list"
          data={gridData}
          numColumns={gridColumns}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeroHeader() ?? undefined}
          columnWrapperStyle={
            gridColumns > 1
              ? [styles.gridRow, { gap: layout.isTablet ? 24 : 18 }]
              : undefined
          }
          contentContainerStyle={[
            styles.listContent,
            {
              paddingHorizontal: horizontalPadding,
              paddingTop: layout.isTablet ? 28 : 22,
              paddingBottom: Math.max(insets.bottom, 24) + 16,
              gap: layout.isTablet ? 26 : 22,
            },
          ]}
          renderItem={({ item }) => {
            if (isSpacerItem(item)) {
              return <View style={styles.gridSpacer} />;
            }
            return (
              <BookCard
                book={item}
                theme={themeId}
                isTablet={layout.isTablet}
                isNew={item.id === newestUnopenedBookId}
                onPress={handleOpenBook}
                onLongPress={handleLongPressBook}
              />
            );
          }}
          ListEmptyComponent={
            books.length === 0 ? (
              <View testID="library-empty-state" style={styles.emptyState}>
                <Text style={[styles.emptyOrnament, { color: palette.accent }]}>✦</Text>
                <Text
                  style={[
                    styles.emptyTitle,
                    { color: palette.text, fontFamily: TYPOGRAPHY.displayFont },
                  ]}
                >
                  المكتبة فارغة
                </Text>
                <Text
                  style={[
                    styles.emptyHint,
                    { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  اضغط «+ استيراد» لإضافة رواية بصيغة .md أو .txt
                </Text>
                <Pressable
                  testID="library-empty-import-button"
                  onPress={() => void handleImport()}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.emptyCta,
                    { backgroundColor: palette.ctaBg },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.emptyCtaText,
                      { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                  >
                    استيراد كتابك الأول
                  </Text>
                </Pressable>
                <Pressable
                  testID="library-how-to-get-books-link"
                  onPress={handleOpenHowToGetBooks}
                  hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                  style={({ pressed }) => [styles.howToLinkBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="إزاي أجيب روايات؟"
                >
                  <Text
                    style={[
                      styles.howToLinkText,
                      { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                  >
                    إزاي أجيب روايات؟
                  </Text>
                </Pressable>
              </View>
            ) : undefined
          }
          ListFooterComponent={
            books.length > 0 ? (
              <Pressable
                testID="library-how-to-get-books-link"
                onPress={handleOpenHowToGetBooks}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                style={({ pressed }) => [styles.howToLinkBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="إزاي أجيب روايات؟"
              >
                <Text
                  style={[
                    styles.howToLinkText,
                    { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  إزاي أجيب روايات؟
                </Text>
              </Pressable>
            ) : undefined
          }
        />
      )}

      <ImportGuideSheet
        visible={importGuideVisible}
        initialShowHelp={importGuideShowHelp}
        theme={themeId}
        onPickFile={() => {
          setImportGuideVisible(false);
          void runFilePickerImport();
        }}
        onClose={() => setImportGuideVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandName: {
    fontWeight: '700',
    textAlign: 'right',
  },
  brandDivider: {
    paddingStart: 12,
    borderStartWidth: 1,
  },
  brandSub: {
    fontSize: 13,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBtn: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBtn: {
    height: 38,
    paddingHorizontal: 13,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importBtnDisabled: {
    opacity: 0.6,
  },
  importBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    flexGrow: 1,
  },
  gridRow: {
    alignItems: 'flex-start',
  },
  gridSpacer: {
    flex: 1,
  },
  heroSpread: {
    flexDirection: 'row',
    gap: 18,
    paddingBottom: 24,
    borderBottomWidth: 1,
  },
  heroSpreadTablet: {
    gap: 28,
    paddingBottom: 30,
    alignItems: 'center',
  },
  heroCoverWrap: {
    flexShrink: 0,
  },
  heroInfo: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 2,
    minWidth: 0,
    gap: 10,
  },
  heroStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  heroState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heroStateText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  heroModeTag: {
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  heroModeTagText: {
    fontSize: 11,
  },
  heroTitle: {
    fontWeight: '700',
    textAlign: 'right',
    marginBottom: 3,
  },
  heroAuthor: {
    textAlign: 'right',
  },
  heroBottom: {
    gap: 12,
  },
  heroProgressWrap: {
    gap: 6,
  },
  hairTrack: {
    width: '100%',
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  hairFill: {
    height: '100%',
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroPctLabel: {
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  heroStatusLabel: {
    fontSize: 11.5,
  },
  continueCta: {
    alignSelf: 'flex-start',
    height: 38,
    paddingHorizontal: 16,
    borderRadius: RADIUS.button,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  continueCtaText: {
    fontSize: 13,
    fontWeight: '600',
  },
  shelfHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: SPACING.lg,
  },
  shelfTitle: {
    fontWeight: '700',
  },
  shelfCount: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  stateText: {
    fontSize: 14.5,
  },
  errorCard: {
    width: '100%',
    maxWidth: 360,
    padding: 22,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    gap: 12,
  },
  errorOrnament: {
    fontSize: 20,
  },
  errorText: {
    fontSize: 14.5,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryBtn: {
    minHeight: 42,
    paddingHorizontal: 20,
    borderRadius: RADIUS.button,
    justifyContent: 'center',
  },
  retryBtnText: {
    fontWeight: '600',
    fontSize: 13.5,
  },
  emptyState: {
    paddingVertical: 72,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyOrnament: {
    fontSize: 24,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  emptyHint: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  emptyCta: {
    marginTop: 8,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: RADIUS.button,
    justifyContent: 'center',
  },
  emptyCtaText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  howToLinkBtn: {
    alignSelf: 'center',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 6,
  },
  howToLinkText: {
    fontSize: 12.5,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.78,
  },
});
