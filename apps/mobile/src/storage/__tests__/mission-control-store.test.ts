import {
  ACTIVE_JOB_STATUSES,
  DEGRADED_BANNER_MESSAGE_AR,
  DEGRADED_QUEUE_MESSAGE_AR,
  JOB_KIND_LABELS_AR,
  JOB_STATUS_LABELS_AR,
  aggregateUsage,
  createInMemoryMissionControlAdapter,
  createMissionControlStore,
  formatMonthKeyAr,
  getDefaultMissionControlStore,
  getMonthKey,
  resetDefaultMissionControlStoreForTests,
  summarizeUsageByBook,
  type MissionControlAdapter,
  type MissionJob,
  type UsageEntry,
} from '@/storage/mission-control-store';
import { resetAuthenticatedApiClientsForTests } from '@/api/device-session';

// Local-time anchor so the month key never depends on the machine timezone.
const NOW = new Date(2026, 10, 26, 10, 30).getTime();
const NOV = '2026-11';
const OCT = '2026-10';

function makeJob(over: Partial<MissionJob> = {}): MissionJob {
  return {
    id: 'job_1',
    bookId: 'book_a',
    bookTitle: 'حجر الماء',
    kind: 'pdf-convert',
    status: 'running',
    progress: 0.4,
    detailAr: 'تحويل الصفحات',
    createdAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    ...over,
  };
}

function makeUsage(over: Partial<UsageEntry> = {}): UsageEntry {
  return {
    id: 'usage_1',
    bookId: 'book_a',
    bookTitle: 'حجر الماء',
    monthKey: NOV,
    channel: 'text',
    costUsd: 0.3,
    units: 3,
    createdAt: NOW - 5_000,
    ...over,
  };
}

function makeAdapter(overrides: Partial<MissionControlAdapter> = {}): MissionControlAdapter {
  return {
    fetchJobs: jest.fn(async () => []),
    pauseJob: jest.fn(async () => undefined),
    resumeJob: jest.fn(async () => undefined),
    fetchUsage: jest.fn(async () => []),
    ...overrides,
  };
}

const NOV_USAGE: UsageEntry[] = [
  makeUsage({ id: 'u1', channel: 'text', costUsd: 0.3, units: 3 }),
  makeUsage({ id: 'u2', channel: 'image', costUsd: 0.1, units: 1 }),
  makeUsage({
    id: 'u3',
    bookId: 'book_b',
    bookTitle: 'باب الحكايات',
    channel: 'image',
    costUsd: 0.25,
    units: 2,
  }),
  makeUsage({
    id: 'u4',
    monthKey: OCT,
    channel: 'text',
    costUsd: 5,
    units: 9,
    createdAt: NOW - 40 * 24 * 60 * 60 * 1000,
  }),
];

