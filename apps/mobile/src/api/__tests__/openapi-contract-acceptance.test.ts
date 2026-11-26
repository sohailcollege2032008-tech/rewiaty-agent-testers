/**
 * Blind acceptance tests — L3 Wave 2.
 *
 * Deliverable: OpenAPI v0 typed client & SSE subscriber (`@/api`).
 * These tests are written ONLY from the published contract
 * (`contracts/openapi.yaml`) and the agreed TypeScript surface:
 *
 *   new RewiatyApiClient({ baseUrl, fetchImpl, getAccessToken? })
 *   client.authenticateDevice({ device_id, platform, app_version? })
 *   client.estimateJob({ upload_id, ai_level, provider?, model?, options? })
 *   client.createJob({ book_id, upload_id, ai_level, byok, budget_cap_usd?, options? })
 *   client.generateOnboardingSample(bookId, { upload_id?, byok, include_style_previews? })
 *   client.saveArtDirection(bookId, { selected_theme_id, selected_style_id, custom_prompt_prefix? })
 *   client.uploadPdfBytes(presign, bytes)
 *   subscribeToJobEvents({ baseUrl, jobId, getAccessToken?, fetchImpl, lastEventId?, signal?,
 *                          maxReconnects?, retryDelayMs?, onEvent, onError? })
 *
 * The mocks deliberately provide `ok`, `status`, `headers` and `text()` (never a real
 * streaming body) so the client must work on plain Jest Node objects.
 */
import { ApiError, RewiatyApiClient, subscribeToJobEvents } from '@/api';
import type { JobSseEvent } from '@/api';

const BASE_URL = 'https://api.rewiaty.test';
const DEVICE_TOKEN = 'device-jwt-abc.def.ghi';
const EPHEMERAL_KEY = 'sk-ephemeral-SECRET-0123456789';

type CapturedCall = {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

type HeaderLike =
  | Headers
  | Record<string, string>
  | Array<[string, string]>
  | { forEach: (cb: (value: string, key: string) => void) => void }
  | { entries: () => Iterable<[string, string]> }
  | undefined
  | null;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to exist but it was missing`);
  }
  return value;
}

function toHeaderRecord(raw: HeaderLike): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) {
    return out;
  }
  const headerish = raw as {
    forEach?: (cb: (value: string, key: string) => void) => void;
    entries?: () => Iterable<[string, string]>;
  };
  if (typeof headerish.forEach === 'function') {
    headerish.forEach((value, key) => {
      out[String(key).toLowerCase()] = String(value);
    });
    return out;
  }
  if (typeof headerish.entries === 'function') {
    for (const [key, value] of headerish.entries()) {
      out[String(key).toLowerCase()] = String(value);
    }
    return out;
  }
  if (Array.isArray(raw)) {
    for (const pair of raw as Array<[string, string]>) {
      out[String(pair[0]).toLowerCase()] = String(pair[1]);
    }
    return out;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key.toLowerCase()] = String(value);
  }
  return out;
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  const maybeRequest = input as { url?: unknown } | null;
  if (maybeRequest && typeof maybeRequest.url === 'string') {
    return maybeRequest.url;
  }
  return String(input);
}

function pathOf(url: string): string {
  return new URL(url, BASE_URL).pathname;
}

function parseBody(body: unknown): unknown {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  if (body instanceof Uint8Array) {
    let decoded = '';
    for (const byte of Array.from(body)) {
      decoded += String.fromCharCode(byte);
    }
    return decoded;
  }
  return body;
}

function makeFetch(responses: Response[]): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const queue = [...responses];

  const spy = jest.fn(async (input: unknown, init?: unknown) => {
    const requestInit = (init ?? {}) as { method?: string; headers?: HeaderLike; body?: unknown };
    const url = requestUrl(input);
    calls.push({
      url,
      path: pathOf(url),
      method: String(requestInit.method ?? 'GET').toUpperCase(),
      headers: toHeaderRecord(requestInit.headers),
      body: requestInit.body,
    });
    const next = queue.shift();
    if (!next) {
      throw new Error(
        `Unexpected extra fetch call #${calls.length} to ${url} — the client must stop calling`,
      );
    }
    return next;
  });

  return { fetchImpl: spy as unknown as typeof fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  const serialized = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null,
    },
    text: async () => serialized,
    json: async () => JSON.parse(serialized) as unknown,
  } as unknown as Response;
}

