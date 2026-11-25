import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { Anchor, Book } from '@rewiaty/book-format';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { ReaderHud } from '@/components/reader-hud';
import { ReaderSettingsSheet } from '@/components/reader-settings-sheet';
import { TocModal } from '@/components/toc-modal';
import {
  extractBookmarkContext,
  isPositionBookmarked,
  normalizeBookmarkItems,
  removeBookmarkById,
  toggleBookmarkAtPosition,
} from '@/storage/bookmarks';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { getKv, setKv, touchBookOpened } from '@/storage/database';
import { ensureOfflineFontsDir } from '@/storage/font-assets';
import {
  applyPendingDailyReading,
  emptyReadingStats,
  formatDurationArabic,
  loadReadingStats,
  ReadingSessionTracker,
  saveReadingStats,
  type ReadingSnapshot,
  type ReadingStats,
} from '@/storage/reading-stats';
import {
  DEFAULT_SETTINGS,
  loadThemePreference,
  mergeReaderSettings,
  resetReaderSettings,
  saveReaderSettings,
  selectManualTheme,
} from '@/storage/settings-store';
import { RADIUS, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens, resolveAppTheme, resolveSystemTheme } from '@/theme/reader-theme';
import { notifyThemeListeners } from '@/theme/use-app-theme';
import type {
  BookmarkItem,
  BookReaderState,
  ReaderInsets,
  ReaderSettings,
  RNToWebMessage,
  TocEntry,
  WebToRNMessage,
} from '@/types/reader';
import { debounce } from '@/utils/debounce';
import { progressToPercent } from '@/utils/progress';

const POSITION_SAVE_DEBOUNCE_MS = 500;
const SETTINGS_CLOSE_TAP_COOLDOWN_MS = 300;
/** The reader document is local-only: no remote origins may be navigated to. */
const READER_ORIGIN_WHITELIST: string[] = ['file://*', 'about:blank'];
/** Used when the offline fonts folder is unavailable; needs no whitelist entry. */
const READER_FALLBACK_BASE_URL = 'about:blank';
export const HUD_HINT_KV_KEY = 'reader_hud_hint_seen_v1';
export const HUD_HINT_TEXT = 'اضغط في نص الصفحة عشان تظهر الإعدادات والفهرس، وعلى الأطراف عشان تقلّب.';

// `spread` comes from the engine's ReaderSettings ('auto' | 'single').
type EngineSettingsPayload = Partial<ReaderSettings>;

function isReaderDocumentUrl(url: string, baseUrl: string): boolean {
  if (!url) return false;
  // Android loads an `html` source through a data URL and reports that back.
  if (url === 'about:blank' || url === 'about:srcdoc') return true;
  if (url.startsWith('data:text/html')) return true;
  return url === baseUrl;
}

