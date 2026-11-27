import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { HighlightNoteModal } from '@/components/highlight-note-modal';
import { HighlightToolbar } from '@/components/highlight-toolbar';
import { DictionarySheet } from '@/components/dictionary-sheet';
import { ReaderHud } from '@/components/reader-hud';
import { ReaderSettingsSheet } from '@/components/reader-settings-sheet';
import { TocModal } from '@/components/toc-modal';
import {
  DICTIONARY_ATTRIBUTION,
  DICTIONARY_UNAVAILABLE_REASON,
  lookupDictionaryWord,
  openBundledDictionaryDb,
  type DictionaryLookupResult,
} from '@/storage/dictionary';
import {
  extractBookmarkContext,
  isPositionBookmarked,
  normalizeBookmarkItems,
  removeBookmarkById,
  toggleBookmarkAtPosition,
} from '@/storage/bookmarks';
import {
  addHighlight,
  normalizeHighlightItems,
  removeHighlightById,
  resolveHighlightsForBook,
  shareHighlightsMarkdown,
  updateHighlightColor,
  updateHighlightNote,
} from '@/storage/highlights';
import {
  readAssetText,
  readBookBundle,
  saveBookReaderState,
  getBookDir,
  getBooksRootDir,
} from '@/storage/bundle';
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
  getSectionResetPartial,
  loadThemePreference,
  mergeReaderSettings,
  resetSection,
  saveReaderSettings,
  selectManualTheme,
  type SettingsTabId,
} from '@/storage/settings-store';
import { RADIUS, TYPOGRAPHY, useResponsiveLayout } from '@/theme/layout';
import { getAppThemeTokens, resolveAppTheme, resolveSystemTheme } from '@/theme/reader-theme';
import { notifyThemeListeners } from '@/theme/use-app-theme';
import type {
  BookmarkItem,
  BookReaderState,
  HighlightColor,
  HighlightItem,
  ReaderInsets,
  ReaderSettings,
  RNToWebMessage,
  SelectionInfo,
  SelectionRect,
  TocEntry,
  WebToRNMessage,
} from '@/types/reader';
import { debounce } from '@/utils/debounce';
import { progressToPercent } from '@/utils/progress';
import { showToast } from '@/utils/toast';

const POSITION_SAVE_DEBOUNCE_MS = 500;
const SETTINGS_CLOSE_TAP_COOLDOWN_MS = 300;
/** The reader document is local-only: no remote origins may be navigated to. */
const READER_ORIGIN_WHITELIST: string[] = ['file://*', 'about:blank'];
/** Used while the book folder is being resolved; needs no whitelist entry. */
const READER_FALLBACK_BASE_URL = 'about:blank';
// Why (product): native/engine errors are English and technical (CI run 45597933250 showed
// "Call to function 'FileSystemFile.text' has been rejected…" to the reader). Readers only see Arabic.
const ARABIC_RE = /[\u0600-\u06FF]/;
export const READER_OPEN_FAILED_MESSAGE = 'تعذّر فتح الكتاب. ارجع للمكتبة وجرّب تفتحه تاني.';
export function readerErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (message && ARABIC_RE.test(message)) return message;
  if (message) console.warn('[reader] open failed:', message);
  return READER_OPEN_FAILED_MESSAGE;
}

/** Arabic diacritics + tatweel, stripped before a dictionary lookup. */
const ARABIC_DIACRITICS_RE = /[\u064B-\u0652\u0670\u0640]/g;
/** Arabic letters/digits only: the text around a selection (quotes, punctuation) is dropped. */
const ARABIC_LOOKUP_TOKEN_RE = /[\u0621-\u064A\u0660-\u0669]+/g;

/**
 * F49: pick the word to look up out of a reader selection.
 *
 * A long-press may select a whole phrase, so the first Arabic token of at least
 * two letters is used; diacritics are stripped because the dictionary index is
 * stored without them.
 */
export function extractLookupWord(quote: string): string {
  const cleaned = typeof quote === 'string' ? quote.replace(ARABIC_DIACRITICS_RE, '') : '';
  const tokens = cleaned.match(ARABIC_LOOKUP_TOKEN_RE) ?? [];
  return tokens.find((token) => token.length >= 2) ?? '';
}

