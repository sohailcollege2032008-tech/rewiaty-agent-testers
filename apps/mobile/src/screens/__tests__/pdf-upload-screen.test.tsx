import * as ReactNative from 'react-native';
import { Alert, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  CALM_ERRORS_AR,
  FALLBACK_JOB_ERROR_AR,
  LIVE_PROGRESS_DISCONNECTED_AR,
  OFFLINE_SERVICE_BANNER_AR,
  OFFLINE_SERVICE_MESSAGE_AR,
  PdfUploadScreen,
  QUEUE_WAITING_MESSAGE_AR,
  STAGE_LABELS_AR,
} from '@/screens/pdf-upload-screen';
import type {
  BookArtDirection,
  BookArtDirectionInput,
  ConversionProgressEvent,
  CostEstimateResponse,
  OnboardingSampleResponse,
  PdfUploadService,
  PickedPdf,
} from '@/types/upload-contract';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const PDF: PickedPdf = { uri: 'file:///tmp/amwaj.pdf', name: 'amwaj.pdf', sizeBytes: 5_400_000 };

const ESTIMATE: CostEstimateResponse = {
  upload_id: 'up_1',
  book_id: 'book_9',
  page_count: 320,
  is_digital_text_clean: false,
  text_layer_quality: 'mixed',
  routing_mode: 'hybrid',
  estimated_ocr_pages: 212,
  estimated_image_count: 12,
  estimated_cost_usd: { text_usd: 0.27, image_usd: 0.18, total_usd: 0.45 },
  estimated_duration_sec: 420,
  warnings: ['فيه 212 صفحة محتاجة مسح ضوئي، فالتحويل هياخد وقت أطول شوية.'],
};

const SAMPLE: OnboardingSampleResponse = {
  book_id: 'book_9',
  sample_cost_usd: 0.02,
  themes: [
    {
      theme_id: 'th_warm',
      name_ar: 'ورق دافئ',
      name_en: 'Warm paper',
      background: '#F3EDE2',
      surface: '#FFFDF8',
      text: '#231F1A',
      accent: '#9E3E2F',
      rationale_ar: 'جو دافئ زي ورق قديم.',
    },
    {
      theme_id: 'th_night',
      name_ar: 'ليل هادي',
      name_en: 'Quiet night',
      background: '#1C1B19',
      surface: '#26241F',
      text: '#EDE6D8',
      accent: '#C9A227',
      rationale_ar: 'خلفية غامقة بتريّح العين بالليل.',
    },
    {
      theme_id: 'th_olive',
      name_ar: 'زيتوني',
      name_en: 'Olive',
      background: '#E7E7DC',
      surface: '#F6F6EC',
      text: '#242A1F',
      accent: '#5C6B44',
      rationale_ar: 'أخضر ترابي هادي.',
    },
  ],
  styles: [
    {
      style_id: 'st_ink',
      name_ar: 'حبر مائي',
      name_en: 'Ink wash',
      prompt_prefix: 'ink wash illustration, warm sepia',
      palette: ['#8C6A4A', '#C9A98A', '#4A3B2C'],
      mood_tags: ['هادئ'],
    },
    {
      style_id: 'st_line',
      name_ar: 'خطوط رقيقة',
      name_en: 'Fine line',
      prompt_prefix: 'fine line drawing, muted palette',
      palette: ['#2F5356', '#D9C5A3'],
      mood_tags: ['دقيق'],
    },
    {
      style_id: 'st_woodcut',
      name_ar: 'حفر خشب',
      name_en: 'Woodcut',
      prompt_prefix: 'woodcut print, high contrast',
      palette: ['#1F1B16', '#7B2D21'],
      mood_tags: ['درامي'],
    },
  ],
};

const READY_CHAPTER_EVENT: ConversionProgressEvent = {
  type: 'chapter.ready',
  chapter_id: 'ch01',
  chapter_index: 1,
  title: 'الفصل الأول',
  message_ar: 'HOSTILE_CHAPTER_TEXT_XYZ sk-live-DEADBEEF',
  chapter_url: '/v1/books/book_9/bundle/chapters/ch01',
  manifest_url: '/v1/books/book_9/bundle/manifest',
  word_count: 2_400,
};

type Harness = {
  service: PdfUploadService;
  push: (event: ConversionProgressEvent) => void;
  pushError: (error: Error) => void;
  unsubscribe: jest.Mock;
  savedDirections: BookArtDirectionInput[];
};

