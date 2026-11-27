/**
 * `createRewiatyApiUploadService` — the live `PdfUploadService` over the v0 API client.
 *
 * The two product rules that must never regress:
 *  1. re-estimating an AI level never re-uploads the PDF, and
 *  2. `startConversion` sends no `art_direction` (it is persisted separately).
 */
import { createRewiatyApiUploadService, SAMPLE_NEEDS_BYOK_AR, toProgressEvent } from '@/api/upload-service';
import type {
  BookArtDirection,
  CostEstimateResponse,
  JobCreateRequest,
  OnboardingSampleResponse,
  PresignUploadResponse,
} from '@/api/types';
import type { PickedPdf } from '@/types/upload-contract';
import { subscribeToJobEvents, type SubscribeJobEventsOptions } from '@/api/sse';
import { ProgressiveBookImporter } from '@/api/progressive-import';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    bytes(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array([1, 2, 3]));
    }
  },
}));

jest.mock('@/storage/byok-store', () => {
  const actual = jest.requireActual('@/storage/byok-store');
  return {
    ...actual,
    loadByokConfig: jest.fn(),
    readByokSecret: jest.fn(),
  };
});

jest.mock('@/api/sse', () => {
  const actual = jest.requireActual('@/api/sse');
  return { ...actual, subscribeToJobEvents: jest.fn() };
});

jest.mock('@/api/progressive-import', () => ({
  ProgressiveBookImporter: jest.fn(),
}));

const subscribeMock = subscribeToJobEvents as unknown as jest.Mock;
const importerMock = ProgressiveBookImporter as unknown as jest.Mock;

const PDF: PickedPdf = {
  uri: 'file:///cache/riwaya.pdf',
  name: 'riwaya.pdf',
  sizeBytes: 204800,
  mimeType: 'application/pdf',
};

const PRESIGN: PresignUploadResponse = {
  upload_id: 'up_1',
  book_id: 'book_1',
  upload_url: 'https://storage.example/put/up_1',
  method: 'PUT',
  headers: {},
  expires_at: '2026-11-27T12:00:00Z',
  raw_purge_after_hours: 24,
};

const ESTIMATE: CostEstimateResponse = {
  upload_id: 'up_1',
  book_id: 'book_1',
  page_count: 120,
  is_digital_text_clean: true,
  text_layer_quality: 'usable',
  routing_mode: 'text_only',
  estimated_ocr_pages: 0,
  estimated_image_count: 4,
  estimated_cost_usd: { text_usd: 0.02, image_usd: 0.01, total_usd: 0.03 },
  estimated_duration_sec: 90,
  warnings: [],
};

function makeClient() {
  return {
    presignUpload: jest.fn(async (_body: unknown) => PRESIGN),
    uploadPdfBytes: jest.fn(async (_presign: unknown, _data: unknown) => undefined),
    completeUpload: jest.fn(async (_uploadId: string) => ({ upload_id: 'up_1', book_id: 'book_1' })),
    estimateJob: jest.fn(async (_body: unknown) => ESTIMATE),
    generateOnboardingSample: jest.fn(async (_bookId: string, _body: unknown) => MOCK_SAMPLE),
    saveArtDirection: jest.fn(async (_bookId: string, _body: unknown) => MOCK_ART_DIRECTION),
    createJob: jest.fn(async (_body: JobCreateRequest) => ({
      job_id: 'job_1',
      book_id: 'book_1',
      status: 'queued' as const,
    })),
    getBaseUrl: jest.fn(() => 'https://api.rewiaty.example'),
    getAuthToken: jest.fn(async () => 'token_1'),
  };
}

const MOCK_SAMPLE: OnboardingSampleResponse = {
  book_id: 'book_1',
  themes: [],
  styles: [],
  sample_cost_usd: 0.05,
};

const MOCK_ART_DIRECTION: BookArtDirection = {
  book_id: 'book_1',
  selected_theme_id: 'theme_a',
  selected_style_id: 'style_a',
  updated_at: '2026-11-27T10:00:00Z',
};

const BYOK = {
  mode: 'ephemeral' as const,
  provider: 'openai',
  api_key: 'sk-test',
  model: 'gpt-x',
};

const readPdfBytes = jest.fn(async () => new Uint8Array([1, 2, 3]));
const resolveByok = jest.fn(async () => BYOK as typeof BYOK | undefined);