export const HUD_HINT_KV_KEY = 'reader_hud_hint_seen_v1';
// Why (product, R5/A4): edges no longer turn pages — the hint used to teach a gesture the
// engine now ignores. Swiping is the only way to turn, so say that instead.
export const HUD_HINT_TEXT = 'اضغط في نص الصفحة عشان تظهر الإعدادات والفهرس، واسحب بإيدك عشان تقلّب.';

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
  const { id, blockId, charOffset } = useLocalSearchParams<{
    id: string;
    blockId?: string;
    charOffset?: string;
  }>();
  const bookId = Array.isArray(id) ? id[0] : id;
  const targetBlockId = Array.isArray(blockId) ? blockId[0] : blockId;
  const targetCharOffset = Array.isArray(charOffset) ? charOffset[0] : charOffset;
  const searchAnchor = useMemo<Anchor | undefined>(() => {
    if (!targetBlockId || !targetBlockId.trim()) return undefined;
    const parsedOffset = targetCharOffset !== undefined ? Number(targetCharOffset) : 0;
    return {
      blockId: targetBlockId.trim(),
      charOffset: Number.isFinite(parsedOffset) && parsedOffset >= 0 ? Math.floor(parsedOffset) : 0,
    };
  }, [targetBlockId, targetCharOffset]);
  const searchAnchorRef = useRef<Anchor | undefined>(searchAnchor);
  searchAnchorRef.current = searchAnchor;
  const appliedSearchKeyRef = useRef<string | null>(null);

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
  const highlightsRef = useRef<HighlightItem[]>([]);
  const bookRef = useRef<Book | null>(null);
  const readingStatsRef = useRef<ReadingStats | null>(null);
  const readingTrackerRef = useRef<ReadingSessionTracker | null>(null);

  const [readerHtml, setReaderHtml] = useState<string | null>(null);
  // Relative `assets/….png` paths in the Markdown resolve against the book folder, so the WebView
  // document is based there — not at the fonts folder it used to borrow as a base.
  const [bookBaseUrl, setBookBaseUrl] = useState<string | null>(null);
  // iOS read access stops at the books root: every book folder and the shared `_fonts` dir live
  // under it, and nothing else in the app sandbox is reachable from the WebView.
  const [readAccessUrl, setReadAccessUrl] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [bookmarkItems, setBookmarkItems] = useState<BookmarkItem[]>([]);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [activeSelection, setActiveSelection] = useState<SelectionInfo | null>(null);
  const [editingHighlightState, setEditingHighlightState] = useState<{
    id: string;
    rect: SelectionRect;
  } | null>(null);
  const [noteModalTarget, setNoteModalTarget] = useState<
    | { mode: 'create'; selection: SelectionInfo; color: HighlightColor }
    | { mode: 'edit'; highlight: HighlightItem }
    | null
  >(null);
  /**
   * F49 long-press dictionary. The sheet is driven by four flat pieces of state so it can render
   * its loading/unavailable states without a second component owning the lookup.
   */
  const [dictVisible, setDictVisible] = useState(false);
  const [dictWord, setDictWord] = useState('');
  const [dictLoading, setDictLoading] = useState(false);
  const [dictResult, setDictResult] = useState<DictionaryLookupResult | null>(null);
  /** Monotonic token: a lookup that resolves after a newer one (or after unmount) is discarded. */
  const dictRequestRef = useRef(0);
  const noteModalOpenRef = useRef(false);
  noteModalOpenRef.current = noteModalTarget !== null;
  const [vesselSize, setVesselSize] = useState<{ width: number; height: number }>(() => {
    const win = Dimensions.get('window');
    return { width: win.width, height: win.height };
  });
  const [readingStats, setReadingStats] = useState<ReadingStats | null>(null);
  const [readingSnapshot, setReadingSnapshot] = useState<ReadingSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webLoaded, setWebLoaded] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  const readerBaseUrl = bookBaseUrl ?? READER_FALLBACK_BASE_URL;
  const readerBaseUrlRef = useRef(readerBaseUrl);
  readerBaseUrlRef.current = readerBaseUrl;

  const [hudVisible, setHudVisible] = useState(false);
  const [showHudHint, setShowHudHint] = useState(false);
  const hintOpacity = useSharedValue(1);
  const hintAnimatedStyle = useAnimatedStyle(() => ({ opacity: hintOpacity.get() }));
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
  const [imageProof, setImageProof] = useState<{ count: number; width: number; height: number } | null>(
    null,
  );

  const themeTokens = useMemo(() => getAppThemeTokens(settings.theme), [settings.theme]);

  bookRef.current = book;
  bookmarkItemsRef.current = bookmarkItems;
  highlightsRef.current = highlights;

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

  // A lookup that is still in flight when the reader closes must not set state afterwards.
  useEffect(
    () => () => {
      dictRequestRef.current += 1;
    },
    [],
  );

  const colorSchemeRef = useRef(colorScheme);
  colorSchemeRef.current = colorScheme;

  useEffect(() => {
    hasSentLoadRef.current = false;
    setWebLoaded(false);
    setEngineReady(false);
    setLoadError(null);
    setBook(null);
    setBookBaseUrl(null);
    setReadAccessUrl(null);
    setImageProof(null);

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

        // Base the reader document at this book's folder so `assets/…` figures resolve, and let
        // iOS read only the books root (the book folders plus the shared `_fonts` directory).
        const bookDirUri = getBookDir(bookId).uri;
        setBookBaseUrl(bookDirUri.endsWith('/') ? bookDirUri : `${bookDirUri}/`);
        const booksRootUri = getBooksRootDir().uri;
        setReadAccessUrl(booksRootUri.endsWith('/') ? booksRootUri : `${booksRootUri}/`);

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
        const activeSearchAnchor = searchAnchorRef.current;
        appliedSearchKeyRef.current = activeSearchAnchor
          ? `${bookId}:${activeSearchAnchor.blockId}:${activeSearchAnchor.charOffset}`
          : null;
        initialAnchorRef.current = activeSearchAnchor ?? bundle.state.anchor ?? undefined;
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
        const initialHighlights = normalizeHighlightItems(bundle.state.highlights, bundle.book);
        highlightsRef.current = initialHighlights;
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
        setBookmarkItems(initialBookmarks);
        setHighlights(initialHighlights);
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
        setLoadError(readerErrorMessage(err));
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
    if (!bookId || !engineReady || !hasSentLoadRef.current || !searchAnchor) return;
    const key = `${bookId}:${searchAnchor.blockId}:${searchAnchor.charOffset}`;
    if (appliedSearchKeyRef.current === key) return;
    appliedSearchKeyRef.current = key;
    postToEngine({ type: 'goto', anchor: searchAnchor });
  }, [bookId, engineReady, searchAnchor, postToEngine]);

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
      highlights: resolveHighlightsForBook(book, highlightsRef.current),
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
    setActiveSelection(null);
    setEditingHighlightState(null);
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
              setActiveSelection(null);
              setEditingHighlightState(null);
              setShowHudHint(false);
              setHudVisible((prev) => !prev);
            }
          }
          break;
        case 'selection':
          if (parsed.selection) {
            setHudVisible(false);
            setShowHudHint(false);
            setEditingHighlightState(null);
            setActiveSelection(parsed.selection);
          } else if (!noteModalOpenRef.current) {
            setActiveSelection(null);
          }
          break;
        case 'highlight-tap':
          setHudVisible(false);
          setShowHudHint(false);
          setActiveSelection(null);
          setEditingHighlightState({ id: parsed.highlightId, rect: parsed.rect });
          break;
        case 'position': {
          // A swipe turns the page without a 'tap' message; a new page also retires the hint.
          const pageKey = `${parsed.chapterId}:${parsed.page}`;
          if (lastPageKeyRef.current !== null && lastPageKeyRef.current !== pageKey) {
            setShowHudHint(false);
            setActiveSelection(null);
            setEditingHighlightState(null);
          }
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
              highlights: highlightsRef.current,
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
        case 'image-rendered':
          setImageProof({ count: parsed.count, width: parsed.width, height: parsed.height });
          break;
        case 'error':
          setLoadError(readerErrorMessage(parsed.message));
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

  useEffect(() => {
    if (!showHudHint || !hudVisible) {
      hintOpacity.set(1);
      return;
    }
    hintOpacity.set(1);
    const fadeTimer = setTimeout(() => {
      hintOpacity.set(withTiming(0, { duration: 350 }));
    }, 5000);
    const hideTimer = setTimeout(() => {
      setShowHudHint(false);
    }, 5350);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [showHudHint, hudVisible, hintOpacity]);

  const handleResetSettings = useCallback(
    (tab: SettingsTabId) => {
      const systemTheme = resolveSystemTheme(colorSchemeRef.current);
      const sectionPartial = getSectionResetPartial(tab, systemTheme);
      const enginePartial: EngineSettingsPayload =
        tab === 'layout' && layout.readerMaxReadingWidthCh !== null
          ? { ...sectionPartial, maxReadingWidth: layout.readerMaxReadingWidthCh }
          : sectionPartial;
      postToEngine({ type: 'settings', partial: enginePartial });
      setSettings((prev) => {
        const next = mergeReaderSettings(prev, sectionPartial);
        initialSettingsRef.current = next;
        void resetSection(tab, undefined, systemTheme);
        if (tab === 'theme') {
          hasManualThemeRef.current = false;
          notifyThemeListeners({ theme: systemTheme, hasManualTheme: false });
        }
        return next;
      });
    },
    [layout.readerMaxReadingWidthCh, postToEngine],
  );

  const activeChapterTitle = useMemo(() => {
    const fromToc = tocEntries.find((c) => c.id === pageInfo.chapterId)?.title;
    if (fromToc) return fromToc;
    return book?.chapters.find((c) => c.id === pageInfo.chapterId)?.title ?? book?.meta.title ?? '';
  }, [tocEntries, book, pageInfo.chapterId]);

  const persistBookmarks = useCallback(
    (nextItems: BookmarkItem[]) => {
      bookmarkItemsRef.current = nextItems;
      setBookmarkItems(nextItems);

      // Why: once bookmarks live in bookmarkItems the legacy page list is retired; keeping it
      // would resurrect deleted legacy bookmarks on the next load (Codex #19 P2).
      const nextPages: number[] = [];

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
        highlights: highlightsRef.current,
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

  const persistHighlights = useCallback(
    (nextItems: HighlightItem[]) => {
      highlightsRef.current = nextItems;
      setHighlights(nextItems);

      const currentBook = bookRef.current;
      if (currentBook && hasSentLoadRef.current) {
        postToEngine({
          type: 'highlights',
          highlights: resolveHighlightsForBook(currentBook, nextItems),
        });
      }

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
        bookmarkItems: bookmarkItemsRef.current,
        highlights: nextItems,
        updatedAt: Date.now(),
      };
      latestStateRef.current = updatedState;
      void saveBookReaderState(bookId, updatedState);
    },
    [bookId, pageInfo.chapterId, pageInfo.page, pageInfo.pageCount, postToEngine],
  );

  const editingHighlight = useMemo(
    () =>
      editingHighlightState
        ? (highlights.find((item) => item.id === editingHighlightState.id) ?? null)
        : null,
    [editingHighlightState, highlights],
  );

  const handleSelectHighlightColor = useCallback(
    (color: HighlightColor) => {
      if (activeSelection) {
        const chapterTitle =
          bookRef.current?.chapters.find((c) => c.id === activeSelection.chapterId)?.title ??
          activeChapterTitle;
        const { items } = addHighlight(highlightsRef.current, {
          anchor: activeSelection.anchor,
          length: activeSelection.length,
          color,
          quote: activeSelection.quote,
          contextBefore: activeSelection.contextBefore,
          contextAfter: activeSelection.contextAfter,
          chapterId: activeSelection.chapterId,
          chapterTitle,
        });
        persistHighlights(items);
        setActiveSelection(null);
        postToEngine({ type: 'clear-selection' });
        return;
      }

      if (editingHighlightState) {
        persistHighlights(updateHighlightColor(highlightsRef.current, editingHighlightState.id, color));
        setEditingHighlightState(null);
      }
    },
    [activeChapterTitle, activeSelection, editingHighlightState, persistHighlights, postToEngine],
  );

  const handlePressToolbarNote = useCallback(() => {
    if (activeSelection) {
      setNoteModalTarget({ mode: 'create', selection: activeSelection, color: 'gold' });
      setActiveSelection(null);
      postToEngine({ type: 'clear-selection' });
      return;
    }
    if (editingHighlight) {
      setNoteModalTarget({ mode: 'edit', highlight: editingHighlight });
      setEditingHighlightState(null);
    }
  }, [activeSelection, editingHighlight, postToEngine]);

  /**
   * F49: look up the selected word (or the quoted text of the highlight being edited)
   * in the bundled offline dictionary. The sheet opens immediately and fills in.
   */
  const handlePressToolbarDictionary = useCallback(() => {
    const sourceQuote = activeSelection?.quote ?? editingHighlight?.quote ?? '';
    const word = extractLookupWord(sourceQuote);
    const requestId = dictRequestRef.current + 1;
    dictRequestRef.current = requestId;

    setActiveSelection(null);
    setEditingHighlightState(null);
    postToEngine({ type: 'clear-selection' });
    setDictWord(word);
    setDictResult(null);
    setDictVisible(true);

    if (!word) {
      // Nothing Arabic to look up: say so instead of showing a "looking…" state forever.
      setDictLoading(false);
      setDictResult({
        status: 'not_found',
        query: sourceQuote.trim(),
        normalized: '',
        attribution: DICTIONARY_ATTRIBUTION,
      });
      return;
    }

    setDictLoading(true);
    void (async () => {
      let result: DictionaryLookupResult;
      try {
        const db = await openBundledDictionaryDb();
        result = await lookupDictionaryWord(word, db);
      } catch {
        result = {
          status: 'unavailable',
          query: word,
          reasonAr: DICTIONARY_UNAVAILABLE_REASON,
          attribution: DICTIONARY_ATTRIBUTION,
        };
      }
      if (dictRequestRef.current !== requestId) return;
      setDictResult(result);
      setDictLoading(false);
    })();
  }, [activeSelection, editingHighlight, postToEngine]);

  const handlePressToolbarDelete = useCallback(() => {
    if (!editingHighlightState) return;
    persistHighlights(removeHighlightById(highlightsRef.current, editingHighlightState.id));
    setEditingHighlightState(null);
  }, [editingHighlightState, persistHighlights]);

  const handleSaveNoteModal = useCallback(
    (note: string) => {
      if (!noteModalTarget) return;
      if (noteModalTarget.mode === 'create') {
        const sel = noteModalTarget.selection;
        const chapterTitle =
          bookRef.current?.chapters.find((c) => c.id === sel.chapterId)?.title ??
          activeChapterTitle;
        const { items } = addHighlight(highlightsRef.current, {
          anchor: sel.anchor,
          length: sel.length,
          color: noteModalTarget.color,
          quote: sel.quote,
          contextBefore: sel.contextBefore,
          contextAfter: sel.contextAfter,
          chapterId: sel.chapterId,
          chapterTitle,
          note,
        });
        persistHighlights(items);
      } else {
        persistHighlights(
          updateHighlightNote(highlightsRef.current, noteModalTarget.highlight.id, note),
        );
      }
      setNoteModalTarget(null);
    },
    [activeChapterTitle, noteModalTarget, persistHighlights],
  );

  const handleDeleteHighlight = useCallback(
    (id: string) => {
      persistHighlights(removeHighlightById(highlightsRef.current, id));
    },
    [persistHighlights],
  );

  const handleUpdateHighlightNote = useCallback(
    (id: string, note: string) => {
      persistHighlights(updateHighlightNote(highlightsRef.current, id, note));
    },
    [persistHighlights],
  );

  const handleOpenHighlight = useCallback(
    (_item: HighlightItem, anchor: Anchor | null) => {
      if (anchor) {
        postToEngine({ type: 'goto', anchor });
      }
    },
    [postToEngine],
  );

  const handleExportHighlights = useCallback(() => {
    const currentBook = bookRef.current;
    if (!currentBook || highlightsRef.current.length === 0) return;
    void shareHighlightsMarkdown(currentBook, highlightsRef.current)
      .then(() => {
        showToast('تم تجهيز ملف الاقتباسات');
      })
      .catch((err) => {
        Alert.alert('تعذّر التصدير', readerErrorMessage(err));
      });
  }, []);

  const effectiveDir: 'rtl' | 'ltr' =
    settings.dirOverride && settings.dirOverride !== 'auto'
      ? settings.dirOverride
      : book?.meta.dir ?? 'rtl';

  const isBookmarked =
    isPositionBookmarked(bookmarkItems, currentAnchorRef.current, pageInfo.page);
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
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setVesselSize((prev) =>
              prev.width === width && prev.height === height ? prev : { width, height },
            );
          }
        }}
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
            // Why (tech): on iOS the reader needs this book's folder (for `assets/…` figures) and
            // the bundled fonts, both of which live under the books root. Read access stops there
            // — never the whole document directory, never the cache.
            allowingReadAccessToURL={readAccessUrl?.startsWith('file://') ? readAccessUrl : undefined}
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

        {/* Why (tech): an import journey must prove the figure actually painted. The engine posts
            the figure's measured box; this tiny invisible view exposes it to the accessibility
            tree (Maestro `assertVisible id: reader-image-proof`) without changing the reading
            surface. A figure that was mounted but decoded to nothing is reported as `count: 0` and
            gets its own node, so "nothing rendered" can be told apart from "nothing reported" —
            without it the negative control could pass for the wrong reason. */}
        {imageProof ? (
          // A real Text node: text views are what the on-device accessibility tree always exposes
          // (`reader-page-counter` proves that), whereas a 1px, 1%-opacity blank View was skipped
          // entirely (CI run 45672094646). Its colour is transparent, so a reader sees nothing;
          // the container takes no touches.
          <View pointerEvents="none" style={styles.imageProof}>
            {imageProof.count > 0 && imageProof.width > 0 && imageProof.height > 0 ? (
              <Text testID="reader-image-proof" style={styles.imageProofLabel}>
                {`صورة ${imageProof.width}×${imageProof.height}`}
              </Text>
            ) : (
              <Text testID="reader-image-error" style={styles.imageProofLabel}>
                {'الصورة مش ظاهرة'}
              </Text>
            )}
          </View>
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
              <Animated.View
                testID="reader-hud-hint"
                pointerEvents="none"
                style={[
                  styles.hudHint,
                  { backgroundColor: themeTokens.surface, borderColor: themeTokens.border },
                  hintAnimatedStyle,
                ]}
              >
                <Text style={[styles.hudHintText, { color: themeTokens.text, fontFamily: TYPOGRAPHY.uiFont }]}>
                  {HUD_HINT_TEXT}
                </Text>
              </Animated.View>
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
              onOpenToc={() => {
                setActiveSelection(null);
                setEditingHighlightState(null);
                setTocVisible(true);
              }}
              onOpenSettings={handleOpenSettings}
              onSelectTheme={(theme) => handleSettingsChange({ theme })}
              onSeekPage={handleSeekPage}
              onBarsLayout={setMeasuredHudHeights}
            />

            <HighlightToolbar
              visible={Boolean(activeSelection || editingHighlight)}
              rect={activeSelection?.rect ?? editingHighlightState?.rect ?? null}
              containerWidth={vesselSize.width}
              containerHeight={vesselSize.height}
              topInset={insets.top}
              bottomInset={effectiveRunningFootHeight}
              webviewOffsetTop={webviewMarginTop}
              activeColor={editingHighlight?.color}
              isEditing={Boolean(editingHighlight)}
              theme={settings.theme}
              onSelectColor={handleSelectHighlightColor}
              onPressNote={handlePressToolbarNote}
              onPressDictionary={handlePressToolbarDictionary}
              onPressDelete={editingHighlight ? handlePressToolbarDelete : undefined}
            />

            <HighlightNoteModal
              visible={noteModalTarget !== null}
              quote={
                noteModalTarget?.mode === 'create'
                  ? noteModalTarget.selection.quote
                  : (noteModalTarget?.highlight.quote ?? '')
              }
              initialNote={
                noteModalTarget?.mode === 'edit' ? (noteModalTarget.highlight.note ?? '') : ''
              }
              theme={settings.theme}
              dir={effectiveDir}
              onSave={handleSaveNoteModal}
              onCancel={() => setNoteModalTarget(null)}
            />

            <DictionarySheet
              visible={dictVisible}
              word={dictWord}
              result={dictResult}
              loading={dictLoading}
              theme={settings.theme}
              onClose={() => setDictVisible(false)}
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
              highlights={highlights}
              onOpenHighlight={handleOpenHighlight}
              onDeleteHighlight={handleDeleteHighlight}
              onUpdateHighlightNote={handleUpdateHighlightNote}
              onExportHighlights={handleExportHighlights}
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
  // A transparent, contentless strip along the bottom edge. The text inside is what proves a figure
  // painted; the container only takes it out of hit-testing so the scrubber underneath still works.
  imageProof: {
    position: 'absolute',
    start: 0,
    bottom: 0,
  },
  imageProofLabel: {
    color: 'transparent',
    fontSize: 8,
    lineHeight: 12,
  },
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
