import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { OnboardingSampleCard } from '@/components/onboarding-sample-card';
import { PreflightEstimateCard } from '@/components/preflight-estimate-card';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/theme/layout';
import { getAppThemeTokens, resolveSystemTheme } from '@/theme/reader-theme';
import type { AppThemeTokens } from '@/theme/types';
import type {
  AiLevel,
  BookArtDirectionInput,
  ConversionProgressEvent,
  CostEstimateResponse,
  OnboardingSampleResponse,
  PdfUploadService,
  PickedPdf,
  PipelineStage,
  QueueState,
  ReadyChapterSummary,
} from '@/types/upload-contract';

export type PdfUploadScreenProps = {
  /** Injectable seam — a real API client in the app, a mock in tests. */
  service?: PdfUploadService;
  onOpenReader?: (bookId: string) => void;
  onBack?: () => void;
  /**
   * Why (integration): PR #36 ships the UI before the live `RewiatyApiClient` wiring lands.
   * The route passes this calm notice while the cloud service is not connected, so the user
   * sees «الخدمة السحابية لسه مش مفعّلة» instead of a silent broken flow.
   */
  unconfiguredNoticeAr?: string | null;
};

type Phase = 'idle' | 'uploading' | 'preflight' | 'onboarding' | 'processing' | 'completed' | 'cancelled';

type Pending = 'pick' | 'estimate' | 'sample' | 'start' | null;

export const OFFLINE_SERVICE_BANNER_AR = 'الخدمة السحابية لسه مش مفعّلة';

export const OFFLINE_SERVICE_MESSAGE_AR =
  'التحويل السحابي هيتفعّل أول ما تتوصل الخدمة. لحد ساعتها تقدر تفتح كتبك من المكتبة.';

export const QUEUE_WAITING_MESSAGE_AR = 'في قائمة الانتظار';

export const CANCELLED_MESSAGE_AR = 'تم إلغاء التحويل';

/** Fixed, code-based Arabic copy — raw server/error text never reaches the screen. */
export const JOB_ERROR_MESSAGES_AR: Record<string, string> = {
  quota_exhausted: 'خلصت الحصة المتاحة للتحويل. جرّب تاني بعد شوية أو استخدم مفتاحك.',
  rate_limited: 'الخدمة مشغولة شوية دلوقتي. استنى دقيقة وجرّب تاني.',
  invalid_pdf: 'الملف ده مش PDF سليم. جرّب ملف تاني.',
  network_error: 'الاتصال قطع. اتأكد من النت وجرّب تاني.',
  unauthorized: 'مش مسموح نكمّل التحويل بالمفتاح الحالي. راجع إعدادات المفتاح وجرّب تاني.',
};

export const FALLBACK_JOB_ERROR_AR = 'تعذّر إكمال التحويل مؤقتاً. جرّب تاني.';

/** Map only the structured `error.code`; the message body is never rendered. */
export function mapJobErrorCode(code: string | undefined): string {
  if (!code) return FALLBACK_JOB_ERROR_AR;
  return JOB_ERROR_MESSAGES_AR[code] ?? FALLBACK_JOB_ERROR_AR;
}

export const STAGE_LABELS_AR: Record<PipelineStage, string> = {
  queued: 'في قائمة الانتظار',
  rendering: 'بنجهّز الصفحات',
  detecting: 'بنفحص جودة النص',
  segmenting: 'بنقسّم الصفحات والصور',
  ocr: 'بنقرا الصفحات المصوّرة',
  qa: 'بنراجع النص',
  tashkeel: 'بنضيف التشكيل',
  assembling: 'بنجمّع الفصول',
  bundling: 'بنجهّز الكتاب',
  completed: 'خلص التحويل',
};

const DEFAULT_QUEUE_MESSAGE_AR = QUEUE_WAITING_MESSAGE_AR;
const FIRST_CHAPTER_MESSAGE_AR = 'الفصل الأول جاهز، ابدأ اقرا';