describe('createRewiatyApiUploadService', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = makeClient();
    readPdfBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    resolveByok.mockResolvedValue(BYOK);
  });

  function build(overrides: Partial<Parameters<typeof createRewiatyApiUploadService>[0]> = {}) {
    return createRewiatyApiUploadService({
      client: client as never,
      readPdfBytes,
      resolveByok,
      ...overrides,
    });
  }

  it('runs presign → PUT → complete → estimate once per file', async () => {
    const service = build();
    const result = await service.uploadAndEstimate(PDF, { ai_level: 'essential' });

    expect(client.presignUpload).toHaveBeenCalledWith({
      filename: 'riwaya.pdf',
      content_type: 'application/pdf',
      size_bytes: 204800,
    });
    expect(readPdfBytes).toHaveBeenCalledWith(PDF.uri);
    expect(client.uploadPdfBytes).toHaveBeenCalledWith(PRESIGN, expect.any(Uint8Array));
    expect(client.completeUpload).toHaveBeenCalledWith('up_1');
    expect(client.estimateJob).toHaveBeenCalledWith({ upload_id: 'up_1', ai_level: 'essential' });
    expect(result).toEqual({ upload_id: 'up_1', book_id: 'book_1', estimate: ESTIMATE });
  });

  it('accepts the object form { file, aiLevel }', async () => {
    const service = build();
    await service.uploadAndEstimate({ file: PDF, aiLevel: 'curated' });
    expect(client.estimateJob).toHaveBeenCalledWith({ upload_id: 'up_1', ai_level: 'curated' });
  });

  it('re-estimating a new AI level never re-uploads the same PDF', async () => {
    const service = build();
    await service.uploadAndEstimate(PDF, { ai_level: 'purist' });
    await service.uploadAndEstimate(PDF, { ai_level: 'directors_cut' });

    expect(client.presignUpload).toHaveBeenCalledTimes(1);
    expect(client.uploadPdfBytes).toHaveBeenCalledTimes(1);
    expect(client.completeUpload).toHaveBeenCalledTimes(1);
    expect(client.estimateJob).toHaveBeenCalledTimes(2);
    expect(client.estimateJob).toHaveBeenLastCalledWith({
      upload_id: 'up_1',
      ai_level: 'directors_cut',
    });
  });

  it('a different picked file uploads again', async () => {
    const service = build();
    await service.uploadAndEstimate(PDF, { ai_level: 'essential' });
    await service.uploadAndEstimate({ ...PDF, uri: 'file:///cache/other.pdf' }, { ai_level: 'essential' });
    expect(client.presignUpload).toHaveBeenCalledTimes(2);
    expect(client.uploadPdfBytes).toHaveBeenCalledTimes(2);
  });

  it('still caches the upload when the estimate fails', async () => {
    const service = build();
    client.estimateJob.mockRejectedValueOnce(new Error('network'));
    await expect(service.uploadAndEstimate(PDF, { ai_level: 'essential' })).rejects.toThrow('network');
    client.estimateJob.mockResolvedValueOnce(ESTIMATE);

    await service.uploadAndEstimate(PDF, { ai_level: 'essential' });
    expect(client.presignUpload).toHaveBeenCalledTimes(1);
    expect(client.uploadPdfBytes).toHaveBeenCalledTimes(1);
  });

  it('generates the onboarding sample with the remembered upload + BYOK', async () => {
    const service = build();
    await service.uploadAndEstimate(PDF, { ai_level: 'curated' });
    const sample = await service.generateOnboardingSample({ book_id: 'book_1' });

    expect(client.generateOnboardingSample).toHaveBeenCalledWith('book_1', {
      upload_id: 'up_1',
      byok: BYOK,
      include_style_previews: true,
    });
    expect(sample).toEqual(MOCK_SAMPLE);
  });

  it('throws a calm Arabic error when no BYOK key is saved', async () => {
    resolveByok.mockResolvedValue(undefined);
    const service = build();
    await service.uploadAndEstimate(PDF, { ai_level: 'essential' });

    await expect(service.generateOnboardingSample({ book_id: 'book_1' })).rejects.toThrow(
      SAMPLE_NEEDS_BYOK_AR,
    );
    expect(client.generateOnboardingSample).not.toHaveBeenCalled();
  });

  it('persists art direction through its own endpoint', async () => {
    const service = build();
    const saved = await service.saveArtDirection('book_1', {
      selected_theme_id: 'theme_a',
      selected_style_id: 'style_a',
    });
    expect(client.saveArtDirection).toHaveBeenCalledWith('book_1', {
      selected_theme_id: 'theme_a',
      selected_style_id: 'style_a',
    });
    expect(saved).toEqual(MOCK_ART_DIRECTION);
  });

  it('creates the job without art_direction and with the budget cap', async () => {
    const service = build();
    await service.uploadAndEstimate(PDF, { ai_level: 'essential' });
    const result = await service.startConversion({
      book_id: 'book_1',
      upload_id: 'up_1',
      ai_level: 'essential',
      budget_cap_usd: 2.5,
    });

    const body = client.createJob.mock.calls[0]![0];
    expect(body).toEqual({
      book_id: 'book_1',
      upload_id: 'up_1',
      ai_level: 'essential',
      byok: BYOK,
      budget_cap_usd: 2.5,
    });
    expect(body).not.toHaveProperty('art_direction');
    expect(result).toEqual({
      job_id: 'job_1',
      book_id: 'book_1',
      status: 'queued',
      queue_state: undefined,
    });
  });

  it('omits byok when no key is saved and lets the server error surface', async () => {
    resolveByok.mockResolvedValue(undefined);
    const service = build();
    await service.startConversion({
      book_id: 'book_1',
      upload_id: 'up_1',
      ai_level: 'purist',
    });
    const body = client.createJob.mock.calls[0]![0];
    expect(body).not.toHaveProperty('byok');
    expect(body).not.toHaveProperty('budget_cap_usd');
  });

  it('subscribes to SSE with the client base URL/token and aborts on unsubscribe', async () => {
    let options: SubscribeJobEventsOptions | undefined;
    subscribeMock.mockImplementation(async (opts: SubscribeJobEventsOptions) => {
      options = opts;
      return { aborted: false };
    });
    const service = build();
    const onEvent = jest.fn();
    const unsubscribe = service.subscribeProgress('job_1', onEvent);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(options!.baseUrl).toBe('https://api.rewiaty.example');
    await expect(options!.getAccessToken!()).resolves.toBe('token_1');
    expect(options!.signal!.aborted).toBe(false);

    unsubscribe();
    expect(options!.signal!.aborted).toBe(true);
  });

  it('drops heartbeat frames and re-emits real progress events flattened', async () => {
    let options: SubscribeJobEventsOptions | undefined;
    subscribeMock.mockImplementation(async (opts: SubscribeJobEventsOptions) => {
      options = opts;
      return { aborted: false };
    });
    const service = build();
    const onEvent = jest.fn();
    service.subscribeProgress('job_1', onEvent);

    options!.onEvent({
      event: 'heartbeat',
      data: { timestamp: '2026-11-27T10:00:00Z' },
    } as never);
    options!.onEvent({
      event: 'page.progress',
      data: {
        job_id: 'job_1',
        current_page: 5,
        total_pages: 20,
        percent: 25,
        stage: 'ocr',
      },
    } as never);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'page.progress',
      job_id: 'job_1',
      current_page: 5,
      total_pages: 20,
      percent: 25,
      stage: 'ocr',
    });
  });

  it('does not report an error after unsubscribe', async () => {
    let options: SubscribeJobEventsOptions | undefined;
    subscribeMock.mockImplementation(async (opts: SubscribeJobEventsOptions) => {
      options = opts;
      return { aborted: false };
    });
    const service = build();
    const onError = jest.fn();
    const unsubscribe = service.subscribeProgress('job_1', jest.fn(), onError);
    unsubscribe();
    options!.onError?.(new Error('boom'));
    expect(onError).not.toHaveBeenCalled();
  });

  it('imports the first ready chapter through ProgressiveBookImporter and reuses it per book', async () => {
    const importReadyChapters = jest.fn(async () => ({
      importedCount: 1,
      skippedCount: 0,
      totalChapters: 3,
      isComplete: false,
      bookRecord: { id: 'book_1' } as never,
    }));
    importerMock.mockImplementation(() => ({ importReadyChapters }));
    const db = { name: 'db' } as never;
    const service = build({ db });
    await service.ensureChapterImported!('book_1', 'ch_01');
    await service.ensureChapterImported!('book_1', 'ch_02');

    expect(importerMock).toHaveBeenCalledTimes(1);
    expect(importerMock).toHaveBeenCalledWith(client, 'book_1', db);
    expect(importReadyChapters).toHaveBeenNthCalledWith(1, ['ch_01']);
    expect(importReadyChapters).toHaveBeenNthCalledWith(2, ['ch_02']);
  });

  it('throws when the initial chapter import persists no bundle on disk', async () => {
    const importReadyChapters = jest.fn(async () => ({
      importedCount: 0,
      skippedCount: 1,
      totalChapters: 3,
      isComplete: false,
      bookRecord: null,
    }));
    importerMock.mockImplementation(() => ({ importReadyChapters }));
    const service = build();
    await expect(service.ensureChapterImported!('book_1', 'ch_01')).rejects.toThrow(
      'الفصل لسه مش جاهز',
    );
  });

  it('measures file bytes before presignUpload when DocumentPicker reports sizeBytes = 0', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    readPdfBytes.mockResolvedValueOnce(bytes);
    const service = build();

    await service.uploadAndEstimate({ ...PDF, sizeBytes: 0 }, { ai_level: 'essential' });

    expect(readPdfBytes).toHaveBeenCalledTimes(1);
    expect(client.presignUpload).toHaveBeenCalledWith({
      filename: 'riwaya.pdf',
      content_type: 'application/pdf',
      size_bytes: 5,
    });
    expect(client.uploadPdfBytes).toHaveBeenCalledWith(PRESIGN, bytes);
  });

  it('keeps book_id → upload_id separate when two PDFs are uploaded in one session', async () => {
    client.presignUpload
      .mockResolvedValueOnce({ ...PRESIGN, upload_id: 'up_1', book_id: 'book_1' })
      .mockResolvedValueOnce({ ...PRESIGN, upload_id: 'up_2', book_id: 'book_2' });
    client.completeUpload
      .mockResolvedValueOnce({ upload_id: 'up_1', book_id: 'book_1' })
      .mockResolvedValueOnce({ upload_id: 'up_2', book_id: 'book_2' });
    client.estimateJob
      .mockResolvedValueOnce({ ...ESTIMATE, upload_id: 'up_1', book_id: 'book_1' })
      .mockResolvedValueOnce({ ...ESTIMATE, upload_id: 'up_2', book_id: 'book_2' });

    const service = build();
    await service.uploadAndEstimate(PDF, { ai_level: 'essential' });
    await service.uploadAndEstimate({ ...PDF, uri: 'file:///cache/second.pdf' }, { ai_level: 'essential' });

    await service.generateOnboardingSample({ book_id: 'book_1' });
    expect(client.generateOnboardingSample).toHaveBeenCalledWith('book_1', {
      upload_id: 'up_1',
      byok: BYOK,
      include_style_previews: true,
    });
  });
});

