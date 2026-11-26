import { ApiError, RewiatyApiClient } from '@/api/client';
import type {
  DeviceAuthResponse,
  JobDetail,
  PresignUploadResponse,
} from '@/api/types';

interface FakeResponseInit {
  status?: number;
  statusText?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}

/** Minimal Response stand-in: deterministic across Node and the React Native preset. */
function fakeResponse(init: FakeResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headerMap = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const rawBody = init.rawBody ?? (init.body === undefined ? '' : JSON.stringify(init.body));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? '',
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    text: async () => rawBody,
    json: async () => JSON.parse(rawBody),
  } as unknown as Response;
}

function errorResponse(
  status: number,
  error: { code: string; message: string; message_ar?: string; retryable: boolean; retry_after_sec?: number },
  headers?: Record<string, string>,
): Response {
  return fakeResponse({ status, body: { error }, headers });
}

function createClient(fetchImpl: jest.Mock, options: { baseUrl?: string } = {}) {
  return new RewiatyApiClient({
    baseUrl: options.baseUrl ?? 'https://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

function lastCall(mock: jest.Mock): { url: string; init: RequestInit } {
  const call = mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the call to reject');
}

const deviceAuth: DeviceAuthResponse = {
  access_token: 'jwt.header.payload',
  token_type: 'bearer',
  expires_in: 3600,
  user_id: 'u_1',
  auth_provider: 'device',
};

const jobDetail: JobDetail = {
  job_id: 'job_1',
  book_id: 'bk_1',
  status: 'queued',
  stage: 'queued',
  ai_level: 'essential',
  progress: {
    current_page: 0,
    total_pages: 0,
    percent: 0,
    ready_chapters_count: 0,
    total_chapters_estimated: 3,
  },
  ready_chapters: [],
  budget_status: { book_cost_usd: 0, book_cap_usd: 2, mode: 'auto' },
  queue_state: {
    position: 0,
    reason: 'worker_saturated',
    display_message_ar: 'في قائمة الانتظار',
    retry_after_sec: 30,
  },
  created_at: '2026-11-27T10:00:00Z',
  updated_at: '2026-11-27T10:00:00Z',
};

describe('RewiatyApiClient', () => {
  it('authenticates a device without a Bearer header and caches the token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ body: deviceAuth }));
    const client = createClient(fetchImpl);

    const response = await client.authenticateDevice({
      device_id: 'device-1',
      platform: 'android',
      app_version: '1.0.0',
      device_secret: 'device-secret-value',
    });

    expect(response.access_token).toBe(deviceAuth.access_token);
    const first = lastCall(fetchImpl);
    expect(first.url).toBe('https://api.test/v1/auth/device');
    expect(first.init.method).toBe('POST');
    expect((first.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(first.init.body as string)).toEqual({
      device_id: 'device-1',
      platform: 'android',
      app_version: '1.0.0',
      device_secret: 'device-secret-value',
    });

    fetchImpl.mockResolvedValueOnce(fakeResponse({ body: jobDetail }));
    await client.getJob('job_1');
    expect((lastCall(fetchImpl).init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${deviceAuth.access_token}`,
    );
  });

  it('normalises a trailing slash on the base URL and encodes path params', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ body: jobDetail }));
    const client = createClient(fetchImpl, { baseUrl: 'https://api.test/' });

    await client.getJob('job/with space');

    expect(lastCall(fetchImpl).url).toBe('https://api.test/v1/jobs/job%2Fwith%20space');
  });

  it('maps an ErrorResponse onto ApiError fields', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      errorResponse(402, {
        code: 'BUDGET_EXCEEDED',
        message: 'Book budget exceeded',
        message_ar: 'تجاوزت ميزانية الكتاب',
        retryable: false,
      }),
    );
    const client = createClient(fetchImpl);

    await expect(client.getJob('job_1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 402,
      code: 'BUDGET_EXCEEDED',
      message: 'Book budget exceeded',
      messageAr: 'تجاوزت ميزانية الكتاب',
      retryable: false,
    });
  });

  it('infers retryability from the status when the payload omits it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        status: 503,
        rawBody: '{"error":{"code":"SERVICE_UNAVAILABLE","message":"down"}}',
        headers: { 'Retry-After': '12' },
      }),
    );
    const client = createClient(fetchImpl);

    const error = await expectApiError(client.getJob('job_1'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSec).toBe(12);
  });

  it('never leaks an api_key that an upstream error echoes back', async () => {
    const apiKey = 'sk-live-SUPERSECRET-1234567890';
    const fetchImpl = jest.fn().mockResolvedValue(
      errorResponse(422, {
        code: 'INVALID_REQUEST',
        message: `provider rejected key ${apiKey} for model`,
        retryable: false,
      }),
    );
    const client = createClient(fetchImpl);

    const error = (await client
      .saveKey({ provider: 'openai', api_key: apiKey })
      .catch((e: unknown) => e as ApiError)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).not.toContain(apiKey);
    expect(error.message).toContain('[REDACTED]');
    expect(error.toString()).not.toContain(apiKey);
    expect(JSON.stringify(error)).not.toContain(apiKey);
    // The request itself still carried the real key (write-only, over the wire only).
    expect((lastCall(fetchImpl).init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(lastCall(fetchImpl).init.body as string).api_key).toBe(apiKey);
  });

  it('scrubs a short BYOK key from code, message and message_ar (no length bypass)', async () => {
    const apiKey = 'sk99';
    const fetchImpl = jest.fn().mockResolvedValue(
      errorResponse(422, {
        code: `BAD_KEY_${apiKey}`,
        message: `provider rejected key ${apiKey} for model gpt-5`,
        message_ar: `المفتاح ${apiKey} غير صالح`,
        retryable: false,
      }),
    );
    const client = createClient(fetchImpl);

    const error = await expectApiError(client.saveKey({ provider: 'openai', api_key: apiKey }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).not.toContain(apiKey);
    expect(error.message).not.toContain(apiKey);
    expect(error.messageAr).not.toContain(apiKey);
    // The whole observable surface, not just `message`.
    expect(error.toString()).not.toContain(apiKey);
    expect(JSON.stringify(error)).not.toContain(apiKey);
    expect(error.message).toContain('[REDACTED]');
    expect(error.messageAr).toContain('[REDACTED]');
    // The request still carried the real key on the wire (write-only).
    expect(JSON.parse(lastCall(fetchImpl).init.body as string).api_key).toBe(apiKey);
  });

  it('scrubs a short device_secret echoed back by the server', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse({ body: deviceAuth }))
      .mockResolvedValueOnce(
        errorResponse(400, {
          code: 'BAD_DEVICE',
          message: 'device secret dvs1 rejected',
          retryable: false,
        }),
      );
    const client = createClient(fetchImpl);

    await client.authenticateDevice({
      device_id: 'd',
      platform: 'android',
      device_secret: 'dvs1',
    });
    const error = await expectApiError(client.getJob('job_1'));

    expect(error.message).not.toContain('dvs1');
    expect(error.message).toContain('[REDACTED]');
  });

  it('never puts the device JWT in an error message', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse({ body: deviceAuth }))
      .mockResolvedValueOnce(
        errorResponse(500, {
          code: 'INTERNAL_ERROR',
          message: `upstream crashed while using ${deviceAuth.access_token}`,
          retryable: true,
        }),
      );
    const client = createClient(fetchImpl);

    await client.authenticateDevice({ device_id: 'd', platform: 'ios' });
    const error = (await client.getJob('job_1').catch((e: unknown) => e as ApiError)) as ApiError;

    expect(error.message).not.toContain(deviceAuth.access_token);
    expect(JSON.stringify(error)).not.toContain(deviceAuth.access_token);
  });

  it('presigns an upload and PUTs bytes to S3 without the app Bearer token', async () => {
    const presign: PresignUploadResponse = {
      upload_id: 'up_1',
      book_id: 'bk_1',
      upload_url: 'https://s3.test/put?sig=abc',
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      expires_at: '2026-11-27T11:00:00Z',
      raw_purge_after_hours: 24,
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(fakeResponse({ body: presign }))
      .mockResolvedValueOnce(fakeResponse({ status: 200 }));
    const client = createClient(fetchImpl);
    client.setAccessToken('secret-jwt-token');

    const result = await client.presignUpload({
      filename: 'amwaj.pdf',
      content_type: 'application/pdf',
      size_bytes: 3,
    });
    expect(result.book_id).toBe('bk_1');

    await client.uploadPdfBytes(presign, new Uint8Array([1, 2, 3]));

    const put = lastCall(fetchImpl);
    expect(put.url).toBe(presign.upload_url);
    expect(put.init.method).toBe('PUT');
    const headers = put.init.headers as Record<string, string>;
    expect(headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(headers.Authorization).toBeUndefined();
  });

  it('strips Authorization and Cookie from presign headers before PUTting to storage', async () => {
    const presign: PresignUploadResponse = {
      upload_id: 'up_1',
      book_id: 'bk_1',
      upload_url: 'https://s3.test/put?X-Amz-Signature=abc',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        Authorization: 'Bearer secret-jwt-token',
        authorization: 'Bearer secret-jwt-token',
        Cookie: 'session=abc',
        'x-amz-meta-owner': 'u_1',
      },
      expires_at: '2026-11-27T11:00:00Z',
      raw_purge_after_hours: 24,
    };
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ status: 200 }));
    const client = createClient(fetchImpl);
    client.setAccessToken('secret-jwt-token');

    await client.uploadPdfBytes(presign, new Uint8Array([1, 2, 3]));

    const headers = lastCall(fetchImpl).init.headers as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase()).sort()).toEqual([
      'content-type',
      'x-amz-meta-owner',
    ]);
    expect(headers['x-amz-meta-owner']).toBe('u_1');
  });

  it('accepts 202 from POST /v1/jobs as a queued job, not an error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ status: 202, body: jobDetail }));
    const client = createClient(fetchImpl);

    const job = await client.createJob({
      book_id: 'bk_1',
      upload_id: 'up_1',
      ai_level: 'essential',
      byok: { mode: 'saved', key_id: 'key_1' },
    });

    expect(job.status).toBe('queued');
    expect(job.queue_state?.display_message_ar).toBe('في قائمة الانتظار');
    const call = lastCall(fetchImpl);
    expect(call.url).toBe('https://api.test/v1/jobs');
    expect(JSON.parse(call.init.body as string).byok).toEqual({ mode: 'saved', key_id: 'key_1' });
  });

  it('builds listJobs query parameters and omits unset ones', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({ body: { jobs: [], next_cursor: 'c2' } }),
    );
    const client = createClient(fetchImpl);

    const page = await client.listJobs({ status: 'running', limit: 20 });
    expect(lastCall(fetchImpl).url).toBe('https://api.test/v1/jobs?status=running&limit=20');
    expect(page.next_cursor).toBe('c2');
  });

  it('returns void for 204 responses', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ status: 204 }));
    const client = createClient(fetchImpl);

    await expect(client.deleteKey('key_1')).resolves.toBeUndefined();
    expect(lastCall(fetchImpl).url).toBe('https://api.test/v1/keys/key_1');
    expect(lastCall(fetchImpl).init.method).toBe('DELETE');
  });

  it('asks for book.md as a URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({ body: { url: 'https://s3.test/book.md', expires_at: '2026-11-27T11:00:00Z' } }),
    );
    const client = createClient(fetchImpl);

    await client.getBookMdUrl('bk_1');
    expect(lastCall(fetchImpl).url).toBe('https://api.test/v1/books/bk_1/bundle/book.md?format=url');

    await client.getBookMdUrl('bk_1', { variant: 'original' });
    expect(lastCall(fetchImpl).url).toBe(
      'https://api.test/v1/books/bk_1/bundle/book.md?format=url&variant=original',
    );

    await client.getBookMdUrl('bk_1', { variant: 'current' });
    expect(lastCall(fetchImpl).url).toBe(
      'https://api.test/v1/books/bk_1/bundle/book.md?format=url&variant=current',
    );
  });

  it('uses a custom getAccessToken provider instead of a cached token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ body: jobDetail }));
    const client = new RewiatyApiClient({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAccessToken: async () => 'provider-token-abc',
    });

    await client.getJob('job_1');
    expect((lastCall(fetchImpl).init.headers as Record<string, string>).Authorization).toBe(
      'Bearer provider-token-abc',
    );
  });

  it('surfaces a network failure as a retryable ApiError', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('Network request failed'));
    const client = createClient(fetchImpl);

    const error = (await client.getJob('job_1').catch((e: unknown) => e as ApiError)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(0);
  });

  it('PUTs a partial budget and returns the stored configuration', async () => {
    const budget = {
      default_ai_level: 'curated',
      max_book_cost_usd: 3,
      max_daily_images: 40,
      on_demand_threshold_percent: 80,
    };
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ body: budget }));
    const client = createClient(fetchImpl);

    const saved = await client.updateBudget({ max_book_cost_usd: 3 });
    expect(saved.max_book_cost_usd).toBe(3);
    expect(lastCall(fetchImpl).init.method).toBe('PUT');
    expect(JSON.parse(lastCall(fetchImpl).init.body as string)).toEqual({ max_book_cost_usd: 3 });
  });
});