const AMBER_TONES = {
  light: { surface: 'rgba(196, 146, 78, 0.14)', border: 'rgba(176, 128, 62, 0.38)', text: '#7A5A2E' },
  dark: { surface: 'rgba(214, 168, 98, 0.16)', border: 'rgba(214, 168, 98, 0.38)', text: '#E3C08A' },
} as const;

const READY_TONES = {
  light: {
    surface: 'rgba(122, 140, 92, 0.16)',
    border: 'rgba(104, 122, 74, 0.42)',
    text: '#4F5F37',
    cta: '#6F7F4A',
    ctaText: '#FFFDF6',
  },
  dark: {
    surface: 'rgba(168, 186, 128, 0.16)',
    border: 'rgba(168, 186, 128, 0.42)',
    text: '#D6E2BE',
    cta: '#8FA36A',
    ctaText: '#141A0E',
  },
} as const;

/** Nothing from the network is echoed: no keys, no English stack traces, no provider names. */
export const CALM_ERRORS_AR = {
  pick: 'تعذّر اختيار الملف. جرّب تاني.',
  upload: 'تعذّر رفع الملف. اتأكد من الاتصال وجرّب تاني.',
  estimate: 'تعذّر حساب التقدير. جرّب تاني بعد شوية.',
  sample: 'مقدرناش نجهّز العيّنة دلوقتي. تقدر تبدأ التحويل على طول.',
  save: 'تعذّر حفظ اختيارك. جرّب تاني.',
  start: 'تعذّر بدء التحويل. جرّب تاني.',
  openReader: 'تعذّر تجهيز الفصل على جهازك. جرّب تاني بعد لحظة.',
} as const;

/**
 * Offline default: the screen is shipped and testable before the backend is wired, and it
 * must never crash or show an English error when nobody injected a real service.
 */