describe('mission-control-store', () => {
  it('exposes calm Arabic labels and keeps degraded jobs active', () => {
    expect(DEGRADED_QUEUE_MESSAGE_AR).toBe('في قائمة الانتظار');
    expect(DEGRADED_BANNER_MESSAGE_AR).toBe(
      'بعض المهام في قائمة الانتظار حالياً — ستُستكمل تلقائياً بدون فقدان التقدم',
    );
    expect(JOB_KIND_LABELS_AR['pdf-convert']).toBe('تحويل PDF');
    expect(JOB_KIND_LABELS_AR.tashkeel).toBe('تشكيل');
    expect(JOB_KIND_LABELS_AR.enrichment).toBe('إثراء');
    expect(JOB_KIND_LABELS_AR['image-gen']).toBe('توليد صور');
    expect(JOB_STATUS_LABELS_AR.running).toBe('جارٍ التنفيذ');
    expect(JOB_STATUS_LABELS_AR.queued).toBe('في قائمة الانتظار');
    expect(JOB_STATUS_LABELS_AR.paused).toBe('متوقف مؤقتاً');
    expect(JOB_STATUS_LABELS_AR.completed).toBe('مكتمل');
    expect(ACTIVE_JOB_STATUSES).toEqual(['running', 'queued', 'degraded']);
  });

  it('loads jobs and usage from the adapter and counts only active work', async () => {
    const jobs = [
      makeJob({ id: 'running', status: 'running' }),
      makeJob({ id: 'queued', status: 'queued', progress: 0 }),
      makeJob({ id: 'degraded', status: 'degraded', degradedReasonAr: DEGRADED_QUEUE_MESSAGE_AR }),
      makeJob({ id: 'paused', status: 'paused' }),
      makeJob({ id: 'done', status: 'completed', progress: 1 }),
    ];
    const adapter = makeAdapter({
      fetchJobs: jest.fn(async () => jobs),
      fetchUsage: jest.fn(async () => NOV_USAGE),
    });
    const store = createMissionControlStore(adapter, { now: () => NOW });

    await store.refresh();

    expect(adapter.fetchJobs).toHaveBeenCalledTimes(1);
    expect(adapter.fetchUsage).toHaveBeenCalledTimes(1);
    expect(store.getJobs()).toHaveLength(5);
    expect(store.getActiveJobCount()).toBe(3);
    expect(store.getDegradedJobs().map((job) => job.id)).toEqual(['degraded']);
    expect(store.getState().loading).toBe(false);
    expect(store.getState().lastSyncedAt).toBe(NOW);
    expect(store.getMonthlyUsage(NOV).totalCostUsd).toBeCloseTo(0.65, 10);
  });

  it('pauses running and queued jobs through the adapter and leaves other states alone', async () => {
    const adapter = makeAdapter();
    const store = createMissionControlStore(adapter, {
      now: () => NOW,
      initialJobs: [
        makeJob({ id: 'running', status: 'running' }),
        makeJob({ id: 'queued', status: 'queued' }),
        makeJob({ id: 'done', status: 'completed', progress: 1 }),
      ],
    });

    await expect(store.pauseJob('running')).resolves.toBe(true);
    await expect(store.pauseJob('queued')).resolves.toBe(true);
    await expect(store.pauseJob('done')).resolves.toBe(false);
    await expect(store.pauseJob('missing')).resolves.toBe(false);

    expect(adapter.pauseJob).toHaveBeenCalledTimes(2);
    expect(adapter.pauseJob).toHaveBeenCalledWith('running');
    expect(adapter.pauseJob).toHaveBeenCalledWith('queued');
    expect(store.getJobs().find((job) => job.id === 'running')?.status).toBe('paused');
    expect(store.getJobs().find((job) => job.id === 'queued')?.status).toBe('paused');
    expect(store.getJobs().find((job) => job.id === 'done')?.status).toBe('completed');
    expect(store.getActiveJobCount()).toBe(0);
  });

  it('resumes paused jobs to running and degraded jobs back to the queue', async () => {
    const adapter = makeAdapter();
    const store = createMissionControlStore(adapter, {
      now: () => NOW,
      initialJobs: [
        makeJob({ id: 'paused', status: 'paused' }),
        makeJob({
          id: 'degraded',
          status: 'degraded',
          degradedReasonAr: DEGRADED_QUEUE_MESSAGE_AR,
        }),
        makeJob({ id: 'running', status: 'running' }),
      ],
    });

    await expect(store.resumeJob('paused')).resolves.toBe(true);
    await expect(store.resumeJob('degraded')).resolves.toBe(true);
    await expect(store.resumeJob('running')).resolves.toBe(false);

    expect(adapter.resumeJob).toHaveBeenCalledTimes(2);
    expect(store.getJobs().find((job) => job.id === 'paused')?.status).toBe('running');
    const resumed = store.getJobs().find((job) => job.id === 'degraded');
    expect(resumed?.status).toBe('queued');
    expect(resumed?.degradedReasonAr).toBeUndefined();
  });

  it('keeps a resumed job resumed when a refresh returns the pre-resume snapshot', async () => {
    const staleJobs = [
      makeJob({
        id: 'degraded',
        status: 'degraded',
        degradedReasonAr: DEGRADED_QUEUE_MESSAGE_AR,
        updatedAt: NOW - 10_000,
      }),
      makeJob({ id: 'paused', status: 'paused', updatedAt: NOW - 10_000 }),
    ];
    const adapter = makeAdapter({
      // A backend may answer a GET right after accepting the resume with the
      // snapshot taken before the write landed.
      fetchJobs: jest.fn(async () => staleJobs.map((job) => ({ ...job }))),
    });
    const store = createMissionControlStore(adapter, {
      now: () => NOW,
      initialJobs: staleJobs,
    });

    await store.refresh();
    await expect(store.resumeJob('degraded')).resolves.toBe(true);
    await expect(store.resumeJob('paused')).resolves.toBe(true);

    await store.refresh();

    const degraded = store.getJobs().find((job) => job.id === 'degraded');
    expect(degraded?.status).toBe('queued');
    expect(degraded?.degradedReasonAr).toBeUndefined();
    expect(store.getJobs().find((job) => job.id === 'paused')?.status).toBe('running');
    expect(store.getActiveJobCount()).toBe(2);
  });

  it('maps any raw provider error into a calm degraded queue state without leaking English', () => {
    const store = createMissionControlStore(makeAdapter(), {
      now: () => NOW,
      initialJobs: [makeJob({ id: 'job_1', status: 'running', progress: 0.62 })],
    });

    expect(store.degradeJob('job_1', new Error('HTTP 429 Too Many Requests: rate limit exceeded'))).toBe(
      true,
    );

    const job = store.getJobs()[0]!;
    expect(job.status).toBe('degraded');
    expect(job.degradedReasonAr).toBe(DEGRADED_QUEUE_MESSAGE_AR);
    expect(job.progress).toBe(0.62);
    expect(JSON.stringify(store.getState())).not.toMatch(/429|rate limit|HTTP/i);
    expect(store.getActiveJobCount()).toBe(1);
  });

  it('degrades a job instead of throwing when the adapter call fails', async () => {
    const adapter = makeAdapter({
      pauseJob: jest.fn(async () => {
        throw new Error('429 Too Many Requests');
      }),
    });
    const store = createMissionControlStore(adapter, {
      now: () => NOW,
      initialJobs: [makeJob({ id: 'job_1', status: 'running' })],
    });

    await expect(store.pauseJob('job_1')).resolves.toBe(false);

    const job = store.getJobs()[0]!;
    expect(job.status).toBe('degraded');
    expect(job.degradedReasonAr).toBe(DEGRADED_QUEUE_MESSAGE_AR);
    expect(store.getDegradedJobs()).toHaveLength(1);
  });

  it('keeps the last known jobs when a refresh fails, without surfacing raw errors', async () => {
    const adapter = makeAdapter({
      fetchJobs: jest.fn(async () => {
        throw new Error('Network request failed');
      }),
      fetchUsage: jest.fn(async () => {
        throw new Error('Network request failed');
      }),
    });
    const store = createMissionControlStore(adapter, {
      now: () => NOW,
      initialJobs: [makeJob({ id: 'job_1', status: 'running' })],
      initialUsage: NOV_USAGE,
    });

    await expect(store.refresh()).resolves.toBeUndefined();

    expect(store.getJobs()).toHaveLength(1);
    expect(store.getState().loading).toBe(false);
    expect(store.getMonthlyUsage(NOV).totalCostUsd).toBeCloseTo(0.65, 10);
    expect(JSON.stringify(store.getState())).not.toMatch(/Network request failed/);
  });

  it('aggregates monthly text vs image usage accurately', () => {
    const store = createMissionControlStore(makeAdapter(), {
      now: () => NOW,
      initialUsage: NOV_USAGE,
    });

    expect(store.getMonthlyUsage(NOV)).toMatchObject({
      textCostUsd: 0.3,
      imageCostUsd: 0.35,
      textUnits: 3,
      imageUnits: 3,
    });
    expect(store.getMonthlyUsage(NOV).totalCostUsd).toBeCloseTo(0.65, 10);
    expect(store.getMonthlyUsage(OCT)).toEqual({
      textCostUsd: 5,
      imageCostUsd: 0,
      totalCostUsd: 5,
      textUnits: 9,
      imageUnits: 0,
    });
    expect(store.getMonthlyUsage('2026-09')).toEqual({
      textCostUsd: 0,
      imageCostUsd: 0,
      totalCostUsd: 0,
      textUnits: 0,
      imageUnits: 0,
    });
  });

  it('summarises usage per book for a month and across all months', () => {
    const store = createMissionControlStore(makeAdapter(), {
      now: () => NOW,
      initialUsage: NOV_USAGE,
    });

    const november = store.getBookUsageSummaries(NOV);
    expect(november).toHaveLength(2);
    expect(november[0]).toMatchObject({
      bookId: 'book_a',
      bookTitle: 'حجر الماء',
      textCostUsd: 0.3,
      imageCostUsd: 0.1,
      totalCostUsd: 0.4,
      textUnits: 3,
      imageUnits: 1,
    });
    expect(november[1]).toMatchObject({
      bookId: 'book_b',
      totalCostUsd: 0.25,
      imageCostUsd: 0.25,
      imageUnits: 2,
    });

    const allTime = store.getBookUsageSummaries();
    expect(allTime).toHaveLength(2);
    expect(allTime[0]).toMatchObject({
      bookId: 'book_a',
      textUnits: 12,
    });
    expect(allTime[0]?.textCostUsd).toBeCloseTo(5.3, 10);
    expect(allTime[0]?.totalCostUsd).toBeCloseTo(5.4, 10);
  });

  it('aggregates pure functions directly and ignores non-matching months', () => {
    expect(aggregateUsage(NOV_USAGE, NOV).totalCostUsd).toBeCloseTo(0.65, 10);
    expect(aggregateUsage(NOV_USAGE).totalCostUsd).toBeCloseTo(5.65, 10);
    expect(summarizeUsageByBook(NOV_USAGE, OCT)).toEqual([
      {
        bookId: 'book_a',
        bookTitle: 'حجر الماء',
        textCostUsd: 5,
        imageCostUsd: 0,
        totalCostUsd: 5,
        textUnits: 9,
        imageUnits: 0,
      },
    ]);
  });

  it('notifies subscribers on every change and stops after unsubscribe', async () => {
    const store = createMissionControlStore(makeAdapter(), {
      now: () => NOW,
      initialJobs: [makeJob({ id: 'job_1', status: 'running' })],
    });
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    await store.pauseJob('job_1');
    expect(listener).toHaveBeenCalled();

    const callsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    await store.resumeJob('job_1');
    expect(listener).toHaveBeenCalledTimes(callsBeforeUnsubscribe);
  });

  it('derives local month keys and Arabic month labels', () => {
    expect(getMonthKey(NOW)).toBe(NOV);
    expect(getMonthKey(new Date(2026, 0, 9).getTime())).toBe('2026-01');
    expect(formatMonthKeyAr(NOV)).toBe('نوفمبر ٢٠٢٦');
    expect(formatMonthKeyAr('bad-key')).toBe('bad-key');
  });

  it('aggregates sub-cent entries with raw sums, never rounding each entry first', () => {
    const subCent: UsageEntry[] = [0, 1, 2].map((index) =>
      makeUsage({ id: `sub_${index}`, channel: 'text', costUsd: 0.004, units: 1 }),
    );

    const breakdown = aggregateUsage(subCent, NOV);
    expect(breakdown.textCostUsd).toBeCloseTo(0.012, 10);
    expect(breakdown.totalCostUsd).toBeCloseTo(0.012, 10);
    expect(summarizeUsageByBook(subCent, NOV)[0]?.totalCostUsd).toBeCloseTo(0.012, 10);

    // Rounding halves before summing would report $0.02 for $0.01 of real spend.
    const halves: UsageEntry[] = [
      makeUsage({ id: 'half_text', channel: 'text', costUsd: 0.005, units: 1 }),
      makeUsage({ id: 'half_image', channel: 'image', costUsd: 0.005, units: 1 }),
    ];
    expect(aggregateUsage(halves, NOV).totalCostUsd).toBeCloseTo(0.01, 10);
  });

  it('ships a mockable in-memory adapter that works standalone', async () => {
    const adapter = createInMemoryMissionControlAdapter({
      jobs: [makeJob({ id: 'job_1', status: 'paused', progress: 0.2 })],
      usage: NOV_USAGE,
    });
    const store = createMissionControlStore(adapter, { now: () => NOW });

    await store.refresh();
    expect(store.getJobs()).toHaveLength(1);

    await store.resumeJob('job_1');
    expect(store.getJobs()[0]?.status).toBe('running');

    await store.pauseJob('job_1');
    expect(store.getJobs()[0]?.status).toBe('paused');
    // The in-memory adapter mirrors the same transitions so a later refresh stays consistent.
    expect((await adapter.fetchJobs())[0]?.status).toBe('paused');
    expect(await adapter.fetchUsage()).toHaveLength(NOV_USAGE.length);
  });
});