function sseResponse(payload: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: '200',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null,
    },
    body: null,
    text: async () => payload,
    json: async () => {
      throw new Error('SSE responses are not JSON');
    },
  } as unknown as Response;
}

function sseFrame(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeClient(responses: Response[]): {
  client: RewiatyApiClient;
  calls: CapturedCall[];
} {
  const { fetchImpl, calls } = makeFetch(responses);
  const client = new RewiatyApiClient({ baseUrl: BASE_URL, fetchImpl });
  return { client, calls };
}

async function captureApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    return error as ApiError;
  }
  throw new Error('Expected the request to reject with an ApiError');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort rendering of a `console.*` argument, including plain objects and Errors. */
function stringifyConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  let json = '';
  try {
    json = JSON.stringify(arg) ?? '';
  } catch {
    json = '';
  }
  return `${String(arg)} ${json}`;
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 3000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await sleep(10);
  }
}

/**
 * Tolerant view over whatever concrete shape `JobSseEvent` has: the client may expose
 * `{ type, data }`, `{ event, data }` or flatten the payload. Accept any of them.
 */
function sseName(event: JobSseEvent): string {
  const record = event as unknown as Record<string, unknown>;
  return String(record.type ?? record.event ?? record.name ?? record.eventName ?? '');
}