describe('toProgressEvent', () => {
  it('maps budget, chapter and terminal frames', () => {
    expect(
      toProgressEvent({
        event: 'budget.mode_changed',
        data: { mode: 'on_demand', reason: 'cap', spent_usd: 1, cap_usd: 1 },
      } as never),
    ).toEqual({ type: 'budget.mode_changed', mode: 'on_demand', reason: 'cap', spent_usd: 1, cap_usd: 1 });

    expect(
      toProgressEvent({
        event: 'chapter.ready',
        data: {
          chapter_id: 'ch_01',
          chapter_index: 1,
          title: 'الأول',
          message_ar: 'جاهز',
          chapter_url: 'https://x/ch_01.json',
          manifest_url: 'https://x/manifest.json',
          word_count: 900,
        },
      } as never),
    ).toEqual({
      type: 'chapter.ready',
      chapter_id: 'ch_01',
      chapter_index: 1,
      title: 'الأول',
      message_ar: 'جاهز',
      chapter_url: 'https://x/ch_01.json',
      manifest_url: 'https://x/manifest.json',
      word_count: 900,
    });

    expect(
      toProgressEvent({
        event: 'job.completed',
        data: {
          job_id: 'job_1',
          book_id: 'book_1',
          manifest_url: 'https://x/manifest.json',
          book_md_url: 'https://x/book.md',
          chapters_count: 3,
          pages_processed: 40,
        },
      } as never),
    ).toEqual({
      type: 'job.completed',
      job_id: 'job_1',
      book_id: 'book_1',
      manifest_url: 'https://x/manifest.json',
      book_md_url: 'https://x/book.md',
      chapters_count: 3,
      pages_processed: 40,
    });

    expect(
      toProgressEvent({ event: 'job.failed', data: { job_id: 'job_1', error: { code: 'X' } } } as never),
    ).toEqual({ type: 'job.failed', job_id: 'job_1', error: { code: 'X' } });
  });
});