describe('getDefaultMissionControlStore backend wiring (Codex #64 P2)', () => {
  const ENV_KEY = 'EXPO_PUBLIC_API_BASE_URL';
  const originalEnv = process.env[ENV_KEY];
  const originalFetch = global.fetch;

  type JsonResponse = {
    ok: boolean;
    status: number;
    text: () => Promise<string>;
  };

  function jsonResponse(body: unknown): JsonResponse {
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  }

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
    global.fetch = originalFetch;
    resetDefaultMissionControlStoreForTests();
  });

  it('uses the live HTTP adapter when EXPO_PUBLIC_API_BASE_URL is configured', async () => {
    process.env[ENV_KEY] = 'https://api.rewiaty.test';
    resetDefaultMissionControlStoreForTests();
    // The authenticated client is cached per base URL; drop it so this store really re-auths.
    resetAuthenticatedApiClientsForTests();

    const fetchMock = jest.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/v1/auth/device')) {
        return jsonResponse({
          access_token: 'jwt_live',
          token_type: 'bearer',
          expires_in: 3600,
          user_id: 'user_live',
          auth_provider: 'device',
        });
      }
      if (url.includes('/v1/jobs')) {
        return jsonResponse({
          jobs: [
            {
              job_id: 'job_live',
              book_id: 'book_live',
              status: 'running',
              stage: 'tashkeel',
              ai_level: 'essential',
              progress: { percent: 40, current_page: 4, total_pages: 10 },
              created_at: '2026-11-26T10:00:00.000Z',
              updated_at: '2026-11-26T10:05:00.000Z',
            },
          ],
        });
      }
      return jsonResponse({
        month: NOV,
        books: [
          {
            book_id: 'book_live',
            text_cost_usd: 0.25,
            image_cost_usd: 0,
            total_cost_usd: 0.25,
            text_input_tokens: 100,
            text_output_tokens: 50,
            images_generated: 0,
          },
        ],
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const store = getDefaultMissionControlStore();

    // Live stores start empty: nothing pretends to be the reader's work before the fetch.
    expect(store.getJobs()).toHaveLength(0);
    expect(store.getState().usage).toEqual([]);

    await store.refresh();

    // Device auth first, then the two reads — every read carries the issued JWT.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.rewiaty.test/v1/auth/device');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://api.rewiaty.test/v1/jobs?limit=50');
    expect(String(fetchMock.mock.calls[2]![0])).toContain('https://api.rewiaty.test/v1/usage?month=');
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer jwt_live' }),
    );

    expect(store.getJobs().map((job) => job.id)).toEqual(['job_live']);
    expect(store.getActiveJobCount()).toBe(1);
    expect(store.getMonthlyUsage(NOV).totalCostUsd).toBeCloseTo(0.25, 10);
  });

  it('keeps the offline demo seed when no base URL is configured', () => {
    delete process.env[ENV_KEY];
    resetDefaultMissionControlStoreForTests();

    const store = getDefaultMissionControlStore();

    expect(store.getJobs().map((job) => job.id)).toContain('job_tashkeel_water');
    expect(store.getActiveJobCount()).toBe(3);
    expect(store.getMonthlyUsage(getMonthKey()).totalCostUsd).toBeGreaterThan(0);
  });

  it('shares one cached store and resetDefaultMissionControlStoreForTests drops it', () => {
    delete process.env[ENV_KEY];
    resetDefaultMissionControlStoreForTests();

    const first = getDefaultMissionControlStore();
    expect(getDefaultMissionControlStore()).toBe(first);

    resetDefaultMissionControlStoreForTests();
    expect(getDefaultMissionControlStore()).not.toBe(first);
  });

  it('honours an explicit apiBaseUrl over the build environment', async () => {
    delete process.env[ENV_KEY];
    resetDefaultMissionControlStoreForTests();
    resetAuthenticatedApiClientsForTests();

    const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ jobs: [], books: [] }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const store = getDefaultMissionControlStore({ apiBaseUrl: ' https://embedded.rewiaty.test/ ' });
    await store.refresh();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe('https://embedded.rewiaty.test/v1/auth/device');
    expect(urls).toContain('https://embedded.rewiaty.test/v1/jobs?limit=50');
    expect(urls.some((url) => url.includes('https://embedded.rewiaty.test/v1/usage?month='))).toBe(true);
  });
});