export function ReaderScreen() {
  useKeepAwake();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const layout = useResponsiveLayout();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = Array.isArray(id) ? id[0] : id;

  const webViewRef = useRef<WebView<Record<string, unknown>> | null>(null);
  const hasSentLoadRef = useRef(false);
  const initialAnchorRef = useRef<Anchor | undefined>(undefined);
  const initialSettingsRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);
  const hasManualThemeRef = useRef(false);
  const fontBaseUrlRef = useRef<string | null>(null);
  const latestStateRef = useRef<BookReaderState | null>(null);
  // 'ready' can arrive again (WebView reload); the first-open hint is checked once per screen.
  const hintCheckedRef = useRef(false);
  const lastPageKeyRef = useRef<string | null>(null);
  const currentAnchorRef = useRef<Anchor | null>(null);
  const bookmarkItemsRef = useRef<BookmarkItem[]>([]);
  const bookRef = useRef<Book | null>(null);
  const readingStatsRef = useRef<ReadingStats | null>(null);
  const readingTrackerRef = useRef<ReadingSessionTracker | null>(null);

  const [readerHtml, setReaderHtml] = useState<string | null>(null);
  const [fontBaseUrl, setFontBaseUrl] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [bookmarkItems, setBookmarkItems] = useState<BookmarkItem[]>([]);
  const [readingStats, setReadingStats] = useState<ReadingStats | null>(null);
  const [readingSnapshot, setReadingSnapshot] = useState<ReadingSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webLoaded, setWebLoaded] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  const readerBaseUrl = fontBaseUrl ?? READER_FALLBACK_BASE_URL;
  const readerBaseUrlRef = useRef(readerBaseUrl);
  readerBaseUrlRef.current = readerBaseUrl;

  const [hudVisible, setHudVisible] = useState(false);
  const [showHudHint, setShowHudHint] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const settingsVisibleRef = useRef(false);
  settingsVisibleRef.current = settingsVisible;
  const hudBeforeSettingsRef = useRef(false);
  const suppressTapUntilRef = useRef(0);
  const [measuredHudHeights, setMeasuredHudHeights] = useState<{
    headerHeight: number;
    footerHeight: number;
  } | null>(null);
  const [measuredRunningFootHeight, setMeasuredRunningFootHeight] = useState<number | null>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [pageInfo, setPageInfo] = useState<{
    chapterId: string;
    page: number;
    pageCount: number;
    bookProgress: number;
    /** The engine is still measuring chapters, so `pageCount` is an estimate. */
    estimated: boolean;
  }>({
    chapterId: 'ch01',
    page: 1,
    pageCount: 1,
    bookProgress: 0,
    estimated: true,
  });

  const themeTokens = useMemo(() => getAppThemeTokens(settings.theme), [settings.theme]);

  bookRef.current = book;
  bookmarkItemsRef.current = bookmarkItems;

  const webviewMarginTop = layout.isTabletLandscape ? 12 : Math.max(insets.top, 8);
  const defaultHeaderHeight =
    Math.max(insets.top, layout.isTablet ? 14 : 12) + 40 + (layout.isTablet ? 14 : 12) + 1;
  const defaultFooterHeight =
    (layout.isTablet ? 16 : 14) + 18 + 8 + 32 + 8 + 16 + Math.max(insets.bottom, 18) + 1;
  const defaultRunningFootHeight =
    4 + 14 + (layout.isTabletLandscape ? 10 : Math.max(insets.bottom, 10));

  const effectiveHudHeaderHeight = measuredHudHeights?.headerHeight ?? defaultHeaderHeight;
  const effectiveHudFooterHeight = measuredHudHeights?.footerHeight ?? defaultFooterHeight;
  const effectiveRunningFootHeight = measuredRunningFootHeight ?? defaultRunningFootHeight;

  const engineInsets = useMemo<ReaderInsets>(
    () => ({
      top: Math.max(0, Math.round(effectiveHudHeaderHeight - webviewMarginTop)),
      bottom: Math.max(0, Math.round(effectiveHudFooterHeight - effectiveRunningFootHeight)),
    }),
    [effectiveHudHeaderHeight, webviewMarginTop, effectiveHudFooterHeight, effectiveRunningFootHeight],
  );
  const engineInsetsRef = useRef<ReaderInsets>(engineInsets);
  engineInsetsRef.current = engineInsets;
  const prevSentInsetsRef = useRef<ReaderInsets | null>(null);

  const effectiveMaxWidth = useMemo(() => {
    if (
      layout.readerMaxReadingWidthCh !== null &&
      settings.maxReadingWidth === DEFAULT_SETTINGS.maxReadingWidth
    ) {
      return layout.readerMaxReadingWidthCh;
    }
    return settings.maxReadingWidth;
  }, [layout.readerMaxReadingWidthCh, settings.maxReadingWidth]);

  const debouncedSave = useMemo(
    () =>
      debounce((targetBookId: string, state: BookReaderState) => {
        void saveBookReaderState(targetBookId, state);
      }, POSITION_SAVE_DEBOUNCE_MS),
    [],
  );

  const flushReadingStats = useCallback(() => {
    const tracker = readingTrackerRef.current;
    if (!tracker) return;

    const pending = tracker.consumePendingDaily();
    if (Object.keys(pending).length === 0) return;

    const next = applyPendingDailyReading(
      readingStatsRef.current ?? emptyReadingStats(),
      pending,
      tracker.getEffectiveWpm(),
    );
    readingStatsRef.current = next;
    setReadingStats(next);
    void saveReadingStats(next).catch(() => undefined);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        debouncedSave.flush();
        // Backgrounding ends the current reading stretch: the idle gap is never counted.
        readingTrackerRef.current?.pause();
        flushReadingStats();
      }
    });
    return () => {
      subscription.remove();
      debouncedSave.flush();
      flushReadingStats();
    };
  }, [debouncedSave, flushReadingStats]);

  const colorSchemeRef = useRef(colorScheme);
  colorSchemeRef.current = colorScheme;

  useEffect(() => {
    hasSentLoadRef.current = false;
    setWebLoaded(false);
    setEngineReady(false);
    setLoadError(null);
    setBook(null);

    if (!bookId) {
      setLoadError('معرّف الكتاب غير صالح.');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const readerAsset = require('@/assets/reader.html') as number;
        const [html, bundle, pref, resolvedFontsUrl, storedStats] = await Promise.all([
          readAssetText(readerAsset),
          readBookBundle(bookId),
          loadThemePreference().catch(() => ({
            settings: { ...DEFAULT_SETTINGS },
            hasManualTheme: false,
          })),
          ensureOfflineFontsDir().catch(() => null),
          loadReadingStats().catch(() => null),
        ]);
        if (cancelled) return;

        await touchBookOpened(bookId, Math.max(Date.now(), bundle.state.updatedAt + 1));
        if (cancelled) return;

        const effectiveTheme = resolveAppTheme(
          pref.settings.theme,
          pref.hasManualTheme,
          colorSchemeRef.current,
        );
        const resolvedSettings: ReaderSettings = {
          ...pref.settings,
          theme: effectiveTheme,
        };

        hasManualThemeRef.current = pref.hasManualTheme;
        initialAnchorRef.current = bundle.state.anchor ?? undefined;
        initialSettingsRef.current = resolvedSettings;
        fontBaseUrlRef.current = resolvedFontsUrl;
        latestStateRef.current = bundle.state;
        currentAnchorRef.current = bundle.state.anchor ?? null;

        const initialBookmarks = normalizeBookmarkItems(
          bundle.state.bookmarkItems,
          bundle.state.bookmarks,
          bundle.book,
        );
        bookmarkItemsRef.current = initialBookmarks;
        readingTrackerRef.current = new ReadingSessionTracker({
          chapters: bundle.book.chapters.map((chapter) => ({
            id: chapter.id,
            wordCount: chapter.wordCount,
          })),
          totalWords: bundle.book.wordCount,
          stats: storedStats,
        });
        if (storedStats) {
          readingStatsRef.current = storedStats;
          setReadingStats(storedStats);
        }

        setSettings(resolvedSettings);
        setBookmarks(bundle.state.bookmarks ?? []);
        setBookmarkItems(initialBookmarks);
        setFontBaseUrl(resolvedFontsUrl);
        setReaderHtml(html);
        setBook(bundle.book);
        setTocEntries(
          bundle.book.chapters.map((ch, idx) => ({
            id: ch.id,
            title: ch.title,
            wordCount: ch.wordCount,
            pageCount: 1,
            startPage: idx + 1,
          })),
        );
        setPageInfo({
          chapterId: bundle.state.chapterId ?? bundle.book.chapters[0]?.id ?? 'ch01',
          page: bundle.state.page ?? 1,
          pageCount: bundle.state.pageCount ?? Math.max(1, bundle.book.chapters.length),
          bookProgress: bundle.state.progress ?? 0,
          // A saved position is reported before the engine has measured anything.
          estimated: true,
        });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'تعذّر فتح الكتاب.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const postToEngine = useCallback((msg: RNToWebMessage) => {
    webViewRef.current?.postMessage(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!webLoaded || !book || hasSentLoadRef.current) return;
    hasSentLoadRef.current = true;
    const loadSettings: EngineSettingsPayload = {
      ...initialSettingsRef.current,
      maxReadingWidth: effectiveMaxWidth,
      // Explicit on first load too: the engine defaults to 'auto', which would spread a wide phone landscape.
      spread: layout.isTabletLandscape ? 'auto' : 'single',
    };
    const initialInsets = engineInsetsRef.current;
    prevSentInsetsRef.current = initialInsets;
    postToEngine({
      type: 'load',
      book,
      anchor: initialAnchorRef.current,
      settings: loadSettings,
      insets: initialInsets,
      ...(fontBaseUrlRef.current ? { fontBaseUrl: fontBaseUrlRef.current } : {}),
    });
  }, [webLoaded, book, effectiveMaxWidth, layout.isTabletLandscape, postToEngine]);

  useEffect(() => {
    if (!hasSentLoadRef.current) return;
    const prev = prevSentInsetsRef.current;
    if (prev && prev.top === engineInsets.top && prev.bottom === engineInsets.bottom) {
      return;
    }
    prevSentInsetsRef.current = engineInsets;
    postToEngine({ type: 'settings', partial: {}, insets: engineInsets });
  }, [engineInsets, postToEngine]);

  // Sync tablet responsive spread & line width when dimensions / orientation change
  const prevResponsiveRef = useRef<{ maxWidth: number; isTabletLandscape: boolean } | null>(null);
  useEffect(() => {
    if (!hasSentLoadRef.current) {
      prevResponsiveRef.current = {
        maxWidth: effectiveMaxWidth,
        isTabletLandscape: layout.isTabletLandscape,
      };
      return;
    }
    const prev = prevResponsiveRef.current;
    if (
      prev &&
      prev.maxWidth === effectiveMaxWidth &&
      prev.isTabletLandscape === layout.isTabletLandscape
    ) {
      return;
    }
    prevResponsiveRef.current = {
      maxWidth: effectiveMaxWidth,
      isTabletLandscape: layout.isTabletLandscape,
    };
    const partial: EngineSettingsPayload = {
      maxReadingWidth: effectiveMaxWidth,
      // Why (product): the open-book spread is a tablet feature; a phone turned sideways keeps one page.
      spread: layout.isTabletLandscape ? 'auto' : 'single',
    };
    postToEngine({ type: 'settings', partial });
  }, [effectiveMaxWidth, layout.isTabletLandscape, postToEngine]);

  // Follow system colorScheme automatically unless the user chose a theme manually
  useEffect(() => {
    if (hasManualThemeRef.current) return;
    const systemTheme = resolveSystemTheme(colorScheme);
    setSettings((prev) => {
      if (prev.theme === systemTheme) return prev;
      const next = { ...prev, theme: systemTheme };
      initialSettingsRef.current = next;
      if (hasSentLoadRef.current) {
        postToEngine({ type: 'settings', partial: { theme: systemTheme } });
      }
      return next;
    });
  }, [colorScheme, postToEngine]);

  const handleOpenSettings = useCallback(() => {
    hudBeforeSettingsRef.current = hudVisible;
    setHudVisible(false);
    setSettingsVisible(true);
  }, [hudVisible]);

  const handleCloseSettings = useCallback(() => {
    setSettingsVisible(false);
    setHudVisible(hudBeforeSettingsRef.current);
    suppressTapUntilRef.current = Date.now() + SETTINGS_CLOSE_TAP_COOLDOWN_MS;
    postToEngine({ type: 'suppress-taps', durationMs: SETTINGS_CLOSE_TAP_COOLDOWN_MS });
  }, [postToEngine]);

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let parsed: WebToRNMessage | null = null;
      try {
        parsed = JSON.parse(event.nativeEvent.data) as WebToRNMessage;
      } catch {
        return;
      }
      if (!parsed || typeof parsed.type !== 'string') return;

      switch (parsed.type) {
        case 'ready':
          setEngineReady(true);
          // Why (product): Sohail could not find the settings in preview 1 — nothing told him the page
          // centre opens the bars. The first time a reader opens a book, show the bars with a hint.
          if (!hintCheckedRef.current) {
            hintCheckedRef.current = true;
            void getKv<boolean>(HUD_HINT_KV_KEY, false)
              .then((seen) => {
                if (seen) return;
                setHudVisible(true);
                setShowHudHint(true);
                return setKv(HUD_HINT_KV_KEY, true);
              })
              // A storage failure only costs the hint; reading must never break over it.
              .catch(() => undefined);
          }
          break;
        case 'toc':
          setTocEntries(parsed.chapters);
          break;
        case 'tap':
          if (Date.now() < suppressTapUntilRef.current) {
            break;
          }
          // Why (QA preview 5, P3-5): the hint covers two lines; any touch means the reader got it.
          setShowHudHint(false);
          if (parsed.zone === 'center') {
            if (settingsVisibleRef.current) {
              handleCloseSettings();
            } else {
              setShowHudHint(false);
              setHudVisible((prev) => !prev);
            }
          }
          break;
        case 'position': {
          // A swipe turns the page without a 'tap' message; a new page also retires the hint.
          const pageKey = `${parsed.chapterId}:${parsed.page}`;
          if (lastPageKeyRef.current !== null && lastPageKeyRef.current !== pageKey) setShowHudHint(false);
          lastPageKeyRef.current = pageKey;
          currentAnchorRef.current = parsed.anchor ?? null;
          setPageInfo({
            chapterId: parsed.chapterId,
            page: parsed.page,
            pageCount: parsed.pageCount,
            bookProgress:
              typeof parsed.bookProgress === 'number' && Number.isFinite(parsed.bookProgress)
                ? parsed.bookProgress
                : 0,
            estimated: parsed.estimated === true,
          });
          if (bookId) {
            const nextState: BookReaderState = {
              anchor: parsed.anchor,
              progress: parsed.bookProgress,
              chapterId: parsed.chapterId,
              page: parsed.page,
              pageCount: parsed.pageCount,
              bookmarks: latestStateRef.current?.bookmarks,
              bookmarkItems: bookmarkItemsRef.current,
              updatedAt: Date.now(),
            };
            latestStateRef.current = nextState;
            debouncedSave(bookId, nextState);
          }

          // F23: feed the tracker from real page turns only (never from a timer).
          const tracker = readingTrackerRef.current;
          if (tracker) {
            const chapter = bookRef.current?.chapters.find((c) => c.id === parsed.chapterId);
            const chapterPageCount = Math.max(1, parsed.chapterPageCount ?? parsed.pageCount);
            tracker.recordProgress({
              chapterId: parsed.chapterId,
              page: parsed.page,
              pageCount: chapterPageCount,
              wordsPerPageEstimate: chapter ? chapter.wordCount / chapterPageCount : 0,
              timestamp: Date.now(),
            });
            setReadingSnapshot(tracker.snapshot());
          }
          break;
        }
        case 'error':
          setLoadError(parsed.message);
          break;
      }
    },
    [bookId, debouncedSave, handleCloseSettings],
  );

  const handleBack = useCallback(() => {
    debouncedSave.flush();
    router.back();
  }, [debouncedSave, router]);

  const handleShouldStartLoadWithRequest = useCallback((request: WebViewNavigation) => {
    const targetUrl = request.url ?? '';
    if (isReaderDocumentUrl(targetUrl, readerBaseUrlRef.current)) return true;

    // Any other navigation is an outbound link: http(s) leaves the app, everything
    // else (file://, javascript:, intent://, ...) is refused outright.
    if (/^https?:\/\//i.test(targetUrl)) {
      void Linking.openURL(targetUrl).catch(() => undefined);
    }
    return false;
  }, []);

  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      postToEngine({ type: 'goto', chapterId });
    },
    [postToEngine],
  );

  const handleSeekPage = useCallback(
    (targetPage: number) => {
      postToEngine({ type: 'goto', page: targetPage });
    },
    [postToEngine],
  );

  const handleSettingsChange = useCallback(
    (partial: Partial<ReaderSettings>) => {
      postToEngine({ type: 'settings', partial });
      setSettings((prev) => {
        const next = mergeReaderSettings(prev, partial);
        initialSettingsRef.current = next;
        void saveReaderSettings(next);
        if (partial.theme !== undefined) {
          hasManualThemeRef.current = true;
          notifyThemeListeners({ theme: next.theme, hasManualTheme: true });
          void selectManualTheme(next.theme);
        }
        return next;
      });
    },
    [postToEngine],
  );

  const handleResetSettings = useCallback(() => {
    hasManualThemeRef.current = false;
    const systemTheme = resolveSystemTheme(colorSchemeRef.current);
    const defaults: ReaderSettings = { ...DEFAULT_SETTINGS, theme: systemTheme };
    postToEngine({ type: 'settings', partial: defaults });
    initialSettingsRef.current = defaults;
    setSettings(defaults);
    notifyThemeListeners({ theme: systemTheme, hasManualTheme: false });
    void resetReaderSettings();
  }, [postToEngine]);

  const activeChapterTitle = useMemo(() => {
    const fromToc = tocEntries.find((c) => c.id === pageInfo.chapterId)?.title;
    if (fromToc) return fromToc;
    return book?.chapters.find((c) => c.id === pageInfo.chapterId)?.title ?? book?.meta.title ?? '';
  }, [tocEntries, book, pageInfo.chapterId]);

  const persistBookmarks = useCallback(
    (nextItems: BookmarkItem[]) => {
      bookmarkItemsRef.current = nextItems;
      setBookmarkItems(nextItems);

      const nextPages = Array.from(
        new Set(
          nextItems
            .map((item) => item.page)
            .filter((page): page is number => typeof page === 'number' && Number.isFinite(page)),
        ),
      ).sort((a, b) => a - b);
      setBookmarks(nextPages);

      if (!bookId) return;
      const base = latestStateRef.current ?? {
        anchor: null,
        progress: 0,
        chapterId: pageInfo.chapterId,
        page: pageInfo.page,
        pageCount: pageInfo.pageCount,
        updatedAt: Date.now(),
      };
      const updatedState: BookReaderState = {
        ...base,
        bookmarks: nextPages,
        bookmarkItems: nextItems,
        updatedAt: Date.now(),
      };
      latestStateRef.current = updatedState;
      void saveBookReaderState(bookId, updatedState);
    },
    [bookId, pageInfo.chapterId, pageInfo.page, pageInfo.pageCount],
  );

  const handleToggleBookmark = useCallback(() => {
    const currentBook = bookRef.current;
    const anchor = currentAnchorRef.current;
    const context =
      currentBook && anchor ? extractBookmarkContext(currentBook, anchor) : null;

    const result = toggleBookmarkAtPosition(bookmarkItemsRef.current, {
      anchor,
      page: pageInfo.page,
      chapterId: context?.chapterId || pageInfo.chapterId,
      chapterTitle: context?.chapterTitle || activeChapterTitle,
      quote: context?.quote ?? '',
      contextBefore: context?.contextBefore ?? '',
      contextAfter: context?.contextAfter ?? '',
      now: Date.now(),
    });
    persistBookmarks(result.items);
  }, [activeChapterTitle, pageInfo.chapterId, pageInfo.page, persistBookmarks]);

  const handleDeleteBookmark = useCallback(
    (id: string) => {
      persistBookmarks(removeBookmarkById(bookmarkItemsRef.current, id));
    },
    [persistBookmarks],
  );

  const handleOpenBookmark = useCallback(
    (item: BookmarkItem, anchor: Anchor | null) => {
      if (anchor) {
        postToEngine({ type: 'goto', anchor });
      } else if (item.page !== undefined) {
        postToEngine({ type: 'goto', page: item.page });
      }
    },
    [postToEngine],
  );

  const effectiveDir: 'rtl' | 'ltr' =
    settings.dirOverride && settings.dirOverride !== 'auto'
      ? settings.dirOverride
      : book?.meta.dir ?? 'rtl';

  const isBookmarked =
    isPositionBookmarked(bookmarkItems, currentAnchorRef.current, pageInfo.page) ||
    bookmarks.includes(pageInfo.page);
  const progressRatio =
    pageInfo.pageCount > 1 ? Math.max(0, Math.min(1, (pageInfo.page - 1) / (pageInfo.pageCount - 1))) : 0;
  const pctRead = progressToPercent(pageInfo.bookProgress);

  if (loadError) {
    return (
      <View
        testID="reader-error-state"
        style={[
          styles.centerState,
          {
            backgroundColor: themeTokens.bg,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <StatusBar style={themeTokens.isDark ? 'light' : 'dark'} />
        <View
          style={[
            styles.errorCard,
            {
              backgroundColor: themeTokens.surface,
              borderColor: themeTokens.border,
            },
          ]}
        >
          <Text style={[styles.errorOrnament, { color: themeTokens.danger }]}>✦</Text>
          <Text
            style={[
              styles.errorText,
              { color: themeTokens.danger, fontFamily: TYPOGRAPHY.uiFont },
            ]}
            selectable
          >
            {loadError}
          </Text>
          <Pressable
            onPress={() => router.back()}
            hitSlop={4}
            style={({ pressed }) => [
              styles.backBtn,
              { backgroundColor: themeTokens.ctaBg },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.backBtnText,
                { color: themeTokens.ctaText, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              العودة إلى المكتبة
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: layout.isTabletLandscape ? themeTokens.deskBg : themeTokens.bg,
          paddingHorizontal: layout.isTabletLandscape ? 20 : 0,
          paddingVertical: layout.isTabletLandscape ? 16 : 0,
        },
      ]}
    >
      <StatusBar style={themeTokens.isDark ? 'light' : 'dark'} />

      <View
        testID="reader-book-vessel"
        style={[
          styles.bookVessel,
          {
            backgroundColor: themeTokens.bg,
          },
          layout.isTabletLandscape && {
            borderRadius: 6,
            borderWidth: 1,
            borderColor: themeTokens.boardRim,
            boxShadow: '0 18px 46px rgba(0, 0, 0, 0.22)',
          },
        ]}
      >
        {/* Living page-edge thickness indicators */}
        <View
          pointerEvents="none"
          style={[
            styles.edgeStack,
            styles.edgeRight,
            {
              width: 2 + progressRatio * (layout.isTabletLandscape ? 8 : 4),
              backgroundColor: themeTokens.pageEdgeBg,
              borderLeftColor: themeTokens.pageEdge,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.edgeStack,
            styles.edgeLeft,
            {
              width: (layout.isTabletLandscape ? 10 : 6) - progressRatio * (layout.isTabletLandscape ? 7 : 4),
              backgroundColor: themeTokens.pageEdgeBg,
              borderRightColor: themeTokens.pageEdge,
            },
          ]}
        />

        {/* Center book spine crease in tablet landscape open-book spread */}
        {layout.isTabletLandscape ? (
          <View pointerEvents="none" style={styles.spineCenterGuide}>
            <View
              style={[
                styles.spineHeadband,
                styles.spineHeadbandTop,
                { backgroundColor: themeTokens.ribbon },
              ]}
            />
            <View
              style={[
                styles.spineHairline,
                { backgroundColor: themeTokens.spineCrease },
              ]}
            />
            <View
              style={[
                styles.spineHeadband,
                styles.spineHeadbandBottom,
                { backgroundColor: themeTokens.ribbon },
              ]}
            />
          </View>
        ) : null}

        {readerHtml && book ? (
          <WebView<Record<string, unknown>>
            ref={webViewRef}
            testID="reader-webview"
            accessibilityLabel="صفحة الرواية"
            originWhitelist={READER_ORIGIN_WHITELIST}
            {...(Platform.OS === 'android'
              ? // Why (tech): the engine renders the 8 bundled woff2 fonts as file://
                // subresources, and Android WebView refuses file:// subresources unless
                // file access is on. iOS reads them through allowingReadAccessToURL instead.
                { allowFileAccess: true }
              : {})}
            // Why (tech): on iOS the reader only ever needs to read the fonts folder —
            // never the whole cache directory — so read access stops there.
            allowingReadAccessToURL={fontBaseUrl?.startsWith('file://') ? fontBaseUrl : undefined}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            source={{
              html: readerHtml,
              baseUrl: readerBaseUrl,
            }}
            style={[
              styles.webview,
              {
                backgroundColor: themeTokens.bg,
                marginTop: webviewMarginTop,
              },
            ]}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            overScrollMode="never"
            bounces={false}
            onLoadEnd={() => setWebLoaded(true)}
            onMessage={handleWebViewMessage}
          />
        ) : null}

        {/* Quiet Running Footer */}
        {book ? (
          <View
            testID="reader-running-footer"
            pointerEvents="none"
            onLayout={(event: LayoutChangeEvent) => {
              const h = Math.round(event.nativeEvent.layout.height);
              if (h > 0 && h !== measuredRunningFootHeight) {
                setMeasuredRunningFootHeight(h);
              }
            }}
            style={[
              styles.runningFoot,
              {
                paddingBottom: layout.isTabletLandscape ? 10 : Math.max(insets.bottom, 10),
                paddingHorizontal: layout.isTablet ? 36 : 24,
                backgroundColor: themeTokens.bg,
                opacity: engineReady ? 1 : 0,
              },
            ]}
          >
            <Text
              testID="reader-running-chapter"
              style={[
                styles.runningFootText,
                { color: themeTokens.muted, fontFamily: TYPOGRAPHY.uiFont },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {activeChapterTitle}
            </Text>
            {readingSnapshot && readingSnapshot.bookRemainingMinutes > 0 ? (
              <Text
                testID="reader-remaining-time"
                numberOfLines={1}
                style={[
                  styles.runningFootRemaining,
                  { color: themeTokens.muted, fontFamily: TYPOGRAPHY.uiFont },
                ]}
              >
                {`يتبقّى ${formatDurationArabic(readingSnapshot.bookRemainingMinutes)}`}
              </Text>
            ) : null}
            <Text
              numberOfLines={1}
              style={[
                styles.runningFootNumbers,
                { color: themeTokens.muted, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              {`${pageInfo.page} / ${pageInfo.estimated ? '~' : ''}${pageInfo.pageCount} · ${pctRead}%`}
            </Text>
          </View>
        ) : null}

        {/* Signature Crimson Silk Bookmark Ribbon */}
        {book ? (
          <Pressable
            testID="reader-bookmark-ribbon"
            onPress={handleToggleBookmark}
            hitSlop={hudVisible ? { top: 0, bottom: 10, left: 10, right: 10 } : 10}
            style={[
              styles.ribbonZone,
              layout.isTabletLandscape
                ? styles.ribbonCenterSpine
                : effectiveDir === 'rtl'
                  ? styles.ribbonLeft
                  : styles.ribbonRight,
              {
                top: hudVisible
                  ? effectiveHudHeaderHeight + 2
                  : layout.isTabletLandscape
                    ? 0
                    : insets.top,
                zIndex: hudVisible ? 25 : 15,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={isBookmarked ? 'إزالة العلامة المرجعية' : 'حفظ علامة مرجعية'}
            accessibilityState={{ selected: isBookmarked }}
          >
            <Svg
              width={18}
              height={isBookmarked ? 42 : 16}
              viewBox={isBookmarked ? '0 0 18 42' : '0 0 18 16'}
              style={{ opacity: isBookmarked ? 1 : 0.46 }}
            >
              <Path
                d={
                  isBookmarked
                    ? 'M0 0 H18 V42 L9 34 L0 42 Z'
                    : 'M0 0 H18 V16 L9 12 L0 16 Z'
                }
                fill={themeTokens.ribbon}
              />
            </Svg>
          </Pressable>
        ) : null}

        {!engineReady ? (
          <View
            testID="reader-loading-overlay"
            style={[styles.loadingOverlay, { backgroundColor: themeTokens.bg }]}
            pointerEvents="none"
          >
            <ActivityIndicator size="large" color={themeTokens.accent} />
            <Text
              style={[
                styles.loadingText,
                { color: themeTokens.muted, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              جاري تجهيز الصفحات...
            </Text>
          </View>
        ) : null}

        {book ? (
          <>
            {showHudHint && hudVisible ? (
              <View
                testID="reader-hud-hint"
                pointerEvents="none"
                style={[styles.hudHint, { backgroundColor: themeTokens.surface, borderColor: themeTokens.border }]}
              >
                <Text style={[styles.hudHintText, { color: themeTokens.text, fontFamily: TYPOGRAPHY.uiFont }]}>
                  {HUD_HINT_TEXT}
                </Text>
              </View>
            ) : null}
            <ReaderHud
              visible={hudVisible}
              bookTitle={book.meta.title}
              chapterTitle={activeChapterTitle}
              page={pageInfo.page}
              pageCount={pageInfo.pageCount}
              estimated={pageInfo.estimated}
              chapterCount={book.chapters.length}
              isBookmarked={isBookmarked}
              isTablet={layout.isTablet}
              isTabletLandscape={layout.isTabletLandscape}
              dir={effectiveDir}
              theme={settings.theme}
              onBack={handleBack}
              onOpenToc={() => setTocVisible(true)}
              onOpenSettings={handleOpenSettings}
              onSeekPage={handleSeekPage}
              onBarsLayout={setMeasuredHudHeights}
            />

            <TocModal
              visible={tocVisible}
              chapters={tocEntries}
              activeChapterId={pageInfo.chapterId}
              dir={effectiveDir}
              theme={settings.theme}
              bookmarks={bookmarkItems}
              book={book}
              onOpenBookmark={handleOpenBookmark}
              onDeleteBookmark={handleDeleteBookmark}
              readingStats={readingStats}
              readingSnapshot={readingSnapshot}
              onSelectChapter={handleSelectChapter}
              onClose={() => setTocVisible(false)}
            />

            <ReaderSettingsSheet
              visible={settingsVisible}
              settings={settings}
              onChange={handleSettingsChange}
              onReset={handleResetSettings}
              onClose={handleCloseSettings}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hudHint: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    marginHorizontal: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: RADIUS.button,
    borderWidth: 1,
    zIndex: 5,
    maxWidth: 420,
  },
  hudHintText: { fontSize: 15, lineHeight: 24, textAlign: 'center' },
  container: {
    flex: 1,
  },
  bookVessel: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
  },
  edgeStack: {
    position: 'absolute',
    top: 16,
    bottom: 16,
    zIndex: 4,
  },
  edgeRight: {
    right: 0,
    borderLeftWidth: 0.5,
  },
  edgeLeft: {
    left: 0,
    borderRightWidth: 0.5,
  },
  spineCenterGuide: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 24,
    marginLeft: -12,
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
  },
  spineHairline: {
    flex: 1,
    width: 1,
    opacity: 0.35,
  },
  spineHeadband: {
    width: 22,
    height: 4,
    opacity: 0.8,
  },
  spineHeadbandTop: {
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  spineHeadbandBottom: {
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  runningFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
  },
  runningFootText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 10.5,
    opacity: 0.6,
    textAlign: 'right',
  },
  runningFootNumbers: {
    flexShrink: 0,
    fontSize: 10.5,
    opacity: 0.6,
    fontVariant: ['tabular-nums'],
  },
  runningFootRemaining: {
    flexShrink: 0,
    fontSize: 10.5,
    opacity: 0.6,
    fontVariant: ['tabular-nums'],
  },
  ribbonZone: {
    position: 'absolute',
    width: 34,
    height: 52,
    alignItems: 'center',
    zIndex: 15,
  },
  ribbonLeft: {
    left: 16,
  },
  ribbonRight: {
    right: 16,
  },
  ribbonCenterSpine: {
    left: '50%',
    marginLeft: -17,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 18,
  },
  loadingText: {
    fontSize: 13.5,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorCard: {
    width: '100%',
    maxWidth: 360,
    padding: 22,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    gap: 14,
  },
  errorOrnament: {
    fontSize: 20,
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  backBtn: {
    minHeight: 42,
    paddingHorizontal: 20,
    borderRadius: RADIUS.button,
    justifyContent: 'center',
  },
  backBtnText: {
    fontWeight: '600',
    fontSize: 13.5,
  },
  pressed: {
    opacity: 0.78,
  },
});
