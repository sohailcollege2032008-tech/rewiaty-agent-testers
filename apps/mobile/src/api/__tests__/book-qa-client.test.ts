import { ApiError, RewiatyApiClient } from '@/api/client';
import type { BookQaRequest, BookQaResponse } from '@/api/types';

/**
 * F49 — the typed client for `POST /v1/books/{book_id}/qa`.
 *
 * The two guarantees pinned here are the ones the reader relies on:
 *   1. the request goes to the documented path with the bounded body unchanged, and
 *   2. the write-only `byok.api_key` can never survive in a thrown `ApiError` — even when an
 *      upstream provider echoes it back.
 *
 * The BYOK value is a dummy fixture (`test-byok-key-fixture`), never a key-shaped string.
 */

const TEST_KEY = 'test-byok-key-fixture';

function fakeResponse(init: {
  status?: number;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
}): Response {
  const status = init.status ?? 200;
  const headerMap = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const rawBody = init.rawBody ?? (init.body === undefined ? '' : JSON.stringify(init.body));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    text: async () => rawBody,
    json: async () => JSON.parse(rawBody),
  } as unknown as Response;
}

function createClient(fetchImpl: jest.Mock): RewiatyApiClient {
  return new RewiatyApiClient({
    baseUrl: 'https://api.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

function lastCall(mock: jest.Mock): { url: string; init: RequestInit } {
  const call = mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

const REQUEST: BookQaRequest = {
  question: 'مين الشخصيات اللي ظهرت لحد دلوقتي؟',
  up_to_chapter_id: 'ch02',
  up_to_block_id: 'ch02_p0002',
  up_to_char_offset: 40,
  book_title: 'رواية الاختبار',
  context_excerpts: [
    { block_id: 'ch01_p0001', chapter_title: 'الفصل الأول', text: 'أول فقرة.' },
    { block_id: 'ch02_p0002', chapter_title: 'الفصل الثاني', text: 'النص لحد مكاني.' },
  ],
  byok: { mode: 'ephemeral', provider: 'openai', api_key: TEST_KEY, model: 'gpt-4.1' },
};

const RESPONSE: BookQaResponse = {
  book_id: 'book_1',
  answer: 'الشخصيات اللي ظهرت لحد هنا: البطل والصياد.',
  cutoff_block_id: 'ch02_p0002',
  citations: [{ block_id: 'ch01_p0001', quote: 'أول فقرة.' }],
  cost_usd: 0.0012,
  spoiler_free: true,
};

describe('RewiatyApiClient.askBookQuestion (F49)', () => {
  it('posts the bounded body to /v1/books/{id}/qa and returns the answer', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ body: RESPONSE }));
    const client = createClient(fetchImpl);

    const response = await client.askBookQuestion('book_1', REQUEST);

    expect(response).toEqual(RESPONSE);
    const { url, init } = lastCall(fetchImpl);
    expect(url).toBe('https://api.test/v1/books/book_1/qa');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it('scrubs a BYOK key echoed back by the server from every error field', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse({
        status: 422,
        body: {
          error: {
            code: `BAD_KEY_${TEST_KEY}`,
            message: `provider rejected key ${TEST_KEY}`,
            message_ar: `المفتاح ${TEST_KEY} غير صالح`,
            retryable: false,
          },
        },
      }),
    );
    const client = createClient(fetchImpl);

    let error: ApiError | null = null;
    try {
      await client.askBookQuestion('book_1', REQUEST);
    } catch (caught) {
      error = caught as ApiError;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect(error?.status).toBe(422);
    expect(error?.message ?? '').not.toContain(TEST_KEY);
    expect(error?.messageAr ?? '').not.toContain(TEST_KEY);
    expect(error?.code ?? '').not.toContain(TEST_KEY);
    expect(error?.message).toContain('[REDACTED]');
    expect(error?.toString()).not.toContain(TEST_KEY);
    expect(JSON.stringify(error)).not.toContain(TEST_KEY);
    // The key still travelled on the wire (write-only), which is the only place it may appear.
    expect(JSON.parse(lastCall(fetchImpl).init.body as string).byok.api_key).toBe(TEST_KEY);
  });
});
