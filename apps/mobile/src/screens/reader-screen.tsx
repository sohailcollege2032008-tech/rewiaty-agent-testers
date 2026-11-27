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
import { JumpBackPill } from '@/components/jump-back-pill';
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
  ReadingMode,
  ReaderInsets,
  ReaderSettings,
  RNToWebMessage,
  ScenePlaceholder,
  SelectionInfo,
  SelectionRect,
  TocEntry,
  WebToRNMessage,
} from '@/types/reader';
import { debounce } from '@/utils/debounce';
import {
  chapterIdFromAnchor,
  dismissJumpBack,
  emptyJumpBackState,
  isSameAnchorSpot,
  recordJump,
  recordReadingProgress,
  type JumpBackState,
  type JumpOrigin,
  type JumpTarget,
} from '@/utils/jump-back';
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
// Why (product, R5/A4 + P2 #60): edges no longer turn pages — teach the exact swipe
// direction in plain Arabic so first-time readers know which way advances vs goes back,
// matching `effectiveDir` (RTL advances right, LTR advances left).
export const HUD_HINT_TEXT =
  'اضغط في نص الصفحة للإعدادات والفهرس، واسحب لليمين للصفحة الجاية ولليسار للي فاتت.';
export const HUD_HINT_TEXT_LTR =
  'اضغط في نص الصفحة للإعدادات والفهرس، واسحب لليسار للصفحة الجاية ولليمين للي فاتت.';

export function getHudHintText(dir: 'rtl' | 'ltr'): string {
  return dir === 'ltr' ? HUD_HINT_TEXT_LTR : HUD_HINT_TEXT;
}

const LRI = '\u2066';
const PDI = '\u2069';

/**
 * Formats the running footer counter so Unicode BiDi (FriBidi / Android ICU) never flips
 * `~13` into `13~` or `58%` into `%58` inside an Arabic RTL paragraph.
 */
export function formatRunningFooterCounter(
  page: number,
  pageCount: number,
  estimated: boolean | undefined,
  pctRead: number,
): string {
  const totalPart = estimated ? `${LRI}~${pageCount}${PDI}` : `${pageCount}`;
  return `صفحة ${page} من ${totalPart} · ${LRI}${pctRead}%${PDI}`;
}

// `spread` comes from the engine's ReaderSettings ('auto' | 'single').
type EngineSettingsPayload = Partial<ReaderSettings>;

/**
 * F46 — the only wording a queued scene may show. Image generation is offline-first for now:
 * the placeholder waits in the queue instead of flashing a red provider error.
 */
export const SCENE_QUEUED_MESSAGE_AR = 'في قائمة الانتظار';

/** Applies one patch to one scene, keeping the array identity stable for untouched entries. */
export function applyScenePatch(
  scenes: readonly ScenePlaceholder[],
  sceneId: string,
  patch: Partial<ScenePlaceholder>,
): { scenes: ScenePlaceholder[]; updated: ScenePlaceholder } | null {
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  if (index === -1) return null;
  const updated: ScenePlaceholder = { ...scenes[index]!, ...patch };
  return { scenes: scenes.map((scene, i) => (i === index ? updated : scene)), updated };
}

function isReaderDocumentUrl(url: string, baseUrl: string): boolean {
  if (!url) return false;
  // Android loads an `html` source through a data URL and reports that back.
  if (url === 'about:blank' || url === 'about:srcdoc') return true;
  if (url.startsWith('data:text/html')) return true;
  return url === baseUrl;
}

/**
 * F26 (Codex #42 P2) — the place a book remembers, phrased as a jump origin the pill can return to.
 *
 * Opening a search hit lands the reader on the hit itself, not on the page they were reading; the
 * saved position is the real way back, so it becomes the origin of that jump. `null` when the book
 * remembers nothing, or when the saved position IS the hit (there would be nothing to go back to).
 */