export function createOfflinePdfUploadService(): PdfUploadService {
  const unavailable = async (): Promise<never> => {
    throw new Error('pdf-upload service is not connected');
  };
  return {
    pickPdf: async () => null,
    uploadAndEstimate: unavailable,
    generateOnboardingSample: unavailable,
    saveArtDirection: unavailable,
    startConversion: unavailable,
    subscribeProgress: () => () => {},
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function fileNameWithoutPdf(name: string): string {
  return name.replace(/\.pdf$/i, '');
}

export function PdfUploadScreen({
  service,
  onOpenReader,
  onBack,
  unconfiguredNoticeAr,
}: PdfUploadScreenProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const palette = getAppThemeTokens(resolveSystemTheme(colorScheme), colorScheme);
  const usingOfflineService = !service;
  const offlineNotice =
    unconfiguredNoticeAr === undefined
      ? usingOfflineService
        ? OFFLINE_SERVICE_BANNER_AR
        : null
      : unconfiguredNoticeAr;
  const effectiveService = useMemo(
    () => service ?? createOfflinePdfUploadService(),
    [service],
  );

  const [phase, setPhase] = useState<Phase>('idle');
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedPdf | null>(null);
  const [ids, setIds] = useState<{ upload_id: string; book_id: string } | null>(null);
  const [aiLevel, setAiLevel] = useState<AiLevel>('essential');
  /**
   * Why (atomic price): a re-estimate is a two-step read-modify-write. Until
   * the new estimate lands, the newly tapped level is only *pending*: the confirmed level and
   * the displayed price must always describe the same request.
   */
  const [pendingAiLevel, setPendingAiLevel] = useState<AiLevel | null>(null);
  const [estimate, setEstimate] = useState<CostEstimateResponse | null>(null);
  const [sample, setSample] = useState<OnboardingSampleResponse | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<PipelineStage>('queued');
  const [progress, setProgress] = useState<{ current_page: number; total_pages: number; percent: number }>({
    current_page: 0,
    total_pages: 0,
    percent: 0,
  });
  const [readyChapters, setReadyChapters] = useState<ReadyChapterSummary[]>([]);
  const [queueState, setQueueState] = useState<QueueState | null>(null);
  const [budgetNotice, setBudgetNotice] = useState<{ reason: string; spentUsd: number; capUsd: number } | null>(
    null,
  );
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [openingReader, setOpeningReader] = useState(false);

  const unsubscribeRef = useRef<null | (() => void)>(null);
  /**
   * Why (sync lock, not state): two taps in the same frame both read the previous `pending`
   * value because React has not re-rendered yet. A ref closes that gap synchronously.
   */
  const startingRef = useRef(false);
  /** Monotonic attempt token: any resolution from an older attempt is discarded silently. */
  const attemptIdRef = useRef(0);
  const openingReaderRef = useRef(false);
  const mountedRef = useRef(true);

  const unsubscribe = useCallback(() => {
    const stop = unsubscribeRef.current;
    unsubscribeRef.current = null;
    if (stop) {
      try {
        stop();
      } catch {
        // A stream that already closed is not an error worth surfacing.
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Why: a `startConversion` promise that resolves after unmount must not subscribe, so
      // bumping the attempt token makes every in-flight attempt stale.
      attemptIdRef.current += 1;
      startingRef.current = false;
      openingReaderRef.current = false;
      unsubscribe();
    };
  }, [unsubscribe]);

  const handleProgressEvent = useCallback(
    (event: ConversionProgressEvent) => {
      switch (event.type) {
        case 'job.stage':
          setStage(event.stage);
          return;
        case 'job.status':
          // Why: the queue pill describes *waiting*. The moment the worker owns the job it
          // must disappear, otherwise «في قائمة الانتظار» would sit next to live progress.
          if (event.status === 'queued') {
            setStage('queued');
            return;
          }
          if (event.status === 'running' || event.status === 'paused') {
            setQueueState(null);
            return;
          }
          if (event.status === 'completed') {
            setPhase('completed');
            setQueueState(null);
            setProgress((prev) => ({ ...prev, percent: 100 }));
            return;
          }
          if (event.status === 'cancelled') {
            unsubscribe();
            setQueueState(null);
            setFailureMessage(null);
            setProgress({ current_page: 0, total_pages: 0, percent: 0 });
            setPhase('cancelled');
          }
          return;
        case 'page.progress':
          setStage(event.stage);
          if (event.current_page > 0) setQueueState(null);
          setProgress({
            current_page: Math.max(0, event.current_page),
            total_pages: Math.max(0, event.total_pages),
            percent: clampPercent(event.percent),
          });
          return;
        case 'chapter.ready':
          setReadyChapters((prev) => {
            if (prev.some((chapter) => chapter.chapter_id === event.chapter_id)) return prev;
            const next: ReadyChapterSummary = {
              chapter_id: event.chapter_id,
              chapter_index: event.chapter_index,
              title: event.title,
              // Why: the banner copy is fixed and ours — `message_ar` from the stream is not
              // rendered, so a hostile/leaky string can never reach the UI.
              message_ar: FIRST_CHAPTER_MESSAGE_AR,
              word_count: event.word_count,
            };
            return [...prev, next].sort((a, b) => a.chapter_index - b.chapter_index);
          });
          return;
        case 'job.queued':
          setQueueState({
            position: Math.max(0, event.position),
            reason: event.reason,
            display_message_ar: DEFAULT_QUEUE_MESSAGE_AR,
            retry_after_sec: Math.max(0, event.retry_after_sec),
          });
          return;
        case 'budget.mode_changed':
          setBudgetNotice({
            reason: event.reason,
            spentUsd: Number.isFinite(event.spent_usd) ? event.spent_usd : 0,
            capUsd: Number.isFinite(event.cap_usd) ? event.cap_usd : 0,
          });
          return;
        case 'job.completed':
          setPhase('completed');
          setQueueState(null);
          setProgress((prev) => ({
            current_page: prev.total_pages || prev.current_page,
            total_pages: prev.total_pages,
            percent: 100,
          }));
          setStage('completed');
          return;
        case 'job.failed':
          setFailureMessage(mapJobErrorCode(event.error.code));
          setQueueState(null);
          return;
        default:
          return;
      }
    },
    [unsubscribe],
  );

  const resetToIdle = useCallback(() => {
    // Why: invalidate any in-flight start so its late resolution cannot resurrect a phase.
    attemptIdRef.current += 1;
    startingRef.current = false;
    openingReaderRef.current = false;
    unsubscribe();
    setPhase('idle');
    setPending(null);
    setNotice(null);
    setPicked(null);
    setIds(null);
    setAiLevel('essential');
    setPendingAiLevel(null);
    setEstimate(null);
    setSample(null);
    setSampleLoading(false);
    setJobId(null);
    setStage('queued');
    setProgress({ current_page: 0, total_pages: 0, percent: 0 });
    setReadyChapters([]);
    setQueueState(null);
    setBudgetNotice(null);
    setFailureMessage(null);
    setOpeningReader(false);
  }, [unsubscribe]);

  const handlePick = useCallback(async () => {
    if (pending) return;
    setPending('pick');
    setNotice(null);
    try {
      const selected = await effectiveService.pickPdf();
      if (!selected) {
        if (usingOfflineService) setNotice(OFFLINE_SERVICE_MESSAGE_AR);
        return;
      }
      setPicked(selected);
      setPhase('uploading');
      try {
        const result = await effectiveService.uploadAndEstimate(selected, { ai_level: aiLevel });
        setIds({ upload_id: result.upload_id, book_id: result.book_id });
        setEstimate(result.estimate);
        setPhase('preflight');
      } catch {
        setPhase('idle');
        setNotice(CALM_ERRORS_AR.upload);
      }
    } catch {
      setNotice(CALM_ERRORS_AR.pick);
    } finally {
      setPending(null);
    }
  }, [aiLevel, effectiveService, pending, usingOfflineService]);

  const handleSelectAiLevel = useCallback(
    async (level: AiLevel) => {
      if (pending || level === aiLevel) return;
      if (!picked || !estimate) {
        // Nothing to re-price against yet: committing the level alone is still consistent.
        setAiLevel(level);
        return;
      }
      // Why (atomic price, review P2): the tapped level must not become the *confirmed* level
      // until its estimate lands — otherwise a failed re-estimate leaves the card showing the
      // old price while «ابدأ التحويل» would send the new level.
      setPendingAiLevel(level);
      setPending('estimate');
      setNotice(null);
      try {
        const result = await effectiveService.uploadAndEstimate(picked, { ai_level: level });
        setIds({ upload_id: result.upload_id, book_id: result.book_id });
        setEstimate(result.estimate);
        setAiLevel(level);
      } catch {
        setNotice(CALM_ERRORS_AR.estimate);
      } finally {
        setPendingAiLevel(null);
        setPending(null);
      }
    },
    [aiLevel, effectiveService, estimate, pending, picked],
  );

  const startConversion = useCallback(
    async (bookId: string, uploadId: string) => {
      // Why (sync lock, review P2): two taps in one frame must never create two jobs.
      if (startingRef.current) return;
      startingRef.current = true;
      const attemptId = ++attemptIdRef.current;
      setPending('start');
      setNotice(null);
      setFailureMessage(null);
      try {
        const started = await effectiveService.startConversion({
          book_id: bookId,
          upload_id: uploadId,
          ai_level: aiLevel,
        });
        // Why (stale attempt, review P2): the screen may have unmounted or reset while the
        // request was in flight. Discard it entirely — no state, no subscription.
        if (attemptId !== attemptIdRef.current || !mountedRef.current) return;
        setJobId(started.job_id);
        setReadyChapters([]);
        // Why (202 queue_state, review P2): the wait is known from the HTTP response itself,
        // so the pill appears immediately instead of waiting for the first SSE event.
        setQueueState(
          started.queue_state
            ? { ...started.queue_state, display_message_ar: DEFAULT_QUEUE_MESSAGE_AR }
            : null,
        );
        setBudgetNotice(null);
        setStage('queued');
        setProgress({ current_page: 0, total_pages: estimate?.page_count ?? 0, percent: 0 });
        setPhase('processing');
        unsubscribe();
        const stop = effectiveService.subscribeProgress(started.job_id, handleProgressEvent);
        if (attemptId !== attemptIdRef.current) {
          // A subscription created by an attempt that went stale in the same tick must be
          // closed right away instead of leaking.
          try {
            stop();
          } catch {
            // already closed
          }
          return;
        }
        unsubscribeRef.current = stop;
      } catch {
        if (attemptId !== attemptIdRef.current) return;
        setNotice(CALM_ERRORS_AR.start);
      } finally {
        startingRef.current = false;
        if (attemptId === attemptIdRef.current) setPending(null);
      }
    },
    [aiLevel, effectiveService, estimate, handleProgressEvent, unsubscribe],
  );

  const handleConfirmPreflight = useCallback(() => {
    if (!ids) return;
    void startConversion(ids.book_id, ids.upload_id);
  }, [ids, startConversion]);

  const handlePreviewOnboarding = useCallback(async () => {
    if (pending || !ids) return;
    setPhase('onboarding');
    setPending('sample');
    setNotice(null);
    setSampleLoading(true);
    try {
      const generated = await effectiveService.generateOnboardingSample({ book_id: ids.book_id });
      setSample(generated);
    } catch {
      setSample(null);
      setPhase('preflight');
      setNotice(CALM_ERRORS_AR.sample);
    } finally {
      setSampleLoading(false);
      setPending(null);
    }
  }, [effectiveService, ids, pending]);

  const handleOnboardingConfirm = useCallback(
    async (payload: BookArtDirectionInput) => {
      if (pending || !ids) return;
      setPending('start');
      setNotice(null);
      try {
        // Why (OpenAPI v0, review P2): art direction is persisted on its own endpoint *before*
        // the job is created; `POST /v1/jobs` must not carry it.
        await effectiveService.saveArtDirection(ids.book_id, payload);
      } catch {
        setNotice(CALM_ERRORS_AR.save);
        setPending(null);
        return;
      }
      await startConversion(ids.book_id, ids.upload_id);
    },
    [effectiveService, ids, pending, startConversion],
  );

  const handleBack = useCallback(() => {
    if (pending) return;
    attemptIdRef.current += 1;
    startingRef.current = false;
    unsubscribe();
    if (onBack) {
      onBack();
      return;
    }
    resetToIdle();
  }, [onBack, pending, resetToIdle, unsubscribe]);

  const handleOpenReader = useCallback(async () => {
    const bookId = ids?.book_id;
    if (!bookId || !onOpenReader) return;
    if (openingReaderRef.current) return;
    const chapter = readyChapters[0];
    const ensureImported = effectiveService.ensureChapterImported;
    // Nothing to import (job finished or the service has no local check): navigate as before.
    if (!chapter || !ensureImported) {
      onOpenReader(bookId);
      return;
    }
    openingReaderRef.current = true;
    setOpeningReader(true);
    setNotice(null);
    try {
      // Why (review P1): never open a reader whose bundle is not on the device yet — the user
      // would land in an empty chapter with no way to tell whether it is broken.
      await ensureImported(bookId, chapter.chapter_id);
      if (!mountedRef.current) return;
      onOpenReader(bookId);
    } catch {
      if (!mountedRef.current) return;
      setNotice(CALM_ERRORS_AR.openReader);
    } finally {
      openingReaderRef.current = false;
      if (mountedRef.current) setOpeningReader(false);
    }
  }, [effectiveService, ids, onOpenReader, readyChapters]);

  const percent = Math.round(clampPercent(progress.percent));
  // Why (fixed copy, review P2): the banner text is ours, never the stream's raw `message_ar`.
  const readyBannerMessage = FIRST_CHAPTER_MESSAGE_AR;
  const amber = palette.isDark ? AMBER_TONES.dark : AMBER_TONES.light;
  const ready = palette.isDark ? READY_TONES.dark : READY_TONES.light;

  return (
    <View style={[styles.root, { backgroundColor: palette.deskBg }]}>
      <StatusBar style={palette.isDark ? 'light' : 'dark'} />

      <View
        testID="pdf-upload-header"
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 10) + 6,
            borderBottomColor: palette.border,
            backgroundColor: palette.deskBg,
          },
        ]}
      >
        <Pressable
          testID="pdf-upload-back-btn"
          onPress={handleBack}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
        >
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M9 6l6 6-6 6"
              stroke={palette.text}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Pressable>
        <Text
          style={[styles.headerTitle, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
        >
          تحويل PDF لكتاب
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 18) + 18 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {offlineNotice ? (
          <View
            testID="pdf-upload-offline-banner"
            accessibilityLiveRegion="polite"
            style={[styles.calmNotice, { backgroundColor: amber.surface, borderColor: amber.border }]}
          >
            <Text
              style={[styles.calmNoticeText, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              {offlineNotice}
            </Text>
          </View>
        ) : null}

        {notice ? (
          <View
            testID="pdf-upload-notice"
            style={[styles.calmNotice, { backgroundColor: amber.surface, borderColor: amber.border }]}
          >
            <Text
              style={[styles.calmNoticeText, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              {notice}
            </Text>
          </View>
        ) : null}

        {phase === 'idle' ? (
          <View
            testID="pdf-upload-idle-card"
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <View style={[styles.uploadGlyph, { backgroundColor: palette.accentSoft }]}>
              <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V15"
                  stroke={palette.accent}
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
            <Text
              style={[styles.idleTitle, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
            >
              حوّل أي PDF لكتاب روايتي
            </Text>
            <Text style={[styles.idleBody, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              ارفع الملف، وإحنا بنقرا الصفحات ونجهّزلك كتاب تقراه بثيمات روايتي. الملف الأصلي
              بيتشال من السيرفر بعد 24 ساعة، والنسخة اللي بتفضل هي الكتاب بس.
            </Text>
            <Pressable
              testID="pick-pdf-btn"
              onPress={() => void handlePick()}
              disabled={pending !== null}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: palette.ctaBg, opacity: pending ? 0.55 : 1 },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="اختر ملف PDF"
            >
              <Text
                style={[styles.primaryBtnText, { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                اختر ملف PDF
              </Text>
            </Pressable>
          </View>
        ) : null}

        {phase === 'uploading' ? (
          <View
            testID="pdf-upload-uploading"
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            {picked ? (
              <Text
                style={[styles.uploadFileName, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                numberOfLines={1}
              >
                {fileNameWithoutPdf(picked.name)}
              </Text>
            ) : null}
            <ActivityIndicator color={palette.accent} />
            <Text
              style={[styles.uploadingText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
            >
              جاري رفع الملف وفحص الصفحات…
            </Text>
          </View>
        ) : null}

        {phase === 'preflight' && estimate ? (
          <PreflightEstimateCard
            estimate={estimate}
            aiLevel={pendingAiLevel ?? aiLevel}
            onSelectAiLevel={(level) => void handleSelectAiLevel(level)}
            onConfirm={handleConfirmPreflight}
            onCancel={resetToIdle}
            onPreviewOnboarding={() => void handlePreviewOnboarding()}
            busy={pending !== null}
            theme={palette.id}
          />
        ) : null}

        {phase === 'onboarding' ? (
          sample ? (
            <OnboardingSampleCard
              sample={sample}
              onConfirm={(payload) => void handleOnboardingConfirm(payload)}
              onBack={() => {
                if (pending) return;
                setPhase('preflight');
              }}
              busy={pending !== null}
              theme={palette.id}
            />
          ) : (
            <View
              testID="pdf-upload-sample-loading"
              style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <ActivityIndicator color={palette.accent} />
              <Text
                style={[styles.uploadingText, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                {sampleLoading ? 'بنجهّز عيّنة الثيمات وأسلوب الرسم…' : 'مفيش عيّنة جاهزة.'}
              </Text>
            </View>
          )
        ) : null}

        {phase === 'processing' || phase === 'completed' ? (
          <View style={styles.tracking}>
            <View
              testID="conversion-tracking-card"
              style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
            >
              <Text
                style={[styles.trackingTitle, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
              >
                {phase === 'completed' ? 'الكتاب خلص' : 'بنجهّز الكتاب'}
              </Text>
              <Text
                testID="conversion-stage-label"
                style={[styles.stageLabel, { color: palette.accent, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                {STAGE_LABELS_AR[stage]}
              </Text>

              <View
                testID="conversion-progress-bar"
                accessibilityRole="progressbar"
                accessibilityLabel="نسبة التحويل"
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                style={[styles.progressTrack, { backgroundColor: palette.scrubberTrack }]}
              >
                <View
                  testID="conversion-progress-fill"
                  style={[styles.progressFill, { width: `${percent}%`, backgroundColor: palette.accent }]}
                />
              </View>

              <View style={styles.progressMetaRow}>
                <Text
                  testID="conversion-percent"
                  style={[styles.progressMeta, { color: palette.text, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {`${percent}%`}
                </Text>
                <Text
                  testID="conversion-pages"
                  style={[styles.progressMeta, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {`${progress.current_page} / ${progress.total_pages}`}
                </Text>
              </View>

              {queueState ? (
                <View
                  testID="conversion-queue-pill"
                  accessibilityLiveRegion="polite"
                  style={[styles.queuePill, { backgroundColor: amber.surface, borderColor: amber.border }]}
                >
                  <Text
                    style={[styles.queuePillText, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
                  >
                    {QUEUE_WAITING_MESSAGE_AR}
                  </Text>
                  <Text
                    testID="conversion-queue-position"
                    style={[styles.queuePillMeta, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
                  >
                    {`مكانك في الطابور: ${queueState.position}`}
                  </Text>
                </View>
              ) : null}

              {budgetNotice ? (
                <View
                  testID="conversion-budget-notice"
                  style={[styles.queuePill, { backgroundColor: amber.surface, borderColor: amber.border }]}
                >
                  <Text
                    style={[styles.queuePillText, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
                  >
                    وقفنا توليد الصور التلقائي عند حد الميزانية، وحوّلنا لـ «عند الطلب».
                  </Text>
                  <Text
                    style={[styles.queuePillMeta, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
                  >
                    {`المصروف $${budgetNotice.spentUsd.toFixed(2)} من حد $${budgetNotice.capUsd.toFixed(2)}`}
                  </Text>
                </View>
              ) : null}

              {failureMessage ? (
                <View
                  testID="conversion-failure-card"
                  style={[styles.queuePill, { backgroundColor: amber.surface, borderColor: amber.border }]}
                >
                  <Text
                    style={[styles.queuePillText, { color: amber.text, fontFamily: TYPOGRAPHY.uiFont }]}
                  >
                    {failureMessage}
                  </Text>
                </View>
              ) : null}
            </View>

            {readyChapters.length > 0 || phase === 'completed' ? (
              <View
                testID="first-chapter-banner"
                style={[styles.readyBanner, { backgroundColor: ready.surface, borderColor: ready.border }]}
              >
                <Text
                  style={[styles.readyBannerText, { color: ready.text, fontFamily: TYPOGRAPHY.uiFont }]}
                >
                  {readyBannerMessage}
                </Text>
                <Pressable
                  testID="read-first-chapter-btn"
                  onPress={() => void handleOpenReader()}
                  disabled={openingReader}
                  style={({ pressed }) => [
                    styles.readyBtn,
                    { backgroundColor: ready.cta, opacity: openingReader ? 0.6 : 1 },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={readyBannerMessage}
                >
                  <Text
                    style={[
                      styles.readyBtnText,
                      { color: ready.ctaText, fontFamily: TYPOGRAPHY.uiFont },
                    ]}
                  >
                    {openingReader ? 'بنجهّز الفصل…' : 'ابدأ اقرا'}
                  </Text>
                </Pressable>
                {readyChapters.length > 1 ? (
                  <Text
                    testID="ready-chapters-count"
                    style={[styles.readyCount, { color: ready.text, fontFamily: TYPOGRAPHY.uiFont }]}
                  >
                    {`${readyChapters.length} فصول جاهزة للقراية`}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {phase === 'completed' ? (
              <Pressable
                testID="conversion-done-btn"
                onPress={() => void handleOpenReader()}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: palette.ctaBg },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="افتح الكتاب في المكتبة"
              >
                <Text
                  style={[
                    styles.primaryBtnText,
                    { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont },
                  ]}
                >
                  افتح الكتاب في المكتبة
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {phase === 'cancelled' ? (
          <View
            testID="conversion-cancelled-card"
            accessibilityLiveRegion="polite"
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <Text
              style={[styles.trackingTitle, { color: palette.text, fontFamily: TYPOGRAPHY.displayFont }]}
            >
              {CANCELLED_MESSAGE_AR}
            </Text>
            <Text style={[styles.idleBody, { color: palette.muted, fontFamily: TYPOGRAPHY.uiFont }]}>
              التحويل وقف قبل ما يخلص. تقدر تبدأ من الأول في أي وقت.
            </Text>
            <Pressable
              testID="conversion-restart-btn"
              onPress={resetToIdle}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: palette.ctaBg },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="ابدأ من جديد"
            >
              <Text
                style={[styles.primaryBtnText, { color: palette.ctaText, fontFamily: TYPOGRAPHY.uiFont }]}
              >
                ابدأ من جديد
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    // Why (RTL web, review P3): without an explicit direction the browser header row can
    // mirror inconsistently between native and web; pin it so the back button sits at the
    // reading-start edge in Arabic on both.
    direction: 'rtl',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  headerSpacer: {
    width: 12,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.md + 2,
    paddingTop: SPACING.md,
    gap: SPACING.sm + 2,
  },
  card: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm + 2,
    alignItems: 'stretch',
  },
  calmNotice: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  calmNoticeText: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
  },
  uploadGlyph: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  idleTitle: {
    fontSize: 20,
    lineHeight: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  idleBody: {
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'right',
  },
  primaryBtn: {
    minHeight: 48,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  uploadFileName: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  uploadingText: {
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
  },
  tracking: {
    gap: SPACING.sm + 2,
  },
  trackingTitle: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'right',
  },
  stageLabel: {
    fontSize: 13.5,
    fontWeight: '600',
    textAlign: 'right',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressMeta: {
    fontSize: 12,
    fontWeight: '600',
  },
  queuePill: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  queuePillText: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'right',
  },
  queuePillMeta: {
    fontSize: 11.5,
    textAlign: 'right',
  },
  readyBanner: {
    borderRadius: RADIUS.card,
    borderWidth: 1,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  readyBannerText: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  readyBtn: {
    minHeight: 44,
    borderRadius: RADIUS.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  readyBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  readyCount: {
    fontSize: 11.5,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
});
