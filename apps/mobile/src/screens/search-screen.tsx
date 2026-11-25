import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import {
  ensureLibrarySearchIndexed,
  searchLibrary,
  type SearchHit,
} from '@/storage/search-index';
import { RADIUS, SPACING, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens, resolveSystemTheme } from '@/theme/reader-theme';

const SEARCH_DEBOUNCE_MS = 150;
const ARABIC_RE = /[\u0600-\u06FF]/;

export const SEARCH_GENERIC_ERROR_MESSAGE = 'تعذّر إتمام البحث حاليًا. حاول مرة أخرى.';

export function toArabicSearchError(err: unknown): string {
  if (err instanceof Error && ARABIC_RE.test(err.message)) {
    return err.message;
  }
  return SEARCH_GENERIC_ERROR_MESSAGE;
}

export function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const colorScheme = useColorScheme();
  const themeId = resolveSystemTheme(colorScheme);
  const palette = getAppThemeTokens(themeId, colorScheme);

  const { bookId: rawBookId } = useLocalSearchParams<{ bookId?: string }>();
  const scopedBookId = useMemo(() => {
    const val = Array.isArray(rawBookId) ? rawBookId[0] : rawBookId;
    return val && val.trim() ? val.trim() : undefined;
  }, [rawBookId]);

  const [scope, setScope] = useState<'book' | 'library'>(scopedBookId ? 'book' : 'library');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [indexRevision, setIndexRevision] = useState(0);

  const requestSeqRef = useRef(0);
  const effectiveBookId = scopedBookId && scope === 'book' ? scopedBookId : undefined;

  useEffect(() => {
    setScope(scopedBookId ? 'book' : 'library');
  }, [scopedBookId]);

  useEffect(() => {
    let cancelled = false;
    void ensureLibrarySearchIndexed()
      .then(() => {
        if (!cancelled) {
          setIndexRevision((rev) => rev + 1);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(toArabicSearchError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const currentSeq = ++requestSeqRef.current;

    if (!trimmed) {
      setSearching(false);
      setErrorMsg(null);
      setResults([]);
      return;
    }

    setSearching(true);
    setErrorMsg(null);

    const timer = setTimeout(() => {
      void searchLibrary(trimmed, { bookId: effectiveBookId })
        .then((hits) => {
          if (requestSeqRef.current !== currentSeq) return;
          setResults(hits);
          setSearching(false);
        })
        .catch((err) => {
          if (requestSeqRef.current !== currentSeq) return;
          setResults([]);
          setErrorMsg(toArabicSearchError(err));
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [query, effectiveBookId, indexRevision]);

  const handleClear = useCallback(() => {
    requestSeqRef.current += 1;
    setQuery('');
    setResults([]);
    setErrorMsg(null);
    setSearching(false);
  }, []);

  const handleOpenHit = useCallback(
    (hit: SearchHit) => {
      router.push({
        pathname: '/reader/[id]',
        params: {
          id: hit.bookId,
          blockId: hit.blockId,
          charOffset: String(hit.charOffset),
        },
      });
    },
    [router],
  );

  const horizontalPadding = layout.isTablet ? (layout.isTabletLandscape ? 48 : 36) : 20;
  const trimmedQuery = query.trim();

  return (
    <View
      testID="search-screen"
      style={[
        styles.container,
        {
          backgroundColor: palette.bg,
          paddingTop: insets.top,
        },
      ]}
    >
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />

      <View
        style={[
          styles.header,
          {
            paddingHorizontal: horizontalPadding,
            borderBottomColor: palette.border,
            backgroundColor: palette.bg,
          },
        ]}
      >
        <View style={styles.searchBarRow}>
          <Pressable
            testID="search-back-button"
            onPress={() => router.back()}
            hitSlop={6}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && { backgroundColor: palette.accentSoft },
            ]}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="M9 18l6-6-6-6"
                stroke={palette.text}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Pressable>

          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
              <Circle cx={11} cy={11} r={7} stroke={palette.muted} strokeWidth={1.8} />
              <Path
                d="M20 20l-3.5-3.5"
                stroke={palette.muted}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </Svg>

            <TextInput
              testID="search-input"
              value={query}
              onChangeText={setQuery}
              placeholder="ابحث في رواياتك…"
              placeholderTextColor={palette.muted}
              autoFocus
              returnKeyType="search"
              autoCorrect={false}
              style={[
                styles.input,
                {
                  color: palette.text,
                  fontFamily: TYPOGRAPHY.uiFont,
                },
              ]}
              accessibilityLabel="حقل البحث"
            />

            {query.length > 0 ? (
              <Pressable
                testID="search-clear-button"
                onPress={handleClear}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.clearButton,
                  pressed && { backgroundColor: palette.accentSoft },
                ]}
                accessibilityRole="button"
                accessibilityLabel="مسح البحث"
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M18 6L6 18M6 6l12 12"
                    stroke={palette.muted}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </Svg>
              </Pressable>
            ) : null}
          </View>
        </View>

        {scopedBookId ? (
          <View style={styles.scopeRow}>
            <Pressable
              testID="search-scope-book"
              onPress={() => setScope('book')}
              hitSlop={{ top: 5, bottom: 5, left: 4, right: 4 }}
              style={[
                styles.scopeChip,
                {
                  borderColor: scope === 'book' ? palette.accent : palette.chipBorder,
                  backgroundColor: scope === 'book' ? palette.chipActiveBg : palette.chipBg,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === 'book' }}
            >
              <Text
                style={[
                  styles.scopeChipText,
                  {
                    color: scope === 'book' ? palette.accent : palette.muted,
                    fontFamily: TYPOGRAPHY.uiFont,
                  },
                ]}
              >
                في هذا الكتاب
              </Text>
            </Pressable>

            <Pressable
              testID="search-scope-library"
              onPress={() => setScope('library')}
              hitSlop={{ top: 5, bottom: 5, left: 4, right: 4 }}
              style={[
                styles.scopeChip,
                {
                  borderColor: scope === 'library' ? palette.accent : palette.chipBorder,
                  backgroundColor: scope === 'library' ? palette.chipActiveBg : palette.chipBg,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: scope === 'library' }}
            >
              <Text
                style={[
                  styles.scopeChipText,
                  {
                    color: scope === 'library' ? palette.accent : palette.muted,
                    fontFamily: TYPOGRAPHY.uiFont,
                  },
                ]}
              >
                في المكتبة كلها
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {!trimmedQuery ? (
        <View testID="search-idle-state" style={styles.centerState}>
          <Text style={[styles.ornament, { color: palette.accent }]}>✦</Text>
          <Text
            style={[
              styles.stateTitle,
              { color: palette.text, fontFamily: TYPOGRAPHY.displayFont },
            ]}
          >
            ابحث في رواياتك…
          </Text>
          <Text
            style={[
              styles.stateHint,
              { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
            ]}
          >
            اكتب كلمة أو جملة بالعربي أو الإنجليزي من غير تشكيل
          </Text>
        </View>
      ) : searching ? (
        <View testID="search-loading-state" style={styles.centerState}>
          <ActivityIndicator size="large" color={palette.accent} />
          <Text
            style={[
              styles.stateHint,
              { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
            ]}
          >
            جاري البحث…
          </Text>
        </View>
      ) : errorMsg ? (
        <View testID="search-error-state" style={styles.centerState}>
          <View
            style={[
              styles.errorCard,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
              },
            ]}
          >
            <Text style={[styles.ornament, { color: palette.danger }]}>✦</Text>
            <Text
              style={[
                styles.errorText,
                { color: palette.danger, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              {errorMsg}
            </Text>
          </View>
        </View>
      ) : results.length === 0 ? (
        <View testID="search-empty-state" style={styles.centerState}>
          <Text style={[styles.ornament, { color: palette.muted }]}>✦</Text>
          <Text
            style={[
              styles.stateTitle,
              { color: palette.text, fontFamily: TYPOGRAPHY.displayFont },
            ]}
          >
            لا توجد نتائج
          </Text>
          <Text
            style={[
              styles.stateHint,
              { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
            ]}
          >
            جرّب كلمة مختلفة أو اختصر عبارة البحث
          </Text>
        </View>
      ) : (
        <FlatList
          testID="search-results-list"
          data={results}
          keyExtractor={(item, index) => `${item.bookId}:${item.blockId}:${index}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.listContent,
            {
              paddingHorizontal: horizontalPadding,
              paddingBottom: Math.max(insets.bottom, 24) + 12,
            },
          ]}
          renderItem={({ item, index }) => (
            <Pressable
              testID={`search-result-${index}`}
              onPress={() => handleOpenHit(item)}
              style={({ pressed }) => [
                styles.resultCard,
                {
                  backgroundColor: pressed ? palette.surfaceElevated : palette.surface,
                  borderColor: palette.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${item.bookTitle} - ${item.chapterTitle}`}
            >
              <View style={styles.resultMetaRow}>
                {!effectiveBookId && item.bookTitle ? (
                  <Text
                    style={[
                      styles.resultBookTitle,
                      { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                    numberOfLines={1}
                  >
                    {item.bookTitle}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.resultChapterTitle,
                    { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                  numberOfLines={1}
                >
                  {item.chapterTitle}
                </Text>
              </View>

              <Text
                style={[
                  styles.snippetText,
                  { color: palette.text, fontFamily: TYPOGRAPHY.displayFont },
                ]}
              >
                {item.snippetBefore}
                {item.snippetMatch ? (
                  <Text style={[styles.snippetHighlight, { color: palette.accent }]}>
                    {item.snippetMatch}
                  </Text>
                ) : null}
                {item.snippetAfter}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: RADIUS.card,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  clearButton: {
    minWidth: 32,
    minHeight: 32,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scopeChip: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scopeChipText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  ornament: {
    fontSize: 20,
  },
  stateTitle: {
    fontSize: 21,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateHint: {
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 21,
  },
  errorCard: {
    width: '100%',
    maxWidth: 360,
    padding: 22,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    fontSize: 14.5,
    textAlign: 'center',
    lineHeight: 22,
  },
  listContent: {
    paddingTop: SPACING.md,
    gap: 10,
  },
  resultCard: {
    padding: 14,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    gap: 6,
  },
  resultMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  resultBookTitle: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  resultChapterTitle: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
  snippetText: {
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  snippetHighlight: {
    fontWeight: '700',
  },
});