function savedReaderOrigin(
  book: Book,
  state: BookReaderState,
  landingAnchor: Anchor,
): JumpOrigin | null {
  const savedAnchor = state.anchor ?? null;
  const savedPage = state.page ?? 1;
  const savedProgress = state.progress ?? 0;
  if (savedAnchor === null && savedPage <= 1 && savedProgress <= 0) return null;
  if (savedAnchor && isSameAnchorSpot(savedAnchor, landingAnchor)) return null;

  const chapterId =
    state.chapterId ??
    (savedAnchor ? chapterIdFromAnchor(savedAnchor) : null) ??
    book.chapters[0]?.id ??
    'ch01';
  const chapterTitle = book.chapters.find((chapter) => chapter.id === chapterId)?.title ?? chapterId;

  return {
    anchor: savedAnchor,
    chapterId,
    chapterTitle,
    page: savedPage,
    createdAt: Date.now(),
  };
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
  const initialChapterIdRef = useRef<string | undefined>(undefined);
  /**
   * Issue #44 — while the engine is restoring a saved position, a report that regressed to
   * the very start of the book (chapter 0 / page 1 / 0%) is a failed restore, not a read.
   * Persisting it would overwrite the reader's real position and library progress. The guard
   * is armed only when the book opened with a non-zero saved position and is dropped as soon
   * as the reader genuinely navigates (page turn, TOC, scrubber, bookmark/highlight/search).
   */
  const restoreGuardRef = useRef<{ savedProgress: number; savedChapterId?: string } | null>(null);
  const initialSettingsRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);
  const hasManualThemeRef = useRef(false);
  const fontBaseUrlRef = useRef<string | null>(null);
  const latestStateRef = useRef<BookReaderState | null>(null);
  // 'ready' can arrive again (WebView reload); the first-open hint is checked once per screen.
  const hintCheckedRef = useRef(false);
  const lastPageKeyRef = useRef<string | null>(null);
  /** The reader's own place (chapter + chapter page + text anchor) — not the shifting page number. */
  const lastReadingIdentityRef = useRef<string | null>(null);
  const currentAnchorRef = useRef<Anchor | null>(null);
  const bookmarkItemsRef = useRef<BookmarkItem[]>([]);
  const highlightsRef = useRef<HighlightItem[]>([]);
  const scenesRef = useRef<ScenePlaceholder[]>([]);
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
    /** F22: which layout the engine is drawing; drives the footer reading. */
    readingMode: ReadingMode;
    /** F22 scroll mode: 0..1 progress inside the current chapter. */
    chapterProgress: number;
    /** The engine is still measuring chapters, so `pageCount` is an estimate. */
    estimated: boolean;
  }>({
    chapterId: 'ch01',
    page: 1,
    pageCount: 1,
    bookProgress: 0,
    readingMode: 'paginated',
    chapterProgress: 0,
    estimated: true,
  });
  const [imageProof, setImageProof] = useState<{ count: number; width: number; height: number } | null>(
    null,
  );

  // F26 «صباعك بين الصفحات»: where the reader was before a jump, kept in a pure state machine so
  // the screen only has to feed it the moments that matter (a jump, a page turn).
  const [jumpBack, setJumpBack] = useState<JumpBackState>(emptyJumpBackState);
  const jumpBackRef = useRef<JumpBackState>(jumpBack);
  jumpBackRef.current = jumpBack;
  const pageInfoRef = useRef(pageInfo);
  pageInfoRef.current = pageInfo;
  const chapterTitleRef = useRef('');

  /** Runs a jump-back transition against the freshest state (handlers and WebView messages race). */
  const applyJumpBack = useCallback((transition: (state: JumpBackState) => JumpBackState) => {
    const next = transition(jumpBackRef.current);
    if (next === jumpBackRef.current) return;
    jumpBackRef.current = next;
    setJumpBack(next);
  }, []);

  const currentJumpOrigin = useCallback((): JumpOrigin => {
    const pos = pageInfoRef.current;
    return {
      anchor: currentAnchorRef.current,
      chapterId: pos.chapterId,
      chapterTitle: chapterTitleRef.current || pos.chapterId,
      page: pos.page,
      createdAt: Date.now(),
    };
  }, []);

  /** A deliberate jump away from the current spot: offer the way back. */
  const noteJumpAway = useCallback(
    (target: JumpTarget) => {
      applyJumpBack((prev) => recordJump(prev, currentJumpOrigin(), target));
    },
    [applyJumpBack, currentJumpOrigin],
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

  /**
   * Builds the state to persist from the LIVE refs at the moment the write happens.
   *
   * Why (Codex #64 P2): the debounced position/scene save used to capture a 500 ms-old state
   * object. A bookmark or highlight saved in between was then wiped by that stale snapshot.
   * Snapshotting on flush — and letting every immediate save go through the same builder —
   * means a delayed timer can only ever write the newest merged state, never a regression.
   */
  const buildReaderStateSnapshot = useCallback(
    (overrides: Partial<BookReaderState> = {}): BookReaderState | null => {
      const base = latestStateRef.current;
      if (!base) return null;
      // Scenes live in their own ref; drop the possibly older copy carried by `base` and
      // re-add the live one below (keeping the field absent when the book has no scenes).
      const { scenes: _savedScenes, ...rest } = base;
      void _savedScenes;
      const liveScenes = scenesRef.current;
      return {
        ...rest,
        bookmarkItems: bookmarkItemsRef.current,
        highlights: highlightsRef.current,
        ...(liveScenes.length > 0 ? { scenes: [...liveScenes] } : {}),
        ...overrides,
        updatedAt: Date.now(),
      };
    },
    [],
  );

  const debouncedSave = useMemo(
    () =>
      debounce((targetBookId: string) => {
        const state = buildReaderStateSnapshot();
        if (!state) return;
        void saveBookReaderState(targetBookId, state);
      }, POSITION_SAVE_DEBOUNCE_MS),
    [buildReaderStateSnapshot],
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
        initialChapterIdRef.current = activeSearchAnchor ? undefined : bundle.state.chapterId;
        // Arm the restore guard only for a book that did not open at the beginning. A search
        // deep link is an explicit target, so it never counts as a saved-position restore.
        const firstChapterId = bundle.book.chapters[0]?.id;
        const savedProgress = bundle.state.progress ?? 0;
        const savedChapterId = bundle.state.chapterId;
        const openedAwayFromStart =
          savedProgress > 0 ||
          (typeof savedChapterId === 'string' && savedChapterId !== firstChapterId);
        restoreGuardRef.current =
          !activeSearchAnchor && openedAwayFromStart
            ? { savedProgress, savedChapterId }
            : null;
        initialSettingsRef.current = resolvedSettings;
        fontBaseUrlRef.current = resolvedFontsUrl;
        latestStateRef.current = bundle.state;
        currentAnchorRef.current = bundle.state.anchor ?? null;

        // Why (Codex #42 P2): a book opened straight on a search hit still remembers where its
        // reader was. Without seeding the origin here, that landing has no way back at all — the
        // pill would only ever appear for jumps made after the screen was already open.
        if (activeSearchAnchor) {
          const savedOrigin = savedReaderOrigin(bundle.book, bundle.state, activeSearchAnchor);
          if (savedOrigin) {
            const seeded = recordJump(emptyJumpBackState(), savedOrigin, {
              chapterId: chapterIdFromAnchor(activeSearchAnchor) ?? savedOrigin.chapterId,
              anchor: activeSearchAnchor,
            });
            jumpBackRef.current = seeded;
            setJumpBack(seeded);
          }
        }

        const initialBookmarks = normalizeBookmarkItems(
          bundle.state.bookmarkItems,
          bundle.state.bookmarks,
          bundle.book,
        );
        bookmarkItemsRef.current = initialBookmarks;
        const initialHighlights = normalizeHighlightItems(bundle.state.highlights, bundle.book);
        highlightsRef.current = initialHighlights;
        // F46: scene placeholders are optional in every saved state written before them.
        scenesRef.current = bundle.state.scenes ?? [];
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
          readingMode: 'paginated',
          chapterProgress: 0,
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
    // Why (Codex #42 P2): a new search hit inside an already-open reader is a jump like any other.
    // Without recording the current spot first, opening a hit silently destroys the reader's place.
    noteJumpAway({
      chapterId: chapterIdFromAnchor(searchAnchor) ?? pageInfoRef.current.chapterId,
      anchor: searchAnchor,
    });
    // P1 #44: an explicit goto invalidates the cold-open restore guard.
    restoreGuardRef.current = null;
    postToEngine({ type: 'goto', anchor: searchAnchor });
  }, [bookId, engineReady, searchAnchor, noteJumpAway, postToEngine]);

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
    const scenes = scenesRef.current;
    postToEngine({
      type: 'load',
      book,
      anchor: initialAnchorRef.current,
      // An empty chapter's anchor is its own id (or a block that no longer exists), so the
      // engine needs the saved chapter id as a fallback to restore the position (#44).
      chapterId: initialChapterIdRef.current,
      settings: loadSettings,
      insets: initialInsets,
      highlights: resolveHighlightsForBook(book, highlightsRef.current),
      ...(scenes.length > 0 ? { scenePlaceholders: scenes } : {}),
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

  /**
   * F46 — every scene interaction (prompt edit, collapse, generate) follows the same path:
   * update the in-memory model, echo the placeholder back to the engine so the frame repaints,
   * and persist the whole state so the change survives closing the book.
   */
  const persistScenes = useCallback(
    (nextScenes: ScenePlaceholder[], updated: ScenePlaceholder) => {
      scenesRef.current = nextScenes;
      postToEngine({ type: 'scene-update', placeholder: updated });

      if (!bookId) return;
      const base = latestStateRef.current;
      if (!base) return;
      const nextState: BookReaderState = {
        ...base,
        scenes: nextScenes,
        updatedAt: Date.now(),
      };
      latestStateRef.current = nextState;
      debouncedSave(bookId);
    },
    [bookId, debouncedSave, postToEngine],
  );

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
          // F26: page turns in the new spot are what retire the jump-back pill on their own.
          // Background pagination keeps refining page counts, which moves the global page NUMBER
          // while the reader sits still (the chapter page and the text anchor do not move). Those
          // reports must not read as "the reader kept reading".
          const anchor: Anchor | null = parsed.anchor ?? null;
          const readingIdentity = `${parsed.chapterId}:${parsed.chapterPage ?? ''}:${anchor?.blockId ?? ''}:${anchor?.charOffset ?? ''}`;
          if (lastReadingIdentityRef.current !== readingIdentity) {
            lastReadingIdentityRef.current = readingIdentity;
            // The anchor travels with the report: the page key alone cannot tell that the reader
            // came back to the same text after a reflow moved its page number (Codex #42 P2).
            applyJumpBack((prev) => recordReadingProgress(prev, pageKey, Date.now(), anchor));
          }
          currentAnchorRef.current = anchor;
          setPageInfo({
            chapterId: parsed.chapterId,
            page: parsed.page,
            pageCount: parsed.pageCount,
            bookProgress:
              typeof parsed.bookProgress === 'number' && Number.isFinite(parsed.bookProgress)
                ? parsed.bookProgress
                : 0,
            // F22: the engine says which layout produced this position. A page built before
            // the field existed is paginated by definition.
            readingMode: parsed.readingMode === 'scroll' ? 'scroll' : 'paginated',
            chapterProgress:
              typeof parsed.chapterProgress === 'number' && Number.isFinite(parsed.chapterProgress)
                ? Math.max(0, Math.min(1, parsed.chapterProgress))
                : 0,
            estimated: parsed.estimated === true,
          });

          // Issue #44: a saved non-zero position must never be replaced by a failed restore.
          // A report of the very start of the book (chapter 0 / page 1 / 0%) is only written
          // after the reader genuinely navigates there; until then it cannot be distinguished
          // from the engine falling back to chapter 0 because the anchor did not resolve.
          let persistPosition = true;
          const restoreGuard = restoreGuardRef.current;
          if (restoreGuard) {
            const firstChapterId = bookRef.current?.chapters[0]?.id;
            const reportedProgress =
              typeof parsed.bookProgress === 'number' && Number.isFinite(parsed.bookProgress)
                ? parsed.bookProgress
                : 0;
            const reportedPage = typeof parsed.page === 'number' ? parsed.page : 0;
            const explicitUserNav = parsed.userNavigated === true;
            const regressedToStart =
              !explicitUserNav &&
              reportedProgress === 0 &&
              reportedPage <= 1 &&
              (firstChapterId === undefined || parsed.chapterId === firstChapterId);
            if (regressedToStart) {
              persistPosition = false;
            } else {
              // Any explicit navigation (including swiping back to page 1) or any non-start
              // position confirms the session is live: resume normal persistence.
              restoreGuardRef.current = null;
            }
          }

          if (bookId && persistPosition) {
            const nextState: BookReaderState = {
              anchor: parsed.anchor,
              progress: parsed.bookProgress,
              chapterId: parsed.chapterId,
              page: parsed.page,
              pageCount: parsed.pageCount,
              bookmarks: latestStateRef.current?.bookmarks,
              bookmarkItems: bookmarkItemsRef.current,
              highlights: highlightsRef.current,
              ...(scenesRef.current.length > 0 ? { scenes: scenesRef.current } : {}),
              updatedAt: Date.now(),
            };
            latestStateRef.current = nextState;
            debouncedSave(bookId);
          }

          // F23: feed the tracker from real page turns only (never from a timer).
          const tracker = readingTrackerRef.current;
          if (tracker && persistPosition) {
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
        case 'scene-prompt-edit': {
          const result = applyScenePatch(scenesRef.current, parsed.sceneId, {
            prompt: parsed.prompt,
          });
          if (result) persistScenes(result.scenes, result.updated);
          break;
        }
        case 'scene-toggle-collapse': {
          const result = applyScenePatch(scenesRef.current, parsed.sceneId, {
            collapsed: parsed.collapsed,
          });
          if (result) persistScenes(result.scenes, result.updated);
          break;
        }
        case 'scene-generate': {
          // Offline-first: the scene waits in the queue. No red error, no provider text.
          const result = applyScenePatch(scenesRef.current, parsed.sceneId, {
            status: 'queued',
            errorMessage: undefined,
          });
          if (result) {
            persistScenes(result.scenes, result.updated);
            showToast(SCENE_QUEUED_MESSAGE_AR);
          }
          break;
        }
        case 'error':
          setLoadError(readerErrorMessage(parsed.message));
          break;
      }
    },
    [bookId, debouncedSave, handleCloseSettings, persistScenes, applyJumpBack],
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
      const entry = tocEntries.find((chapter) => chapter.id === chapterId);
      // F26: a TOC jump is the classic «where was I?» moment — leave a way back.
      noteJumpAway({ chapterId, page: entry?.startPage ?? 0 });
      // P1 #44: an explicit goto invalidates the cold-open restore guard.
      restoreGuardRef.current = null;
      postToEngine({ type: 'goto', chapterId });
    },
    [noteJumpAway, postToEngine, tocEntries],
  );

  const handleSeekPage = useCallback(
    (targetPage: number) => {
      // F26: a timeline seek across the book also earns a way back to the page we were on.
      noteJumpAway({ chapterId: pageInfoRef.current.chapterId, page: targetPage });
      // P1 #44: an explicit goto invalidates the cold-open restore guard.
      restoreGuardRef.current = null;
      postToEngine({ type: 'goto', page: targetPage });
    },
    [noteJumpAway, postToEngine],
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
  chapterTitleRef.current = activeChapterTitle;

  const persistBookmarks = useCallback(
    (nextItems: BookmarkItem[]) => {
      bookmarkItemsRef.current = nextItems;
      setBookmarkItems(nextItems);

      if (!bookId) return;
      // Why: once bookmarks live in bookmarkItems the legacy page list is retired; keeping it
      // would resurrect deleted legacy bookmarks on the next load (Codex #19 P2).
      const updatedState = buildReaderStateSnapshot({
        bookmarks: [],
        bookmarkItems: nextItems,
      });
      if (!updatedState) return;
      latestStateRef.current = updatedState;
      void saveBookReaderState(bookId, updatedState);
    },
    [bookId, buildReaderStateSnapshot],
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
      // F26: opening a bookmark is a jump — remember the page the reader left.
      noteJumpAway({ chapterId: item.chapterId, page: item.page ?? 0, anchor });
      // P1 #44: an explicit goto invalidates the cold-open restore guard.
      restoreGuardRef.current = null;
      if (anchor) {
        postToEngine({ type: 'goto', anchor });
      } else if (item.page !== undefined) {
        postToEngine({ type: 'goto', page: item.page });
      }
    },
    [noteJumpAway, postToEngine],
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
      const updatedState = buildReaderStateSnapshot({ highlights: nextItems });
      if (!updatedState) return;
      latestStateRef.current = updatedState;
      void saveBookReaderState(bookId, updatedState);
    },
    [bookId, buildReaderStateSnapshot, postToEngine],
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
    (item: HighlightItem, anchor: Anchor | null) => {
      // F26: jumping to a highlight in another chapter leaves a way back too.
      noteJumpAway({ chapterId: item.chapterId, page: 0, anchor });
      // P1 #44: an explicit goto invalidates the cold-open restore guard.
      restoreGuardRef.current = null;
      if (anchor) {
        postToEngine({ type: 'goto', anchor });
      }
    },
    [noteJumpAway, postToEngine],
  );

  const handleJumpBackReturn = useCallback(
    (origin: JumpOrigin) => {
      applyJumpBack(dismissJumpBack);
      if (origin.anchor) {
        postToEngine({ type: 'goto', anchor: origin.anchor });
      } else {
        postToEngine({ type: 'goto', page: origin.page });
      }
    },
    [applyJumpBack, postToEngine],
  );

  const handleDismissJumpBack = useCallback(() => {
    applyJumpBack(dismissJumpBack);
  }, [applyJumpBack]);

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
              testID="reader-running-numbers"
              numberOfLines={1}
              style={[
                styles.runningFootNumbers,
                { color: themeTokens.muted, fontFamily: TYPOGRAPHY.uiFont },
              ]}
            >
              {formatRunningFooterCounter(pageInfo.page, pageInfo.pageCount, pageInfo.estimated, pctRead)}
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

        {/* F26 «صباعك بين الصفحات»: the way back to the page the reader jumped away from. It is
            hidden while a sheet owns the screen so it can never sit on top of one. */}
        {book ? (
          <JumpBackPill
            origin={tocVisible || settingsVisible ? null : jumpBack.origin}
            dir={effectiveDir}
            theme={settings.theme}
            // Above the open bars it would sit on the scrubber; above the quiet footer it sits at
            // its own ~48dp line. Either way it never covers a control.
            bottomOffset={hudVisible ? effectiveHudFooterHeight + 10 : undefined}
            onReturn={handleJumpBackReturn}
            onDismiss={handleDismissJumpBack}
          />
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
                  {getHudHintText(effectiveDir)}
                </Text>
              </Animated.View>
            ) : null}
            <ReaderHud
              visible={hudVisible}
              bookTitle={book.meta.title}
              chapterTitle={activeChapterTitle}
              page={pageInfo.page}
              pageCount={pageInfo.pageCount}
              readingMode={pageInfo.readingMode}
              chapterProgress={pageInfo.chapterProgress}
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
              onClose={() => {
                dictRequestRef.current += 1;
                setDictLoading(false);
                setDictVisible(false);
              }}
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
