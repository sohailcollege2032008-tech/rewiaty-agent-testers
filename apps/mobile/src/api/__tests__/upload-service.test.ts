/**
 * `createRewiatyApiUploadService` — the live `PdfUploadService` over the v0 API client.
 *
 * The two product rules that must never regress:
 *  1. re-estimating an AI level never re-uploads the PDF, and
 *  2. `startConversion` sends no `art_direction` (it is persisted separately).
 */
import {
  CONVERSION_NEEDS_BYOK_AR,
  CUSTOM_BASE_URL_NEEDED_AR,
  createChapterAssetDownloader,
  createRewiatyApiUploadService,
  isSafeChapterAssetName,
  SAMPLE_NEEDS_BYOK_AR,
  toProgressEvent,
} from '@/api/upload-service';
import type {
  BookArtDirection,
  ChapterBundleAsset,
  CostEstimateResponse,
  JobCreateRequest,
  OnboardingSampleResponse,
  PresignUploadResponse,
} from '@/api/types';
import type { PickedPdf } from '@/types/upload-contract';
import { subscribeToJobEvents, type SubscribeJobEventsOptions } from '@/api/sse';
import { ProgressiveBookImporter } from '@/api/progressive-import';
import {
  BYOK_CUSTOM_MODEL_LEGACY_ERROR_AR,
  LEGACY_CUSTOM_MODEL_ID,
  loadByokConfig,
  readByokSecret,
} from '@/storage/byok-store';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => {
  const join = (parts: Array<string | { uri: string }>): string =>
    parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  const writes: Array<{ uri: string; bytes: Uint8Array }> = [];

  class MockDirectory {
    readonly uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = join(parts);
    }
    create(): void {}
  }

  class MockFile {
    readonly uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = join(parts);
    }
    bytes(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array([1, 2, 3]));
    }
    async write(bytes: Uint8Array): Promise<void> {
      writes.push({ uri: this.uri, bytes });
    }
  }

  return { Directory: MockDirectory, File: MockFile, __mockWrites: writes };
});

