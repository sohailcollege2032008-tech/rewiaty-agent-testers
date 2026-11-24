import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Anchor, Book } from '@rewiaty/book-format';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import { ReaderHud } from '@/components/reader-hud';
import { ReaderSettingsSheet } from '@/components/reader-settings-sheet';
import { TocModal } from '@/components/toc-modal';
import { readAssetText, readBookBundle, saveBookReaderState } from '@/storage/bundle';
import { touchBookOpened } from '@/storage/database';
import { ensureOfflineFontsDir } from '@/storage/font-assets';
import {
  DEFAULT_SETTINGS,
  loadReaderSettings,
  mergeReaderSettings,
  resetReaderSettings,
  saveReaderSettings,
} from '@/storage/settings-store';
import { getAppThemeTokens } from '@/theme/reader-theme';
import type {
  BookReaderState,
  ReaderSettings,
  RNToWebMessage,
  TocEntry,
  WebToRNMessage,
} from '@/types/reader';
import { debounce } from '@/utils/debounce';

const POSITION_SAVE_DEBOUNCE_MS = 500;

export function ReaderScreen() {
  useKeepAwake();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookId = Array.isArray(id) ? id[0] : id;

  const webViewRef = useRef<WebView<Record<string, unknown>> | null>(null);
  const hasSentLoadRef = useRef(false);
  const initialAnchorRef = useRef<Anchor | undefined>(undefined);
  const initialSettingsRef = useRef<ReaderSettings>(DEFAULT_SETTINGS);
  const fontBaseUrlRef = useRef<string | null>(null);

  const [readerHtml, setReaderHtml] = useState<string | null>(null);
  const [fontBaseUrl, setFontBaseUrl] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webLoaded, setWebLoaded] = useState(false);
  const [engineReady, setEngineReady] = useState(false);

  const [hudVisible, setHudVisible] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const settingsVisibleRef = useRef(false);
  settingsVisibleRef.current = settingsVisible;
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [pageInfo, setPageInfo] = useState<{
    chapterId: string;
    page: number;
    pageCount: number;
  }>({
    chapterId: 'ch01',
    page: 1,
    pageCount: 1,
  });

  const themeTokens = useMemo(() => getAppThemeTokens(settings.theme), [settings.theme]);

  const debouncedSave = useMemo(
    () =>
      debounce((targetBookId: string, state: BookReaderState) => {
        void saveBookReaderState(targetBookId, state);
      }, POSITION_SAVE_DEBOUNCE_MS),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        debouncedSave.flush();
      }
    });
    return () => {
      subscription.remove();
      debouncedSave.flush();
    };
  }, [debouncedSave]);

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
        const [html, bundle, loadedSettings, resolvedFontsUrl] = await Promise.all([
          readAssetText(readerAsset),
          readBookBundle(bookId),
          loadReaderSettings().catch(() => ({ ...DEFAULT_SETTINGS })),
          ensureOfflineFontsDir().catch(() => null),
        ]);
        if (cancelled) return;

        await touchBookOpened(bookId, Date.now());
        if (cancelled) return;

        initialAnchorRef.current = bundle.state.anchor ?? undefined;
        initialSettingsRef.current = loadedSettings;
        fontBaseUrlRef.current = resolvedFontsUrl;
        setSettings(loadedSettings);
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
    postToEngine({
      type: 'load',
      book,
      anchor: initialAnchorRef.current,
      settings: initialSettingsRef.current,
      ...(fontBaseUrlRef.current ? { fontBaseUrl: fontBaseUrlRef.current } : {}),
    });
  }, [webLoaded, book, postToEngine]);

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
          break;
        case 'toc':
          setTocEntries(parsed.chapters);
          break;
        case 'tap':
          if (parsed.zone === 'center') {
            if (settingsVisibleRef.current) {
              setSettingsVisible(false);
            } else {
              setHudVisible((prev) => !prev);
            }
          }
          break;
        case 'position':
          setPageInfo({
            chapterId: parsed.chapterId,
            page: parsed.page,
            pageCount: parsed.pageCount,
          });
          if (bookId) {
            debouncedSave(bookId, {
              anchor: parsed.anchor,
              progress: parsed.bookProgress,
              chapterId: parsed.chapterId,
              page: parsed.page,
              pageCount: parsed.pageCount,
              updatedAt: Date.now(),
            });
          }
          break;
        case 'error':
          setLoadError(parsed.message);
          break;
      }
    },
    [bookId, debouncedSave],
  );

  const handleBack = useCallback(() => {
    debouncedSave.flush();
    router.back();
  }, [debouncedSave, router]);

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

  const handleOpenSettings = useCallback(() => {
    setHudVisible(false);
    setSettingsVisible(true);
  }, []);

  const handleSettingsChange = useCallback(
    (partial: Partial<ReaderSettings>) => {
      postToEngine({ type: 'settings', partial });
      setSettings((prev) => {
        const next = mergeReaderSettings(prev, partial);
        initialSettingsRef.current = next;
        void saveReaderSettings(next);
        return next;
      });
    },
    [postToEngine],
  );

  const handleResetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_SETTINGS };
    postToEngine({ type: 'settings', partial: defaults });
    initialSettingsRef.current = defaults;
    setSettings(defaults);
    void resetReaderSettings();
  }, [postToEngine]);

  const activeChapterTitle = useMemo(() => {
    const fromToc = tocEntries.find((c) => c.id === pageInfo.chapterId)?.title;
    if (fromToc) return fromToc;
    return book?.chapters.find((c) => c.id === pageInfo.chapterId)?.title ?? book?.meta.title ?? '';
  }, [tocEntries, book, pageInfo.chapterId]);

  if (loadError) {
    return (
      <View
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
        <Text style={[styles.errorText, { color: themeTokens.danger }]} selectable>
          {loadError}
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: themeTokens.accent }]}
        >
          <Text style={[styles.backBtnText, { color: themeTokens.onAccent }]}>
            العودة إلى المكتبة
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeTokens.bg }]}>
      <StatusBar style={themeTokens.isDark ? 'light' : 'dark'} />
      {readerHtml && book ? (
        <WebView<Record<string, unknown>>
          ref={webViewRef}
          testID="reader-webview"
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowingReadAccessToURL={fontBaseUrl ?? undefined}
          source={{
            html: readerHtml,
            baseUrl: fontBaseUrl ?? 'https://rewiaty.local/',
          }}
          style={[
            styles.webview,
            {
              backgroundColor: themeTokens.bg,
              marginTop: insets.top,
              marginBottom: insets.bottom,
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

      {!engineReady ? (
        <View
          style={[styles.loadingOverlay, { backgroundColor: themeTokens.bg }]}
          pointerEvents="none"
        >
          <ActivityIndicator size="large" color={themeTokens.accent} />
        </View>
      ) : null}

      {book ? (
        <>
          <ReaderHud
            visible={hudVisible}
            bookTitle={book.meta.title}
            chapterTitle={activeChapterTitle}
            page={pageInfo.page}
            pageCount={pageInfo.pageCount}
            dir={settings.dirOverride && settings.dirOverride !== 'auto' ? settings.dirOverride : book.meta.dir}
            theme={settings.theme}
            onBack={handleBack}
            onOpenToc={() => setTocVisible(true)}
            onOpenSettings={handleOpenSettings}
            onSeekPage={handleSeekPage}
          />

          <TocModal
            visible={tocVisible}
            chapters={tocEntries}
            activeChapterId={pageInfo.chapterId}
            dir={settings.dirOverride && settings.dirOverride !== 'auto' ? settings.dirOverride : book.meta.dir}
            theme={settings.theme}
            onSelectChapter={handleSelectChapter}
            onClose={() => setTocVisible(false)}
          />

          <ReaderSettingsSheet
            visible={settingsVisible}
            settings={settings}
            onChange={handleSettingsChange}
            onReset={handleResetSettings}
            onClose={() => setSettingsVisible(false)}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF8F5',
  },
  webview: {
    flex: 1,
    backgroundColor: '#FAF8F5',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAF8F5',
  },
  centerState: {
    flex: 1,
    backgroundColor: '#FAF8F5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#991B1B',
    textAlign: 'center',
  },
  backBtn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#8B5A2B',
    justifyContent: 'center',
  },
  backBtnText: {
    color: '#FFFDF9',
    fontWeight: '700',
    fontSize: 14,
  },
});