function buildService(overrides: Partial<PdfUploadService> = {}): Harness {
  const listeners: Array<(event: ConversionProgressEvent) => void> = [];
  const errorListeners: Array<(error: Error) => void> = [];
  const unsubscribe = jest.fn();
  const savedDirections: BookArtDirectionInput[] = [];

  const service: PdfUploadService = {
    pickPdf: jest.fn(async () => PDF),
    uploadAndEstimate: jest.fn(async () => ({ upload_id: 'up_1', book_id: 'book_9', estimate: ESTIMATE })),
    generateOnboardingSample: jest.fn(async () => SAMPLE),
    saveArtDirection: jest.fn(async (bookId: string, input: BookArtDirectionInput) => {
      savedDirections.push(input);
      const direction: BookArtDirection = {
        book_id: bookId,
        selected_theme_id: input.selected_theme_id,
        selected_style_id: input.selected_style_id,
        custom_prompt_prefix: input.custom_prompt_prefix,
        updated_at: '2026-11-27T00:00:00Z',
      };
      return direction;
    }),
    startConversion: jest.fn(async () => ({ job_id: 'job_1', book_id: 'book_9' })),
    subscribeProgress: jest.fn(
      (
        _jobId: string,
        onEvent: (event: ConversionProgressEvent) => void,
        onError?: (error: Error) => void,
      ) => {
        listeners.push(onEvent);
        if (onError) errorListeners.push(onError);
        return unsubscribe;
      },
    ),
    ...overrides,
  };

  return {
    service,
    unsubscribe,
    savedDirections,
    push: (event) => {
      const handler = listeners[listeners.length - 1];
      if (handler) handler(event);
    },
    pushError: (error) => {
      const handler = errorListeners[errorListeners.length - 1];
      if (handler) handler(error);
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

/** Pick a PDF and wait for the preflight card — the shared starting point of most journeys. */
async function renderAtPreflight(harness: Harness, onOpenReader?: jest.Mock) {
  const screen = await render(
    <PdfUploadScreen service={harness.service} onOpenReader={onOpenReader} />,
  );
  await fireEvent.press(screen.getByTestId('pick-pdf-btn'));
  await waitFor(() => expect(screen.getByTestId('preflight-estimate-card')).toBeTruthy());
  return screen;
}

async function startAndTrackJob(harness: Harness, screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(screen.getByTestId('preflight-confirm-btn'));
  await waitFor(() => expect(screen.getByTestId('conversion-tracking-card')).toBeTruthy());
}

describe('PdfUploadScreen (PR 4B)', () => {
  let colorSchemeSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    colorSchemeSpy = jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('light');
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    colorSchemeSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('explains the PDF conversion and its privacy promise before anything is uploaded', async () => {
    const { service } = buildService();
    const screen = await render(<PdfUploadScreen service={service} />);

    expect(screen.getByText('تحويل PDF لكتاب')).toBeTruthy();
    expect(screen.getByText('حوّل أي PDF لكتاب روايتي')).toBeTruthy();
    expect(screen.getByText(/بيتشال من السيرفر بعد 24 ساعة/)).toBeTruthy();
    expect(screen.getByTestId('pick-pdf-btn')).toHaveTextContent('اختر ملف PDF');
    expect(screen.queryByTestId('preflight-estimate-card')).toBeNull();
  });

  it('picks a PDF, uploads it, and shows the calm «320 صفحة، حوالي $0.45، ابدأ؟» preflight', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);

    expect(harness.service.pickPdf).toHaveBeenCalledTimes(1);
    expect(harness.service.uploadAndEstimate).toHaveBeenCalledWith(PDF, { ai_level: 'essential' });

    expect(screen.getByText('320 صفحة، حوالي $0.45، ابدأ؟')).toBeTruthy();
    expect(screen.getByTestId('preflight-routing-badge')).toHaveTextContent('هجين (نص + OCR)');
    expect(screen.getByTestId('preflight-text-cost')).toHaveTextContent('$0.27');
    expect(screen.getByTestId('preflight-image-cost')).toHaveTextContent('$0.18');
    expect(screen.getByTestId('preflight-image-count')).toHaveTextContent('12 صورة');
    expect(screen.getByTestId('preflight-duration')).toHaveTextContent('7 دقائق');
    expect(screen.getByTestId('preflight-warnings')).toHaveTextContent(/212 صفحة محتاجة مسح ضوئي/);
    expect(screen.getByTestId('preflight-confirm-btn')).toHaveTextContent('ابدأ التحويل');
    expect(screen.getByTestId('preflight-cancel-btn')).toHaveTextContent('تراجع');
  });

  it('re-estimates when the AI level changes', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);

    await fireEvent.press(screen.getByTestId('preflight-ai-level-directors_cut'));

    await waitFor(() =>
      expect(harness.service.uploadAndEstimate).toHaveBeenLastCalledWith(PDF, {
        ai_level: 'directors_cut',
      }),
    );
    expect(screen.getByTestId('preflight-ai-level-directors_cut').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it('keeps the confirmed AI level and price atomic when a re-estimate fails (review P2)', async () => {
    let estimateCalls = 0;
    const harness = buildService({
      uploadAndEstimate: jest.fn(async () => {
        estimateCalls += 1;
        if (estimateCalls === 1) {
          return { upload_id: 'up_1', book_id: 'book_9', estimate: ESTIMATE };
        }
        throw new Error('estimate endpoint down');
      }),
    });
    const screen = await renderAtPreflight(harness);

    await fireEvent.press(screen.getByTestId('preflight-ai-level-directors_cut'));

    await waitFor(() => expect(screen.getByTestId('pdf-upload-notice')).toHaveTextContent(CALM_ERRORS_AR.estimate));
    // The failed level never became the confirmed one, so the displayed price stays honest.
    expect(screen.getByTestId('preflight-ai-level-directors_cut').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
    expect(screen.getByTestId('preflight-ai-level-essential').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId('preflight-headline')).toHaveTextContent(/\$0\.45/);

    await fireEvent.press(screen.getByTestId('preflight-confirm-btn'));

    // The job must carry the level whose price is on screen — `essential`, not the failed tap.
    await waitFor(() =>
      expect(harness.service.startConversion).toHaveBeenCalledWith({
        book_id: 'book_9',
        upload_id: 'up_1',
        ai_level: 'essential',
      }),
    );
  });

  it('runs the F42 sample, saves theme #2 + style #3, then starts the conversion', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);

    await fireEvent.press(screen.getByTestId('preflight-preview-onboarding-btn'));
    await waitFor(() => expect(screen.getByTestId('onboarding-sample-card')).toBeTruthy());
    expect(harness.service.generateOnboardingSample).toHaveBeenCalledWith({ book_id: 'book_9' });

    await fireEvent.press(screen.getByTestId('onboarding-theme-th_night'));
    expect(screen.getByTestId('onboarding-theme-preview-name-ar')).toHaveTextContent('ليل هادي');
    await fireEvent.press(screen.getByTestId('onboarding-style-st_woodcut'));
    await fireEvent.press(screen.getByTestId('onboarding-confirm-btn'));

    await waitFor(() =>
      expect(harness.service.saveArtDirection).toHaveBeenCalledWith('book_9', {
        selected_theme_id: 'th_night',
        selected_style_id: 'st_woodcut',
        custom_prompt_prefix: undefined,
      }),
    );
    // OpenAPI v0: the job payload never carries art direction — it was saved just above.
    await waitFor(() =>
      expect(harness.service.startConversion).toHaveBeenCalledWith({
        book_id: 'book_9',
        upload_id: 'up_1',
        ai_level: 'essential',
      }),
    );
    expect(harness.service.subscribeProgress).toHaveBeenCalledWith(
      'job_1',
      expect.any(Function),
      // The transport-failure hook is wired from the first subscription (review P1).
      expect.any(Function),
    );
    expect(harness.savedDirections).toHaveLength(1);

    await waitFor(() => expect(screen.getByTestId('conversion-tracking-card')).toBeTruthy());
  });

  it('starts directly from preflight without an art-direction sample', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await fireEvent.press(screen.getByTestId('preflight-confirm-btn'));

    await waitFor(() =>
      expect(harness.service.startConversion).toHaveBeenCalledWith({
        book_id: 'book_9',
        upload_id: 'up_1',
        ai_level: 'essential',
      }),
    );
    const payload = (harness.service.startConversion as jest.Mock).mock.calls[0][0];
    expect(payload).not.toHaveProperty('art_direction');
    expect(harness.service.generateOnboardingSample).not.toHaveBeenCalled();
    expect(harness.service.saveArtDirection).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('conversion-tracking-card')).toBeTruthy());
  });

  it('accepts an optional byok block on the job request (OpenAPI v0 alignment)', async () => {
    const harness = buildService();

    await harness.service.startConversion({
      book_id: 'book_9',
      upload_id: 'up_1',
      ai_level: 'curated',
      byok: { mode: 'saved', key_id: 'key_7', model: 'gemini-3-pro' },
    });

    const payload = (harness.service.startConversion as jest.Mock).mock.calls[0][0];
    expect(payload.byok).toEqual({ mode: 'saved', key_id: 'key_7', model: 'gemini-3-pro' });
    expect(payload).not.toHaveProperty('art_direction');
  });

  it('prevents a double-tap from creating two jobs (review P2)', async () => {
    const pendingStart = deferred<{ job_id: string; book_id: string }>();
    const harness = buildService({
      startConversion: jest.fn(() => pendingStart.promise),
    });
    const screen = await renderAtPreflight(harness);

    const confirm = screen.getByTestId('preflight-confirm-btn');
    // Two taps in the same frame, before React can re-render — exactly what the ref lock
    // exists for. Invoking the host handler directly avoids RNTL wrapping each tap in its
    // own (overlapping) act scope.
    await act(async () => {
      confirm.props.onClick();
      confirm.props.onClick();
      confirm.props.onClick();
    });

    expect(harness.service.startConversion).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingStart.resolve({ job_id: 'job_1', book_id: 'book_9' });
    });
    await waitFor(() => expect(harness.service.subscribeProgress).toHaveBeenCalledTimes(1));
  });

  it('drops a start that resolves after unmount and opens no stream (review P2)', async () => {
    const pendingStart = deferred<{ job_id: string; book_id: string }>();
    const harness = buildService({
      startConversion: jest.fn(() => pendingStart.promise),
    });
    const screen = await renderAtPreflight(harness);

    await fireEvent.press(screen.getByTestId('preflight-confirm-btn'));
    expect(harness.service.startConversion).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.unmount();
    });

    await act(async () => {
      pendingStart.resolve({ job_id: 'job_1', book_id: 'book_9' });
      await pendingStart.promise;
    });

    expect(harness.service.subscribeProgress).not.toHaveBeenCalled();
    expect(harness.unsubscribe).not.toHaveBeenCalled();
  });

  it('shows the queue pill from the 202 queue_state and clears it once running (review P2)', async () => {
    const harness = buildService({
      startConversion: jest.fn(async () => ({
        job_id: 'job_1',
        book_id: 'book_9',
        queue_state: {
          position: 4,
          reason: 'worker_saturated' as const,
          display_message_ar: 'HOSTILE_QUEUE_TEXT sk-live-DEADBEEF at worker.ts:12',
          retry_after_sec: 30,
        },
      })),
    });
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    // The pill is visible immediately from the HTTP response — no SSE event needed.
    expect(screen.getByTestId('conversion-queue-pill')).toHaveTextContent(new RegExp(QUEUE_WAITING_MESSAGE_AR));
    expect(screen.getByTestId('conversion-queue-position')).toHaveTextContent('مكانك في الطابور: 4');
    expect(screen.queryByText(/HOSTILE_QUEUE_TEXT/)).toBeNull();

    await act(async () => {
      harness.push({ type: 'job.status', job_id: 'job_1', status: 'running' });
    });

    await waitFor(() => expect(screen.queryByTestId('conversion-queue-pill')).toBeNull());
  });

  it('exits processing cleanly when the job is cancelled (review P2)', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'job.queued',
        position: 2,
        reason: 'worker_saturated',
        display_message_ar: 'في قائمة الانتظار',
        retry_after_sec: 20,
      });
    });
    await waitFor(() => expect(screen.getByTestId('conversion-queue-pill')).toBeTruthy());

    await act(async () => {
      harness.push({ type: 'job.status', job_id: 'job_1', status: 'cancelled' });
    });

    await waitFor(() => expect(screen.getByTestId('conversion-cancelled-card')).toBeTruthy());
    expect(screen.getByTestId('conversion-cancelled-card')).toHaveTextContent(/تم إلغاء التحويل/);
    // Never stuck on «بنجهّز الكتاب», and the stream was closed instead of leaking.
    expect(screen.queryByText('بنجهّز الكتاب')).toBeNull();
    expect(screen.queryByTestId('conversion-queue-pill')).toBeNull();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('conversion-restart-btn'));
    expect(screen.getByTestId('pdf-upload-idle-card')).toBeTruthy();
  });

  it('tracks stage, page progress, calm queueing and the first-chapter banner', async () => {
    const harness = buildService();
    const onOpenReader = jest.fn();
    const screen = await renderAtPreflight(harness, onOpenReader);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'page.progress',
        job_id: 'job_1',
        current_page: 12,
        total_pages: 320,
        percent: 3.75,
        stage: 'ocr',
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('conversion-pages')).toHaveTextContent('12 / 320'),
    );
    expect(screen.getByTestId('conversion-percent')).toHaveTextContent('4%');
    expect(screen.getByTestId('conversion-stage-label')).toHaveTextContent(STAGE_LABELS_AR.ocr);
    expect(screen.getByTestId('conversion-progress-fill').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '4%' })]),
    );

    // Graceful degradation: a queued job is waiting, not failing. No popup, no red error.
    await act(async () => {
      harness.push({
        type: 'job.queued',
        position: 3,
        reason: 'worker_saturated',
        display_message_ar: 'في قائمة الانتظار',
        retry_after_sec: 30,
      });
    });

    await waitFor(() => expect(screen.getByTestId('conversion-queue-pill')).toBeTruthy());
    expect(screen.getByTestId('conversion-queue-pill')).toHaveTextContent(/في قائمة الانتظار/);
    expect(screen.getByTestId('conversion-queue-position')).toHaveTextContent('مكانك في الطابور: 3');
    expect(screen.queryByTestId('conversion-failure-card')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      harness.push(READY_CHAPTER_EVENT);
    });

    await waitFor(() => expect(screen.getByTestId('first-chapter-banner')).toBeTruthy());
    // Fixed calm copy — the stream's raw `message_ar` is never rendered.
    expect(screen.getByText('الفصل الأول جاهز، ابدأ اقرا')).toBeTruthy();
    expect(screen.queryByText(/HOSTILE_CHAPTER_TEXT/)).toBeNull();

    await fireEvent.press(screen.getByTestId('read-first-chapter-btn'));
    await waitFor(() => expect(onOpenReader).toHaveBeenCalledWith('book_9'));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('verifies the chapter is imported locally before opening the reader (review P1)', async () => {
    const harness = buildService();
    const onOpenReader = jest.fn();
    const ensureChapterImported = jest.fn(async () => {});
    harness.service.ensureChapterImported = ensureChapterImported;
    const screen = await renderAtPreflight(harness, onOpenReader);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push(READY_CHAPTER_EVENT);
    });
    await waitFor(() => expect(screen.getByTestId('first-chapter-banner')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('read-first-chapter-btn'));

    await waitFor(() => expect(onOpenReader).toHaveBeenCalledWith('book_9'));
    expect(ensureChapterImported).toHaveBeenCalledWith('book_9', 'ch01');
    // Import runs before navigation, never in parallel with it.
    expect(ensureChapterImported.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenReader.mock.invocationCallOrder[0]!,
    );
  });

  it('never opens an empty reader when the local import fails (review P1)', async () => {
    const harness = buildService();
    const onOpenReader = jest.fn();
    const ensureChapterImported = jest.fn(async () => {
      throw new Error('network down');
    });
    harness.service.ensureChapterImported = ensureChapterImported;
    const screen = await renderAtPreflight(harness, onOpenReader);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push(READY_CHAPTER_EVENT);
    });
    await waitFor(() => expect(screen.getByTestId('first-chapter-banner')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('read-first-chapter-btn'));

    await waitFor(() => expect(screen.getByTestId('pdf-upload-notice')).toHaveTextContent(CALM_ERRORS_AR.openReader));
    expect(onOpenReader).not.toHaveBeenCalled();
    expect(screen.queryByText(/network down/)).toBeNull();
    // The CTA is usable again for a retry.
    expect(screen.getByTestId('read-first-chapter-btn')).toHaveTextContent('ابدأ اقرا');
  });

  it('locks the reader CTA against a double tap while the import is in flight (review P1)', async () => {
    const harness = buildService();
    const onOpenReader = jest.fn();
    const pendingImport = deferred<void>();
    const ensureChapterImported = jest.fn(() => pendingImport.promise);
    harness.service.ensureChapterImported = ensureChapterImported;
    const screen = await renderAtPreflight(harness, onOpenReader);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push(READY_CHAPTER_EVENT);
    });
    await waitFor(() => expect(screen.getByTestId('first-chapter-banner')).toBeTruthy());

    const button = screen.getByTestId('read-first-chapter-btn');
    await act(async () => {
      button.props.onClick();
      button.props.onClick();
    });

    expect(ensureChapterImported).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingImport.resolve();
      await pendingImport.promise;
    });

    await waitFor(() => expect(onOpenReader).toHaveBeenCalledTimes(1));
  });

  it('shows a calm notice when the live stream drops while the job keeps running (review P1)', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.pushError(new Error('socket hang up at stream.ts:12 sk-live-DEADBEEF'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('pdf-upload-notice')).toHaveTextContent(
        LIVE_PROGRESS_DISCONNECTED_AR,
      ),
    );
    // Still tracking, and the raw transport text never reaches the user.
    expect(screen.getByTestId('conversion-tracking-card')).toBeTruthy();
    expect(screen.queryByText(/socket hang up/)).toBeNull();
    expect(screen.queryByText(/sk-live/)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('ignores a late stream error once the job was cancelled', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({ type: 'job.status', job_id: 'job_1', status: 'cancelled' });
    });
    await waitFor(() => expect(screen.getByTestId('conversion-cancelled-card')).toBeTruthy());

    await act(async () => {
      harness.pushError(new Error('stream closed after cancel'));
    });

    expect(screen.queryByText(LIVE_PROGRESS_DISCONNECTED_AR)).toBeNull();
  });

  it('imports the manifest chapters when a completed job never sent chapter.ready (review P1)', async () => {
    const harness = buildService();
    const onOpenReader = jest.fn();
    const ensureChapterImported = jest.fn(async () => {});
    harness.service.ensureChapterImported = ensureChapterImported;
    const screen = await renderAtPreflight(harness, onOpenReader);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'job.completed',
        job_id: 'job_1',
        book_id: 'book_9',
        manifest_url: '/v1/books/book_9/bundle/manifest',
        book_md_url: '/v1/books/book_9/bundle/book.md',
        chapters_count: 18,
        pages_processed: 320,
      });
    });
    await waitFor(() => expect(screen.getByText('الكتاب خلص')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('conversion-done-btn'));

    await waitFor(() => expect(onOpenReader).toHaveBeenCalledWith('book_9'));
    // No ready chapter in state: the service is asked to import whatever the manifest marks
    // ready, so the reader still opens on real content.
    expect(ensureChapterImported).toHaveBeenCalledWith('book_9', undefined);
    expect(ensureChapterImported.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenReader.mock.invocationCallOrder[0]!,
    );
  });

  it('does not start a conversion when the screen unmounts during saveArtDirection (review P2)', async () => {
    const pendingSave = deferred<BookArtDirection>();
    const harness = buildService({
      saveArtDirection: jest.fn(() => pendingSave.promise),
    });
    const screen = await renderAtPreflight(harness);

    await fireEvent.press(screen.getByTestId('preflight-preview-onboarding-btn'));
    await waitFor(() => expect(screen.getByTestId('onboarding-sample-card')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('onboarding-confirm-btn'));
    expect(harness.service.saveArtDirection).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.unmount();
    });

    await act(async () => {
      pendingSave.resolve({
        book_id: 'book_9',
        selected_theme_id: 'th_night',
        selected_style_id: 'st_woodcut',
        updated_at: '2026-11-27T00:00:00Z',
      });
      await pendingSave.promise;
    });

    expect(harness.service.startConversion).not.toHaveBeenCalled();
  });

  it('shows the on-demand budget notice calmly when image generation pauses', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'budget.mode_changed',
        mode: 'on_demand',
        reason: 'book cap reached',
        spent_usd: 0.45,
        cap_usd: 0.45,
      });
    });

    await waitFor(() => expect(screen.getByTestId('conversion-budget-notice')).toBeTruthy());
    expect(screen.getByTestId('conversion-budget-notice')).toHaveTextContent(
      /وقفنا توليد الصور التلقائي عند حد الميزانية/,
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('completes the job with a 100% bar and keeps the reader CTA', async () => {
    const harness = buildService();
    const onOpenReader = jest.fn();
    const screen = await renderAtPreflight(harness, onOpenReader);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'job.completed',
        job_id: 'job_1',
        book_id: 'book_9',
        manifest_url: '/v1/books/book_9/bundle/manifest',
        book_md_url: '/v1/books/book_9/bundle/book.md',
        chapters_count: 18,
        pages_processed: 320,
      });
    });

    await waitFor(() => expect(screen.getByText('الكتاب خلص')).toBeTruthy());
    expect(screen.getByTestId('conversion-percent')).toHaveTextContent('100%');
    expect(screen.getByTestId('conversion-stage-label')).toHaveTextContent('خلص التحويل');
    expect(screen.getByTestId('conversion-done-btn')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('conversion-done-btn'));
    expect(onOpenReader).toHaveBeenCalledWith('book_9');
  });

  it('maps failures from error.code and never renders raw error text (review P2)', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'job.failed',
        job_id: 'job_1',
        error: {
          code: 'provider_error',
          message: 'WEIRD_SECRET_XYZ_999 stack trace at foo.ts:42',
          message_ar: 'Bearer sk-live-DEADBEEF مرفوض من عند المزوّد',
          retryable: false,
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('conversion-failure-card')).toBeTruthy());
    expect(screen.getByTestId('conversion-failure-card')).toHaveTextContent(FALLBACK_JOB_ERROR_AR);
    expect(screen.queryByText(/WEIRD_SECRET_XYZ_999/)).toBeNull();
    expect(screen.queryByText(/stack trace/)).toBeNull();
    expect(screen.queryByText(/sk-live/)).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('uses calm Arabic copy for known failure codes instead of the server message', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'job.failed',
        job_id: 'job_1',
        error: {
          code: 'quota_exhausted',
          message: 'quota exhausted at billing.ts:9',
          message_ar: 'quota exhausted',
          retryable: false,
        },
      });
    });

    await waitFor(() => expect(screen.getByTestId('conversion-failure-card')).toBeTruthy());
    expect(screen.getByTestId('conversion-failure-card')).toHaveTextContent(/خلصت الحصة المتاحة/);
    expect(screen.queryByText(/billing\.ts/)).toBeNull();
  });

  it('exposes progress-bar semantics, a live queue region and an RTL header (review P3)', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      harness.push({
        type: 'page.progress',
        job_id: 'job_1',
        current_page: 12,
        total_pages: 320,
        percent: 3.75,
        stage: 'ocr',
      });
    });

    await waitFor(() => expect(screen.getByTestId('conversion-progress-bar')).toBeTruthy());
    const bar = screen.getByTestId('conversion-progress-bar');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 4 });

    await act(async () => {
      harness.push({
        type: 'job.queued',
        position: 1,
        reason: 'worker_saturated',
        display_message_ar: 'في قائمة الانتظار',
        retry_after_sec: 15,
      });
    });
    await waitFor(() => expect(screen.getByTestId('conversion-queue-pill')).toBeTruthy());
    expect(screen.getByTestId('conversion-queue-pill').props.accessibilityLiveRegion).toBe('polite');

    const header = screen.getByTestId('pdf-upload-header');
    expect(flatStyle(header).direction).toBe('rtl');
    expect(flatStyle(header).flexDirection).toBe('row');
  });

  it('shows the calm unconfigured-service banner instead of a silent broken flow (review P1)', async () => {
    const screen = await render(<PdfUploadScreen />);

    expect(screen.getByTestId('pdf-upload-offline-banner')).toHaveTextContent(
      OFFLINE_SERVICE_BANNER_AR,
    );

    await fireEvent.press(screen.getByTestId('pick-pdf-btn'));

    await waitFor(() => expect(screen.getByTestId('pdf-upload-notice')).toBeTruthy());
    expect(screen.getByTestId('pdf-upload-notice')).toHaveTextContent(OFFLINE_SERVICE_MESSAGE_AR);
    expect(screen.getByTestId('pdf-upload-idle-card')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('unsubscribes from the progress stream when the screen unmounts', async () => {
    const harness = buildService();
    const screen = await renderAtPreflight(harness);
    await startAndTrackJob(harness, screen);

    await act(async () => {
      screen.unmount();
    });

    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
