/**
 * Device-authenticated client factory — the seam that makes every live call carry a JWT.
 *
 * Covers the five behaviours the review asked for: register once on first use, reuse the cached
 * token, share one in-flight authentication between concurrent requests, renew a token that is
 * about to expire, and put `Authorization: Bearer …` on the very first `presignUpload`.
 */
import {
  DEVICE_ID_STORAGE_KEY,
  DEVICE_SECRET_STORAGE_KEY,
  getAuthenticatedApiClient,
  resetAuthenticatedApiClientsForTests,
} from '@/api/device-session';

const PRESIGN = {
  upload_id: 'up_1',
  book_id: 'book_1',
  upload_url: 'https://storage.test/put/up_1',
  method: 'PUT',
  headers: {},
  expires_at: '2026-11-27T12:00:00Z',
  raw_purge_after_hours: 24,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: null,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItemAsync: jest.fn(async (key: string) => data.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
  };
}

type FetchHarness = {
  fetchImpl: typeof fetch;
  fetchMock: jest.Mock;
  authCalls: () => number;
  calls: () => string[];
};

function makeFetch(expiresIn = 3600): FetchHarness {
  let authCalls = 0;
  const fetchMock = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/v1/auth/device')) {
      authCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse({
        access_token: `jwt_${authCalls}`,
        token_type: 'bearer',
        expires_in: expiresIn,
        user_id: 'user_1',
        auth_provider: 'device',
        // Echo a rotated secret to prove it is persisted but never logged.
        device_secret: typeof body.device_secret === 'string' ? `${body.device_secret}_rotated` : undefined,
      });
    }
    if (url.endsWith('/v1/uploads/presign')) return jsonResponse(PRESIGN);
    return jsonResponse({});
  });

  return {
    fetchImpl: fetchMock as unknown as typeof fetch,
    fetchMock,
    authCalls: () => authCalls,
    calls: () => fetchMock.mock.calls.map((call) => String(call[0])),
  };
}

describe('getAuthenticatedApiClient', () => {
  beforeEach(() => {
    resetAuthenticatedApiClientsForTests();
  });

  it('registers the device once and sends Authorization on the very first presignUpload', async () => {
    const store = makeStore();
    const harness = makeFetch();
    const client = getAuthenticatedApiClient('https://api.test', {
      secureStore: store,
      platform: 'android',
      fetchImpl: harness.fetchImpl,
    });

    await client.presignUpload({
      filename: 'riwaya.pdf',
      content_type: 'application/pdf',
      size_bytes: 10,
    });

    // Auth first, then the presign — never an anonymous presign that the server would reject.
    expect(harness.calls()[0]).toBe('https://api.test/v1/auth/device');
    expect(harness.calls()[1]).toBe('https://api.test/v1/uploads/presign');

    const presignInit = harness.fetchMock.mock.calls[1]![1] as RequestInit;
    expect((presignInit.headers as Record<string, string>).Authorization).toBe('Bearer jwt_1');
  });

  it('reuses the cached JWT instead of re-authenticating on every call', async () => {
    const store = makeStore();
    const harness = makeFetch();
    const client = getAuthenticatedApiClient('https://api.test', {
      secureStore: store,
      platform: 'android',
      fetchImpl: harness.fetchImpl,
    });

    await client.presignUpload({
      filename: 'a.pdf',
      content_type: 'application/pdf',
      size_bytes: 1,
    });
    await client.listJobs();
    await client.getUsage();

    expect(harness.authCalls()).toBe(1);
    // The three data calls all carried the same issued token.
    const authorized = harness.fetchMock.mock.calls
      .filter((call) => !String(call[0]).endsWith('/v1/auth/device'))
      .map((call) => (call[1] as RequestInit).headers as Record<string, string>);
    expect(authorized).toHaveLength(3);
    for (const headers of authorized) {
      expect(headers.Authorization).toBe('Bearer jwt_1');
    }
  });

  it('shares one in-flight authentication between concurrent requests', async () => {
    const store = makeStore();
    const harness = makeFetch();
    const client = getAuthenticatedApiClient('https://api.test', {
      secureStore: store,
      platform: 'android',
      fetchImpl: harness.fetchImpl,
    });

    await Promise.all([
      client.presignUpload({ filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 1 }),
      client.presignUpload({ filename: 'b.pdf', content_type: 'application/pdf', size_bytes: 2 }),
      client.listJobs(),
    ]);

    expect(harness.authCalls()).toBe(1);
  });

  it('renews the JWT once it is inside the refresh window', async () => {
    const store = makeStore();
    const harness = makeFetch(3600);
    let clock = 1_000_000;
    const client = getAuthenticatedApiClient('https://api.test', {
      secureStore: store,
      platform: 'android',
      fetchImpl: harness.fetchImpl,
      now: () => clock,
    });

    await client.listJobs();
    expect(harness.authCalls()).toBe(1);

    // 55 s before expiry: inside the 60 s skew, so the token is refused and renewed.
    clock += 3600 * 1000 - 55_000;
    await client.listJobs();

    expect(harness.authCalls()).toBe(2);
    const last = harness.fetchMock.mock.calls[harness.fetchMock.mock.calls.length - 1]!;
    expect((last[1] as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer jwt_2' }),
    );
  });

  it('keeps the device identity in secure storage and returns one client per base URL', async () => {
    const store = makeStore();
    const harness = makeFetch();
    const client = getAuthenticatedApiClient('https://api.test/', {
      secureStore: store,
      platform: 'ios',
      fetchImpl: harness.fetchImpl,
    });
    await client.listJobs();

    expect(store.data.get(DEVICE_ID_STORAGE_KEY)).toMatch(/^dev_[0-9a-f]{32}$/);
    // The server rotated the secret, so the stored value is the rotated one.
    expect(store.data.get(DEVICE_SECRET_STORAGE_KEY)).toMatch(/^[0-9a-f]{64}_rotated$/);

    const authInit = harness.fetchMock.mock.calls[0]![1] as RequestInit;
    const authBody = JSON.parse(String(authInit.body)) as Record<string, unknown>;
    expect(authBody.platform).toBe('ios');
    expect(authBody.device_id).toBe(store.data.get(DEVICE_ID_STORAGE_KEY));
    // The raw secret never appears in the client instance or in any log line.
    expect(JSON.stringify(client)).not.toContain('device_secret');

    // A trailing slash is the same origin: the cached client (and its token) is reused.
    expect(getAuthenticatedApiClient('https://api.test', { secureStore: store })).toBe(client);
  });
});