function sseData(event: JobSseEvent): Record<string, unknown> {
  const record = event as unknown as Record<string, unknown>;
  const raw = record.data ?? record.payload;
  if (typeof raw === 'string') {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return record;
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const deviceAuthFixture = {
  access_token: DEVICE_TOKEN,
  token_type: 'bearer',
  expires_in: 3600,
  user_id: 'user_01',
  auth_provider: 'device',
};

const estimateFixture = {
  upload_id: 'up_01',
  book_id: 'book_01',
  page_count: 240,
  is_digital_text_clean: true,
  text_layer_quality: 'usable',
  routing_mode: 'text_only',
  estimated_ocr_pages: 0,
  estimated_image_count: 18,
  estimated_cost_usd: { text_usd: 0.42, image_usd: 0.75, total_usd: 1.17 },
  estimated_duration_sec: 420,
  warnings: [],
};

const queuedJobFixture = {
  job_id: 'job_queued_01',
  book_id: 'book_01',
  status: 'queued',
  stage: 'queued',
  ai_level: 'essential',
  progress: {
    current_page: 0,
    total_pages: 240,
    percent: 0,
    ready_chapters_count: 0,
    total_chapters_estimated: 12,
  },
  ready_chapters: [],
  budget_status: { book_cost_usd: 0, book_cap_usd: 5, mode: 'cap' },
  queue_state: {
    position: 3,
    reason: 'worker_saturated',
    display_message_ar: 'في قائمة الانتظار',
    retry_after_sec: 15,
  },
  created_at: '2026-11-27T10:00:00Z',
  updated_at: '2026-11-27T10:00:00Z',
};

const onboardingSampleFixture = {
  book_id: 'book_01',
  themes: [
    {
      theme_id: 'theme_warm',
      name_ar: 'دافئ',
      name_en: 'Warm',
      background: '#fdf6ec',
      surface: '#ffffff',
      text: '#221a12',
      accent: '#b5651d',
      rationale_ar: 'يناسب النصوص الطويلة',
    },
    {
      theme_id: 'theme_night',
      name_ar: 'ليلي',
      name_en: 'Night',
      background: '#101418',
      surface: '#18202a',
      text: '#f2f5f8',
      accent: '#7fb2e5',
      rationale_ar: 'قراءة مسائية',
    },
    {
      theme_id: 'theme_paper',
      name_ar: 'ورقي',
      name_en: 'Paper',
      background: '#ffffff',
      surface: '#f7f7f7',
      text: '#111111',
      accent: '#444444',
      rationale_ar: 'محايد',
    },
  ],
  styles: [
    {
      style_id: 'style_ink',
      name_ar: 'حبر',
      name_en: 'Ink',
      prompt_prefix: 'ink wash illustration, muted palette',
      palette: ['#1b1b1b', '#c9c2b6'],
      mood_tags: ['calm'],
    },
    {
      style_id: 'style_gouache',
      name_ar: 'جوانش',
      name_en: 'Gouache',
      prompt_prefix: 'gouache painting, soft edges',
      palette: ['#e8d7c3', '#8a5a44'],
      mood_tags: ['warm'],
    },
    {
      style_id: 'style_line',
      name_ar: 'خطوط',
      name_en: 'Line art',
      prompt_prefix: 'clean line art, single weight',
      palette: ['#000000', '#ffffff'],
      mood_tags: ['minimal'],
    },
  ],
  sample_cost_usd: 0.09,
};

const artDirectionFixture = {
  book_id: 'book_01',
  selected_theme_id: 'theme_warm',
  selected_style_id: 'style_ink',
  custom_prompt_prefix: 'muted, no faces',
  updated_at: '2026-11-27T10:05:00Z',
};

const ephemeralByok = {
  mode: 'ephemeral' as const,
  provider: 'openai',
  api_key: EPHEMERAL_KEY,
  model: 'gpt-5-mini',
};

/* ------------------------------------------------------------------ */
/* 1. device authentication + cached bearer token                      */
/* ------------------------------------------------------------------ */

describe('@/api — RewiatyApiClient', () => {
  it('authenticates a device at POST /v1/auth/device, caches the token and sends it as Bearer on later calls', async () => {
    const { client, calls } = makeClient([jsonResponse(deviceAuthFixture), jsonResponse(estimateFixture)]);

    const auth = await client.authenticateDevice({
      device_id: 'install-abc',
      platform: 'android',
      app_version: '1.4.0',
    });

    expect(auth.access_token).toBe(DEVICE_TOKEN);
    expect(auth.user_id).toBe('user_01');
    expect(auth.token_type).toBe('bearer');

    const authCall = must(calls[0], 'auth request');
    expect(authCall.method).toBe('POST');
    expect(authCall.path).toBe('/v1/auth/device');
    // The bootstrap endpoint is public: no Authorization header may be attached.
    expect(authCall.headers.authorization).toBeUndefined();
    expect(parseBody(authCall.body)).toMatchObject({
      device_id: 'install-abc',
      platform: 'android',
      app_version: '1.4.0',
    });

    await client.estimateJob({ upload_id: 'up_01', ai_level: 'essential' });

    const followUp = must(calls[1], 'estimate request');
    expect(followUp.headers.authorization).toBe(`Bearer ${DEVICE_TOKEN}`);
  });

  /* ---------------------------------------------------------------- */
  /* 2. estimate                                                      */
  /* ---------------------------------------------------------------- */

  it('POSTs /v1/jobs/estimate with the documented body and surfaces the cost breakdown', async () => {
    const { client, calls } = makeClient([jsonResponse(estimateFixture)]);

    const estimate = await client.estimateJob({
      upload_id: 'up_01',
      ai_level: 'curated',
      provider: 'openai',
      model: 'gpt-5-mini',
      options: { tashkeel_enabled: true },
    });

    const call = must(calls[0], 'estimate request');
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/v1/jobs/estimate');
    expect(parseBody(call.body)).toMatchObject({
      upload_id: 'up_01',
      ai_level: 'curated',
      provider: 'openai',
      model: 'gpt-5-mini',
      options: { tashkeel_enabled: true },
    });

    expect(estimate.book_id).toBe('book_01');
    expect(estimate.page_count).toBe(240);
    expect(estimate.routing_mode).toBe('text_only');
    expect(estimate.estimated_cost_usd.total_usd).toBeCloseTo(1.17, 5);
  });

  /* ---------------------------------------------------------------- */
  /* 3. create job — F48 queued (202) is success, not an error        */
  /* ---------------------------------------------------------------- */

  it('POSTs /v1/jobs and treats a 202 queued job as success carrying the Arabic waiting message', async () => {
    const { client, calls } = makeClient([jsonResponse(queuedJobFixture, 202)]);

    const job = await client.createJob({
      book_id: 'book_01',
      upload_id: 'up_01',
      ai_level: 'essential',
      byok: ephemeralByok,
      budget_cap_usd: 5,
      options: { priority_first_chapters: 3 },
    });

    const call = must(calls[0], 'create-job request');
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/v1/jobs');
    const body = parseBody(call.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      book_id: 'book_01',
      upload_id: 'up_01',
      ai_level: 'essential',
      budget_cap_usd: 5,
      options: { priority_first_chapters: 3 },
    });
    expect(body.byok).toMatchObject({ mode: 'ephemeral', provider: 'openai', api_key: EPHEMERAL_KEY });

    expect(job.job_id).toBe('job_queued_01');
    expect(job.status).toBe('queued');
    expect(job.queue_state?.display_message_ar).toBe('في قائمة الانتظار');
  });

  /* ---------------------------------------------------------------- */
  /* 4. F42 onboarding sample + art direction                         */
  /* ---------------------------------------------------------------- */

  it('generates the F42 onboarding sample and saves the chosen art direction on the exact paths', async () => {
    const { client, calls } = makeClient([
      jsonResponse(onboardingSampleFixture),
      jsonResponse(artDirectionFixture),
    ]);

    const sample = await client.generateOnboardingSample('book_01', {
      upload_id: 'up_01',
      byok: ephemeralByok,
      include_style_previews: true,
    });

    const sampleCall = must(calls[0], 'onboarding sample request');
    expect(sampleCall.method).toBe('POST');
    expect(sampleCall.path).toBe('/v1/books/book_01/onboarding/sample');
    expect(parseBody(sampleCall.body)).toMatchObject({ upload_id: 'up_01', include_style_previews: true });

    expect(sample.book_id).toBe('book_01');
    expect(sample.themes).toHaveLength(3);
    expect(sample.styles).toHaveLength(3);
    expect(typeof sample.sample_cost_usd).toBe('number');

    const saved = await client.saveArtDirection('book_01', {
      selected_theme_id: 'theme_warm',
      selected_style_id: 'style_ink',
      custom_prompt_prefix: 'muted, no faces',
    });

    const directionCall = must(calls[1], 'art direction request');
    expect(directionCall.method).toBe('PUT');
    expect(directionCall.path).toBe('/v1/books/book_01/art-direction');
    expect(parseBody(directionCall.body)).toMatchObject({
      selected_theme_id: 'theme_warm',
      selected_style_id: 'style_ink',
      custom_prompt_prefix: 'muted, no faces',
    });
    expect(saved.selected_style_id).toBe('style_ink');
  });

  /* ---------------------------------------------------------------- */
  /* 5. presigned PDF upload — no app bearer token leaked to S3       */
  /* ---------------------------------------------------------------- */

  it('PUTs PDF bytes straight to the presigned URL with the presign headers and never leaks the app Bearer token', async () => {
    const binaryResponse = {
      ok: true,
      status: 200,
      statusText: '200',
      headers: { get: () => null },
      text: async () => '',
      json: async () => ({}),
    } as unknown as Response;
    const { client, calls } = makeClient([jsonResponse(deviceAuthFixture), binaryResponse]);

    await client.authenticateDevice({ device_id: 'install-abc', platform: 'ios' });

    const presign = {
      upload_id: 'up_01',
      book_id: 'book_01',
      upload_url: 'https://s3.eu-central-1.amazonaws.com/rewiaty-raw/user_01/book_01/raw.pdf?X-Amz-Signature=deadbeef',
      method: 'PUT' as const,
      headers: { 'Content-Type': 'application/pdf', 'x-amz-meta-owner': 'user_01' },
      expires_at: '2026-11-27T11:00:00Z',
      raw_purge_after_hours: 24 as const,
    };
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

    await client.uploadPdfBytes(presign, bytes);

    const putCall = must(calls[1], 'presigned PUT');
    expect(putCall.method).toBe('PUT');
    expect(putCall.url).toBe(presign.upload_url);
    expect(putCall.headers['content-type']).toBe('application/pdf');
    expect(putCall.headers['x-amz-meta-owner']).toBe('user_01');
    // Critical: the device JWT belongs to our API, not to object storage.
    expect(putCall.headers.authorization).toBeUndefined();

    const uploaded = putCall.body;
    const uploadedBytes =
      uploaded instanceof Uint8Array
        ? uploaded
        : uploaded instanceof ArrayBuffer
          ? new Uint8Array(uploaded)
          : typeof uploaded === 'string'
            ? Uint8Array.from(Array.from(uploaded).map((char) => char.charCodeAt(0)))
            : null;
    expect(uploadedBytes).not.toBeNull();
    expect(Array.from(uploadedBytes as Uint8Array)).toEqual(Array.from(bytes));
  });

  /* ---------------------------------------------------------------- */
  /* 6. ApiError maps the single error envelope                       */
  /* ---------------------------------------------------------------- */

  it('maps server error envelopes to ApiError with status, code, messageAr, retryable and retryAfterSec', async () => {
    const { client } = makeClient([
      jsonResponse(
        {
          error: {
            code: 'BUDGET_EXCEEDED',
            message: 'estimate exceeds the book budget cap',
            message_ar: 'التقدير أعلى من ميزانية الكتاب',
            retryable: false,
          },
        },
        402,
      ),
      jsonResponse(
        {
          error: {
            code: 'RATE_LIMIT',
            message: 'too many requests',
            message_ar: 'جرّب تاني بعد شوية',
            retryable: true,
            retry_after_sec: 7,
          },
        },
        429,
      ),
    ]);

    const budgetError = await captureApiError(
      client.createJob({
        book_id: 'book_01',
        upload_id: 'up_01',
        ai_level: 'directors_cut',
        byok: ephemeralByok,
      }),
    );
    expect(budgetError.status).toBe(402);
    expect(budgetError.code).toBe('BUDGET_EXCEEDED');
    expect(budgetError.retryable).toBe(false);
    expect(budgetError.messageAr).toBe('التقدير أعلى من ميزانية الكتاب');

    const rateError = await captureApiError(
      client.estimateJob({ upload_id: 'up_01', ai_level: 'essential' }),
    );
    expect(rateError.status).toBe(429);
    expect(rateError.code).toBe('RATE_LIMIT');
    expect(rateError.retryable).toBe(true);
    expect(rateError.retryAfterSec).toBe(7);
  });

  /* ---------------------------------------------------------------- */
  /* 7. secret redaction in every observable error surface            */
  /* ---------------------------------------------------------------- */

  it('never leaks a raw ephemeral api_key or Authorization token into message, toString, stack or console output', async () => {
    const bearerToken = `Bearer ${DEVICE_TOKEN}`;
    const { client } = makeClient([
      jsonResponse(
        {
          error: {
            code: 'INTERNAL',
            message: `provider rejected key ${EPHEMERAL_KEY}`,
            message_ar: 'حصل خطأ من المزوّد',
            retryable: true,
            retry_after_sec: 5,
            details: {
              api_key: EPHEMERAL_KEY,
              authorization: bearerToken,
            },
          },
        },
        500,
      ),
    ]);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const apiError = await captureApiError(
        client.createJob({
          book_id: 'book_01',
          upload_id: 'up_01',
          ai_level: 'essential',
          byok: ephemeralByok,
        }),
      );

      const stack = apiError.stack ?? '';
      const observable = [apiError.message, apiError.toString(), stack].join('\n');
      expect(observable).not.toContain(EPHEMERAL_KEY);
      expect(observable).not.toContain(DEVICE_TOKEN);

      const logged = [...errorSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls]
        .map((args) => args.map(stringifyConsoleArg).join(' '))
        .join('\n');
      expect(logged).not.toContain(EPHEMERAL_KEY);
      expect(logged).not.toContain(DEVICE_TOKEN);

      // The error must still be a usable, non-secret-bearing ApiError.
      expect(apiError).toBeInstanceOf(ApiError);
      expect(apiError.status).toBe(500);
      expect(apiError.code).toBe('INTERNAL');
      expect(apiError.messageAr).toBe('حصل خطأ من المزوّد');
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 8. SSE subscriber: UTF-8 Arabic frames, Last-Event-ID, terminal/abort*/
/* ------------------------------------------------------------------ */

describe('@/api — subscribeToJobEvents', () => {
  it('streams Arabic SSE frames, resumes with Last-Event-ID and stops on job.completed or abort', async () => {
    const queuedEvent = {
      position: 2,
      reason: 'worker_saturated',
      display_message_ar: 'في قائمة الانتظار',
      retry_after_sec: 15,
    };
    const chapterEvent = {
      chapter_id: 'ch_01',
      chapter_index: 1,
      title: 'الفصل الأول',
      message_ar: 'الفصل الأول جاهز، ابدأ اقرا',
      chapter_url: '/v1/books/book_01/bundle/chapters/ch_01',
      manifest_url: '/v1/books/book_01/bundle/manifest',
      word_count: 1234,
    };
    const budgetEvent = {
      mode: 'on_demand',
      reason: 'cap_exceeded',
      spent_usd: 5.4,
      cap_usd: 5,
    };
    const completedEvent = {
      job_id: 'job_01',
      book_id: 'book_01',
      manifest_url: '/v1/books/book_01/bundle/manifest',
      book_md_url: '/v1/books/book_01/bundle/book.md',
      chapters_count: 12,
      pages_processed: 240,
    };

    const firstStream =
      sseFrame(1, 'job.queued', queuedEvent) + sseFrame(2, 'chapter.ready', chapterEvent);
    const secondStream =
      sseFrame(3, 'budget.mode_changed', budgetEvent) + sseFrame(4, 'job.completed', completedEvent);

    const { fetchImpl, calls } = makeFetch([sseResponse(firstStream), sseResponse(secondStream)]);
    const events: JobSseEvent[] = [];
    let completed = false;

    const mainHandle: unknown = subscribeToJobEvents({
      baseUrl: BASE_URL,
      jobId: 'job_01',
      fetchImpl,
      lastEventId: '0',
      retryDelayMs: 5,
      maxReconnects: 5,
      onEvent: (event) => {
        events.push(event);
        if (sseName(event) === 'job.completed') {
          completed = true;
        }
      },
    });
    const mainMaybePromise = mainHandle as { then?: unknown } | null;
    if (mainMaybePromise && typeof mainMaybePromise.then === 'function') {
      void (mainHandle as Promise<unknown>).catch(() => undefined);
    }
    await waitFor(() => completed, 'job.completed event');
    // Give any (wrong) extra reconnect a chance to fire before asserting.
    await sleep(80);

    expect(calls).toHaveLength(2);

    const firstCall = must(calls[0], 'first SSE request');
    expect(firstCall.method).toBe('GET');
    expect(firstCall.path).toBe('/v1/jobs/job_01/events');
    expect(firstCall.headers.accept).toContain('text/event-stream');
    expect(firstCall.headers['last-event-id']).toBe('0');

    const secondCall = must(calls[1], 'reconnect SSE request');
    expect(secondCall.headers.accept).toContain('text/event-stream');
    // The second stream must resume from the id of the last frame we already consumed.
    expect(secondCall.headers['last-event-id']).toBe('2');

    const names = events.map((event) => sseName(event));
    expect(names).toEqual(
      expect.arrayContaining(['job.queued', 'chapter.ready', 'budget.mode_changed', 'job.completed']),
    );

    const queuedView = events.map((event) => ({ name: sseName(event), data: sseData(event) }));
    const queuedFrame = must(
      queuedView.find((view) => view.name === 'job.queued'),
      'job.queued frame',
    );
    expect(queuedFrame.data.display_message_ar).toBe('في قائمة الانتظار');

    const chapterFrame = must(
      queuedView.find((view) => view.name === 'chapter.ready'),
      'chapter.ready frame',
    );
    expect(chapterFrame.data.message_ar).toBe('الفصل الأول جاهز، ابدأ اقرا');
    expect(chapterFrame.data.chapter_id).toBe('ch_01');

    const budgetFrame = must(
      queuedView.find((view) => view.name === 'budget.mode_changed'),
      'budget.mode_changed frame',
    );
    expect(budgetFrame.data.mode).toBe('on_demand');

    // --- AbortSignal: an aborted subscription must not reconnect. ---
    const abortFetch = makeFetch([sseResponse(sseFrame(10, 'page.progress', { current_page: 1 }))]);
    const controller = new AbortController();
    const abortedEvents: JobSseEvent[] = [];

    const handle: unknown = subscribeToJobEvents({
      baseUrl: BASE_URL,
      jobId: 'job_02',
      fetchImpl: abortFetch.fetchImpl,
      retryDelayMs: 200,
      maxReconnects: 5,
      signal: controller.signal,
      onEvent: (event) => {
        abortedEvents.push(event);
        controller.abort();
      },
    });
    const maybePromise = handle as { then?: unknown; catch?: unknown } | null;
    if (maybePromise && typeof maybePromise.then === 'function') {
      void (handle as Promise<unknown>).catch(() => undefined);
    }

    await waitFor(() => abortedEvents.length >= 1, 'first aborted-stream frame');
    await sleep(350);
    expect(controller.signal.aborted).toBe(true);
    expect(abortFetch.calls).toHaveLength(1);
  });
});