jest.mock('@/storage/bundle', () => ({
  getBookDir: jest.fn((bookId: string) => ({
    uri: `file:///documents/books/${bookId}`,
    create: jest.fn(),
  })),
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
const loadByokConfigMock = loadByokConfig as unknown as jest.Mock;
const readByokSecretMock = readByokSecret as unknown as jest.Mock;

const fsMock = jest.requireMock('expo-file-system') as {
  __mockWrites: Array<{ uri: string; bytes: Uint8Array }>;
};
const fetchMock = jest.fn();

function okResponse(bytes: number[] = [9, 8, 7]): {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

function chapterAsset(overrides: Partial<ChapterBundleAsset> = {}): ChapterBundleAsset {
  return {
    name: 'fig-001.webp',
    url: '/v1/books/book_1/assets/fig-001.webp',
    width: 900,
    height: 1200,
    ...overrides,
  };
}

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
    fsMock.__mockWrites.length = 0;
    fetchMock.mockReset();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;

    // Defaults for the real `resolveByokFromStorage` path (used by the custom-provider tests).
    loadByokConfigMock.mockResolvedValue({
      provider: 'openai',
      modelId: 'gpt-4.1',
      storageMode: 'ephemeral',
      keyLast4: '1234',
      hasKey: true,
      updatedAt: 1,
      customBaseUrl: null,
    });
    readByokSecretMock.mockResolvedValue('test-openai-key');
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

  it('refuses to start a conversion without BYOK and never calls createJob (review P2)', async () => {
    resolveByok.mockResolvedValue(undefined);
    const service = build();
    await expect(
      service.startConversion({
        book_id: 'book_1',
        upload_id: 'up_1',
        ai_level: 'purist',
      }),
    ).rejects.toThrow(CONVERSION_NEEDS_BYOK_AR);
    expect(client.createJob).not.toHaveBeenCalled();
  });

  it('still accepts an explicit byok block without reading storage', async () => {
    resolveByok.mockRejectedValue(new Error('storage should not be read'));
    const service = build();
    await service.startConversion({
      book_id: 'book_1',
      upload_id: 'up_1',
      ai_level: 'essential',
      byok: { mode: 'saved', key_id: 'key_7', model: 'gemini-3-pro' },
    });

    const body = client.createJob.mock.calls[0]![0];
    expect(body.byok).toEqual({ mode: 'saved', key_id: 'key_7', model: 'gemini-3-pro' });
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
    // The importer must receive a downloader, otherwise chapter images never reach disk.
    expect(importerMock).toHaveBeenCalledWith(client, 'book_1', db, {
      downloadAsset: expect.any(Function),
    });
    expect(importReadyChapters).toHaveBeenNthCalledWith(1, ['ch_01']);
    expect(importReadyChapters).toHaveBeenNthCalledWith(2, ['ch_02']);
  });

  it('imports every manifest-ready chapter when the job completed without chapter.ready (review P1)', async () => {
    const importReadyChapters = jest.fn(async () => ({
      importedCount: 3,
      skippedCount: 0,
      totalChapters: 3,
      isComplete: true,
      bookRecord: { id: 'book_1' } as never,
    }));
    importerMock.mockImplementation(() => ({ importReadyChapters }));
    const service = build();

    await service.ensureChapterImported!('book_1');

    // No argument: the importer falls back to `manifest.ready_chapter_ids`.
    expect(importReadyChapters).toHaveBeenCalledWith();
  });

  it('never borrows another book\'s upload_id for an explicit book_id (review P3)', async () => {
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

    // `book_9` was never uploaded in this session: the last upload (book_2's up_2) must NOT leak.
    await service.generateOnboardingSample({ book_id: 'book_9' });

    expect(client.generateOnboardingSample).toHaveBeenCalledWith('book_9', {
      byok: BYOK,
      include_style_previews: true,
    });
  });

  it('keeps the last upload as a fallback only when no book_id is named', async () => {
    const service = build();
    await service.uploadAndEstimate(PDF, { ai_level: 'essential' });

    await service.generateOnboardingSample();

    expect(client.generateOnboardingSample).toHaveBeenCalledWith('book_1', {
      upload_id: 'up_1',
      byok: BYOK,
      include_style_previews: true,
    });
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

  it('passes an injected downloadAsset through to ProgressiveBookImporter', async () => {
    const importReadyChapters = jest.fn(async () => ({
      importedCount: 1,
      skippedCount: 0,
      totalChapters: 1,
      isComplete: true,
      bookRecord: { id: 'book_1' } as never,
    }));
    importerMock.mockImplementation(() => ({ importReadyChapters }));
    const downloadAsset = jest.fn(async () => undefined);
    const service = build({ downloadAsset });

    await service.ensureChapterImported!('book_1', 'ch_01');

    expect(importerMock).toHaveBeenCalledWith(client, 'book_1', undefined, { downloadAsset });
  });

  it('maps the custom provider to openai_compatible with its https base_url and real model', async () => {
    loadByokConfigMock.mockResolvedValue({
      provider: 'custom',
      modelId: 'deepseek-chat',
      storageMode: 'ephemeral',
      keyLast4: '3456',
      hasKey: true,
      updatedAt: 1,
      customBaseUrl: 'https://api.my-gateway.example/v1',
    });
    readByokSecretMock.mockResolvedValue('test-custom-key');

    // No `resolveByok` override: exercise the real storage resolver.
    const service = createRewiatyApiUploadService({
      client: client as never,
      readPdfBytes,
    });
    await service.startConversion({
      book_id: 'book_1',
      upload_id: 'up_1',
      ai_level: 'essential',
    });

    expect(client.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        byok: {
          mode: 'ephemeral',
          provider: 'openai_compatible',
          api_key: 'test-custom-key',
          base_url: 'https://api.my-gateway.example/v1',
          model: 'deepseek-chat',
        },
      }),
    );
  });

  it('refuses to send the legacy custom placeholder as a model, with a clear message', async () => {
    loadByokConfigMock.mockResolvedValue({
      provider: 'custom',
      modelId: LEGACY_CUSTOM_MODEL_ID,
      storageMode: 'ephemeral',
      keyLast4: '3456',
      hasKey: true,
      updatedAt: 1,
      customBaseUrl: 'https://api.my-gateway.example/v1',
    });
    readByokSecretMock.mockResolvedValue('test-custom-key');

    const service = createRewiatyApiUploadService({
      client: client as never,
      readPdfBytes,
    });

    await expect(
      service.startConversion({ book_id: 'book_1', upload_id: 'up_1', ai_level: 'essential' }),
    ).rejects.toThrow(BYOK_CUSTOM_MODEL_LEGACY_ERROR_AR);
    expect(client.createJob).not.toHaveBeenCalled();
  });

  it('refuses a custom provider whose base_url is missing or not https', async () => {
    for (const customBaseUrl of [null, 'http://insecure.example/v1', 'api.example/v1']) {
      loadByokConfigMock.mockResolvedValue({
        provider: 'custom',
        modelId: 'custom-vision-model',
        storageMode: 'ephemeral',
        keyLast4: '3456',
        hasKey: true,
        updatedAt: 1,
        customBaseUrl,
      });
      readByokSecretMock.mockResolvedValue('test-custom-key');
      client.createJob.mockClear();

      const service = createRewiatyApiUploadService({
        client: client as never,
        readPdfBytes,
      });

      await expect(
        service.startConversion({ book_id: 'book_1', upload_id: 'up_1', ai_level: 'essential' }),
      ).rejects.toThrow(CUSTOM_BASE_URL_NEEDED_AR);
      expect(client.createJob).not.toHaveBeenCalled();
    }
  });
});

describe('createChapterAssetDownloader', () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = makeClient();
    fsMock.__mockWrites.length = 0;
    fetchMock.mockReset();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  it.each([
    '../secret.webp',
    'sub/img.webp',
    'a\\b.webp',
    '..\\evil.webp',
    '.',
    '..',
    '',
  ])('rejects the unsafe asset name %p before touching the filesystem', async (name) => {
    expect(isSafeChapterAssetName(name)).toBe(false);

    const download = createChapterAssetDownloader(client as never);
    await expect(download(chapterAsset({ name }), 'book_1')).rejects.toThrow(/غير صالح/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fsMock.__mockWrites).toHaveLength(0);
  });

  it('accepts plain flat filenames', () => {
    for (const name of ['fig-001.webp', 'cover.png', 'a.b.c.jpeg', '_x_.webp']) {
      expect(isSafeChapterAssetName(name)).toBe(true);
    }
    expect(isSafeChapterAssetName(42)).toBe(false);
    expect(isSafeChapterAssetName(null)).toBe(false);
  });

  it('writes a relative API asset into books/<book_id>/assets/<name> with Authorization', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([1, 2, 3, 4]));

    const download = createChapterAssetDownloader(client as never);
    await download(chapterAsset(), 'book_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.rewiaty.example/v1/books/book_1/assets/fig-001.webp',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer token_1' } }),
    );
    expect(fsMock.__mockWrites).toHaveLength(1);
    expect(fsMock.__mockWrites[0]!.uri).toBe(
      'file:///documents/books/book_1/assets/fig-001.webp',
    );
    expect(Array.from(fsMock.__mockWrites[0]!.bytes)).toEqual([1, 2, 3, 4]);
  });

  it('never sends the app JWT to an absolute presigned https URL', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([7, 7]));

    const download = createChapterAssetDownloader(client as never);
    const presigned = 'https://s3.example/presigned/fig-001.webp?X-Amz-Signature=abc';
    await download(chapterAsset({ url: presigned }), 'book_1');

    const [url, options] = fetchMock.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(url).toBe(presigned);
    expect(options.headers).toBeUndefined();
    expect(JSON.stringify(options)).not.toContain('token_1');
  });

  it('throws when the asset response is not ok and writes nothing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });

    const download = createChapterAssetDownloader(client as never);
    await expect(download(chapterAsset(), 'book_1')).rejects.toThrow('404');
    expect(fsMock.__mockWrites).toHaveLength(0);
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
