import { useMemo, useSyncExternalStore } from 'react';

import { ARABIC_MONTHS, toArabicDigits } from './reading-stats';

/**
 * F48 — Mission Control.
 *
 * The screen is intentionally backend-agnostic: everything goes through
 * `MissionControlAdapter`, so today it runs on a calm in-memory store (offline /
 * standalone) and later L1's OpenAPI client can be plugged in without touching UI.
 */

export type MissionJobKind = 'pdf-convert' | 'tashkeel' | 'enrichment' | 'image-gen';

export type MissionJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'degraded';

export type MissionJob = {
  id: string;
  bookId: string;
  bookTitle: string;
  kind: MissionJobKind;
  status: MissionJobStatus;
  /** 0..1 */
  progress: number;
  detailAr: string;
  degradedReasonAr?: string;
  createdAt: number;
  updatedAt: number;
};

export type UsageChannel = 'text' | 'image';

export type UsageEntry = {
  id: string;
  bookId: string;
  bookTitle: string;
  /** `YYYY-MM` */
  monthKey: string;
  channel: UsageChannel;
  costUsd: number;
  units: number;
  createdAt: number;
};

export type UsageBreakdown = {
  textCostUsd: number;
  imageCostUsd: number;
  totalCostUsd: number;
  textUnits: number;
  imageUnits: number;
};

export type BookUsageSummary = UsageBreakdown & {
  bookId: string;
  bookTitle: string;
};

export interface MissionControlAdapter {
  fetchJobs(): Promise<MissionJob[]>;
  pauseJob(jobId: string): Promise<void>;
  resumeJob(jobId: string): Promise<void>;
  fetchUsage(): Promise<UsageEntry[]>;
}

/** The only wording a degraded job is ever allowed to show. */
export const DEGRADED_QUEUE_MESSAGE_AR = 'في قائمة الانتظار';

export const DEGRADED_BANNER_MESSAGE_AR =
  'بعض المهام في قائمة الانتظار حالياً — ستُستكمل تلقائياً بدون فقدان التقدم';

export const JOB_KIND_LABELS_AR: Record<MissionJobKind, string> = {
  'pdf-convert': 'تحويل PDF',
  tashkeel: 'تشكيل',
  enrichment: 'إثراء',
  'image-gen': 'توليد صور',
};

export const JOB_STATUS_LABELS_AR: Record<MissionJobStatus, string> = {
  queued: 'في قائمة الانتظار',
  running: 'جارٍ التنفيذ',
  paused: 'متوقف مؤقتاً',
  completed: 'مكتمل',
  degraded: DEGRADED_QUEUE_MESSAGE_AR,
};

/** Running, queued and degraded work all keep the pulsing badge alive. */
export const ACTIVE_JOB_STATUSES = ['running', 'queued', 'degraded'] as const;

const ACTIVE_JOB_STATUS_SET: ReadonlySet<MissionJobStatus> = new Set(ACTIVE_JOB_STATUSES);

export function isActiveJob(job: MissionJob): boolean {
  return ACTIVE_JOB_STATUS_SET.has(job.status);
}

const JOB_DISPLAY_ORDER: Record<MissionJobStatus, number> = {
  running: 0,
  degraded: 1,
  queued: 2,
  paused: 3,
  completed: 4,
};

export function emptyUsageBreakdown(): UsageBreakdown {
  return {
    textCostUsd: 0,
    imageCostUsd: 0,
    totalCostUsd: 0,
    textUnits: 0,
    imageUnits: 0,
  };
}

/** Aggregates text vs image spend for one month (or every month when omitted). */
export function aggregateUsage(entries: readonly UsageEntry[], monthKey?: string): UsageBreakdown {
  let textCostUsd = 0;
  let imageCostUsd = 0;
  let textUnits = 0;
  let imageUnits = 0;

  for (const entry of entries) {
    if (monthKey && entry.monthKey !== monthKey) continue;
    if (entry.channel === 'image') {
      imageCostUsd += entry.costUsd;
      imageUnits += entry.units;
    } else {
      textCostUsd += entry.costUsd;
      textUnits += entry.units;
    }
  }

  // Raw sums only: rounding here would lose sub-cent entries and make the
  // total disagree with its own parts. Formatting is the display layer's job.
  return {
    textCostUsd,
    imageCostUsd,
    totalCostUsd: textCostUsd + imageCostUsd,
    textUnits,
    imageUnits,
  };
}

/** Per-book ledger, highest spend first. */
export function summarizeUsageByBook(
  entries: readonly UsageEntry[],
  monthKey?: string,
): BookUsageSummary[] {
  const byBook = new Map<string, { bookTitle: string; entries: UsageEntry[] }>();

  for (const entry of entries) {
    if (monthKey && entry.monthKey !== monthKey) continue;
    const bucket = byBook.get(entry.bookId);
    if (bucket) {
      bucket.entries.push(entry);
    } else {
      byBook.set(entry.bookId, { bookTitle: entry.bookTitle, entries: [entry] });
    }
  }

  const summaries: BookUsageSummary[] = [];
  for (const [bookId, bucket] of byBook) {
    summaries.push({
      bookId,
      bookTitle: bucket.bookTitle,
      ...aggregateUsage(bucket.entries),
    });
  }

  summaries.sort((a, b) => {
    if (b.totalCostUsd !== a.totalCostUsd) return b.totalCostUsd - a.totalCostUsd;
    return a.bookTitle.localeCompare(b.bookTitle, 'ar');
  });

  return summaries;
}

/** Local-time `YYYY-MM` key — never UTC, so the month flips with the reader's clock. */
export function getMonthKey(timestamp: number = Date.now()): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

export function formatMonthKeyAr(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const monthName = ARABIC_MONTHS[monthIndex];
  if (!monthName) return monthKey;
  return `${monthName} ${toArabicDigits(year)}`;
}

export type MissionControlState = {
  jobs: MissionJob[];
  usage: UsageEntry[];
  loading: boolean;
  lastSyncedAt: number | null;
};

export type MissionControlStoreOptions = {
  initialJobs?: MissionJob[];
  initialUsage?: UsageEntry[];
  now?: () => number;
};

export type MissionControlStore = {
  subscribe: (listener: () => void) => () => void;
  getState: () => MissionControlState;
  getJobs: () => MissionJob[];
  getActiveJobCount: () => number;
  getDegradedJobs: () => MissionJob[];
  getMonthlyUsage: (monthKey: string) => UsageBreakdown;
  getBookUsageSummaries: (monthKey?: string) => BookUsageSummary[];
  refresh: () => Promise<void>;
  pauseJob: (jobId: string) => Promise<boolean>;
  resumeJob: (jobId: string) => Promise<boolean>;
  /** Local, synchronous transition used whenever a provider/rate-limit failure happens. */
  degradeJob: (jobId: string, rawError?: unknown) => boolean;
};

function sortJobs(jobs: readonly MissionJob[]): MissionJob[] {
  return [...jobs].sort((a, b) => {
    const rank = JOB_DISPLAY_ORDER[a.status] - JOB_DISPLAY_ORDER[b.status];
    if (rank !== 0) return rank;
    return b.updatedAt - a.updatedAt;
  });
}

export function createMissionControlStore(
  adapter: MissionControlAdapter,
  options: MissionControlStoreOptions = {},
): MissionControlStore {
  const now = options.now ?? Date.now;
  let state: MissionControlState = {
    jobs: sortJobs(options.initialJobs ?? []),
    usage: [...(options.initialUsage ?? [])],
    loading: false,
    lastSyncedAt: null,
  };
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const setState = (patch: Partial<MissionControlState>) => {
    state = { ...state, ...patch };
    emit();
  };

  const findJob = (jobId: string): MissionJob | undefined =>
    state.jobs.find((job) => job.id === jobId);

  const updateJob = (jobId: string, updater: (job: MissionJob) => MissionJob): boolean => {
    let changed = false;
    const jobs = state.jobs.map((job) => {
      if (job.id !== jobId) return job;
      const next = updater(job);
      if (next === job) return job;
      changed = true;
      return next;
    });
    if (!changed) return false;
    setState({ jobs: sortJobs(jobs) });
    return true;
  };

  type LocalJobState = {
    status: MissionJobStatus;
    degradedReasonAr?: string;
    updatedAt: number;
  };

  /**
   * Pause/resume/degrade decisions are authoritative until the backend reports
   * something newer. Without this, a refresh that answers with the snapshot
   * taken just before the write would flip a resumed job back to degraded.
   */
  const localJobStates = new Map<string, LocalJobState>();

  const applyLocalJobState = (jobId: string, patch: LocalJobState): boolean => {
    const changed = updateJob(jobId, (current) => ({ ...current, ...patch }));
    if (changed) localJobStates.set(jobId, patch);
    return changed;
  };

  /** Reconciles a fetched snapshot with local decisions the backend has not echoed yet. */
  const mergeFetchedJobs = (fetched: readonly MissionJob[]): MissionJob[] => {
    const fetchedIds = new Set(fetched.map((job) => job.id));
    for (const jobId of [...localJobStates.keys()]) {
      if (!fetchedIds.has(jobId)) localJobStates.delete(jobId);
    }

    return fetched.map((job) => {
      const local = localJobStates.get(job.id);
      if (!local) return job;
      const backendEchoed =
        job.status === local.status && job.degradedReasonAr === local.degradedReasonAr;
      if (backendEchoed || job.updatedAt > local.updatedAt) {
        localJobStates.delete(job.id);
        return job;
      }
      return { ...job, ...local };
    });
  };

  /**
   * A failure is never an error dialog: the job keeps its progress and waits in
   * the queue with calm Arabic wording. `rawError` is deliberately discarded.
   */
  const degradeJob = (jobId: string, rawError?: unknown): boolean => {
    void rawError; // Provider/English errors must never reach the UI.
    const job = findJob(jobId);
    if (!job || job.status === 'completed') return false;
    return applyLocalJobState(jobId, {
      status: 'degraded',
      degradedReasonAr: DEGRADED_QUEUE_MESSAGE_AR,
      updatedAt: now(),
    });
  };

  const pauseJob = async (jobId: string): Promise<boolean> => {
    const job = findJob(jobId);
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return false;

    // Optimistic: the pill flips instantly, even before the adapter answers.
    applyLocalJobState(jobId, {
      status: 'paused',
      degradedReasonAr: undefined,
      updatedAt: now(),
    });

    try {
      await adapter.pauseJob(jobId);
      return true;
    } catch (error) {
      degradeJob(jobId, error);
      return false;
    }
  };

  const resumeJob = async (jobId: string): Promise<boolean> => {
    const job = findJob(jobId);
    if (!job || (job.status !== 'paused' && job.status !== 'degraded')) return false;

    const nextStatus: MissionJobStatus = job.status === 'degraded' ? 'queued' : 'running';
    applyLocalJobState(jobId, {
      status: nextStatus,
      degradedReasonAr: undefined,
      updatedAt: now(),
    });

    try {
      await adapter.resumeJob(jobId);
      return true;
    } catch (error) {
      degradeJob(jobId, error);
      return false;
    }
  };

  const refresh = async (): Promise<void> => {
    setState({ loading: true });
    try {
      const [jobs, usage] = await Promise.all([adapter.fetchJobs(), adapter.fetchUsage()]);
      setState({
        jobs: sortJobs(mergeFetchedJobs(jobs)),
        usage: [...usage],
        loading: false,
        lastSyncedAt: now(),
      });
    } catch {
      // Offline / backend down: keep whatever the reader already sees.
      setState({ loading: false });
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    getJobs: () => state.jobs,
    getActiveJobCount: () => state.jobs.filter(isActiveJob).length,
    getDegradedJobs: () => state.jobs.filter((job) => job.status === 'degraded'),
    getMonthlyUsage: (monthKey) => aggregateUsage(state.usage, monthKey),
    getBookUsageSummaries: (monthKey) => summarizeUsageByBook(state.usage, monthKey),
    refresh,
    pauseJob,
    resumeJob,
    degradeJob,
  };
}

export type InMemoryMissionControlSeed = {
  jobs?: MissionJob[];
  usage?: UsageEntry[];
};

/**
 * Deterministic offline adapter. It mirrors the same state machine the future
 * HTTP adapter will expose, so the screen behaves identically in tests/demo.
 */
export function createInMemoryMissionControlAdapter(
  seed: InMemoryMissionControlSeed = {},
): MissionControlAdapter {
  const jobs: MissionJob[] = (seed.jobs ?? []).map((job) => ({ ...job }));
  const usage: UsageEntry[] = (seed.usage ?? []).map((entry) => ({ ...entry }));

  return {
    async fetchJobs() {
      return jobs.map((job) => ({ ...job }));
    },
    async pauseJob(jobId) {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (job && (job.status === 'running' || job.status === 'queued')) {
        job.status = 'paused';
        job.degradedReasonAr = undefined;
      }
    },
    async resumeJob(jobId) {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (job && (job.status === 'paused' || job.status === 'degraded')) {
        job.status = job.status === 'degraded' ? 'queued' : 'running';
        job.degradedReasonAr = undefined;
      }
    },
    async fetchUsage() {
      return usage.map((entry) => ({ ...entry }));
    },
  };
}

function previousMonthKey(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return monthKey;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month <= 1) return `${year - 1}-12`;
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Demo content so Mission Control is meaningful offline before the backend lands. */
export function createDemoMissionControlSeed(timestamp: number = Date.now()): Required<InMemoryMissionControlSeed> {
  const monthKey = getMonthKey(timestamp);
  const lastMonthKey = previousMonthKey(monthKey);
  const createdAt = timestamp - 3 * 60 * 60 * 1000;

  const jobs: MissionJob[] = [
    {
      id: 'job_tashkeel_water',
      bookId: 'book_water',
      bookTitle: 'حجر الماء',
      kind: 'tashkeel',
      status: 'running',
      progress: 0.64,
      detailAr: 'تشكيل الفصل الثالث',
      createdAt,
      updatedAt: timestamp - 20_000,
    },
    {
      id: 'job_enrichment_tales',
      bookId: 'book_tales',
      bookTitle: 'باب الحكايات',
      kind: 'enrichment',
      status: 'queued',
      progress: 0,
      detailAr: 'استخراج الشخصيات والمراحل',
      createdAt,
      updatedAt: timestamp - 5 * 60_000,
    },
    {
      id: 'job_images_summer',
      bookId: 'book_summer',
      bookTitle: 'صيف في الإسكندرية',
      kind: 'image-gen',
      status: 'degraded',
      progress: 0.35,
      detailAr: 'توليد صورة المشهد الأول',
      degradedReasonAr: DEGRADED_QUEUE_MESSAGE_AR,
      createdAt,
      updatedAt: timestamp - 9 * 60_000,
    },
    {
      id: 'job_pdf_water',
      bookId: 'book_water',
      bookTitle: 'حجر الماء',
      kind: 'pdf-convert',
      status: 'completed',
      progress: 1,
      detailAr: 'تحويل 214 صفحة',
      createdAt: createdAt - 24 * 60 * 60 * 1000,
      updatedAt: timestamp - 22 * 60 * 60 * 1000,
    },
  ];

  const usage: UsageEntry[] = [
    {
      id: 'usage_tashkeel_1',
      bookId: 'book_water',
      bookTitle: 'حجر الماء',
      monthKey,
      channel: 'text',
      costUsd: 0.42,
      units: 12,
      createdAt: timestamp - 60 * 60 * 1000,
    },
    {
      id: 'usage_images_1',
      bookId: 'book_summer',
      bookTitle: 'صيف في الإسكندرية',
      monthKey,
      channel: 'image',
      costUsd: 0.28,
      units: 2,
      createdAt: timestamp - 2 * 60 * 60 * 1000,
    },
    {
      id: 'usage_enrichment_1',
      bookId: 'book_tales',
      bookTitle: 'باب الحكايات',
      monthKey,
      channel: 'text',
      costUsd: 0.17,
      units: 5,
      createdAt: timestamp - 4 * 60 * 60 * 1000,
    },
    {
      id: 'usage_prev_month_1',
      bookId: 'book_water',
      bookTitle: 'حجر الماء',
      monthKey: lastMonthKey,
      channel: 'text',
      costUsd: 0.9,
      units: 21,
      createdAt: timestamp - 32 * 24 * 60 * 60 * 1000,
    },
  ];

  return { jobs, usage };
}

export type DefaultMissionControlStoreOptions = {
  /**
   * Explicit backend base URL. Defaults to the build-time `EXPO_PUBLIC_API_BASE_URL`;
   * tests and embedded builds pass it directly instead of depending on the environment.
   */
  apiBaseUrl?: string | null;
};

/** Trimmed public API base URL, or `null` when the app should stay on the offline demo. */
function normalizeApiBaseUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Why static member access: Expo replaces `process.env.EXPO_PUBLIC_*` at build time, so the
 * live backend URL has to be written literally here to reach the release bundle.
 */
function readConfiguredApiBaseUrl(): string | null {
  return normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
}

let defaultStore: { key: string | null; store: MissionControlStore } | null = null;

function createOfflineMissionControlStore(): MissionControlStore {
  const seed = createDemoMissionControlSeed();
  return createMissionControlStore(createInMemoryMissionControlAdapter(seed), {
    initialJobs: seed.jobs,
    initialUsage: seed.usage,
  });
}

/**
 * The live store starts empty and is filled by `refresh()` — the screens call it when they
 * are focused, so a reader never sees demo books they do not own while the first fetch runs.
 */
function createLiveMissionControlStore(apiBaseUrl: string): MissionControlStore {
  // Why `require`: `mission-control-adapter` imports this module's labels and types, so a
  // static import here would be a module-init cycle. Both packages are loaded on demand,
  // after this module has finished defining what the adapter reads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createApiMissionControlAdapter } =
    require('../api/mission-control-adapter') as typeof import('../api/mission-control-adapter');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RewiatyApiClient } =
    require('../api/client') as typeof import('../api/client');

  return createMissionControlStore(
    createApiMissionControlAdapter(new RewiatyApiClient({ baseUrl: apiBaseUrl })),
  );
}

/**
 * One shared store for the badge and the Mission Control screen.
 *
 * With `EXPO_PUBLIC_API_BASE_URL` configured it talks to the real backend; without it the
 * deterministic demo seed stays, which keeps offline and Maestro builds functional.
 */
export function getDefaultMissionControlStore(
  options: DefaultMissionControlStoreOptions = {},
): MissionControlStore {
  const apiBaseUrl =
    options.apiBaseUrl !== undefined
      ? normalizeApiBaseUrl(options.apiBaseUrl)
      : readConfiguredApiBaseUrl();

  if (defaultStore && defaultStore.key === apiBaseUrl) {
    return defaultStore.store;
  }

  const store = apiBaseUrl
    ? createLiveMissionControlStore(apiBaseUrl)
    : createOfflineMissionControlStore();
  defaultStore = { key: apiBaseUrl, store };
  return store;
}

/** Drops the cached shared store so tests can configure the environment cleanly. */
export function resetDefaultMissionControlStoreForTests(): void {
  defaultStore = null;
}

export type MissionControlSnapshot = MissionControlState & {
  monthKey: string;
  activeCount: number;
  activeJobs: MissionJob[];
  /** Everything still worth showing on Mission Control: paused work stays resumable. */
  visibleJobs: MissionJob[];
  degradedJobs: MissionJob[];
  monthlyUsage: UsageBreakdown;
  bookSummaries: BookUsageSummary[];
};

export type MissionControlController = MissionControlSnapshot & {
  refresh: () => Promise<void>;
  pauseJob: (jobId: string) => Promise<boolean>;
  resumeJob: (jobId: string) => Promise<boolean>;
  degradeJob: (jobId: string, rawError?: unknown) => boolean;
};

/**
 * Reactive view over a store. Components re-render on every pause/resume/degrade
 * and on refresh, which is what keeps the pulsing badge honest.
 */
export function useMissionControl(
  store: MissionControlStore = getDefaultMissionControlStore(),
  options: { monthKey?: string } = {},
): MissionControlController {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const monthKey = options.monthKey ?? getMonthKey();

  return useMemo(() => {
    const activeJobs = state.jobs.filter(isActiveJob);
    return {
      ...state,
      monthKey,
      activeCount: activeJobs.length,
      activeJobs,
      visibleJobs: state.jobs.filter((job) => job.status !== 'completed'),
      degradedJobs: state.jobs.filter((job) => job.status === 'degraded'),
      monthlyUsage: aggregateUsage(state.usage, monthKey),
      bookSummaries: summarizeUsageByBook(state.usage, monthKey),
      refresh: store.refresh,
      pauseJob: store.pauseJob,
      resumeJob: store.resumeJob,
      degradeJob: store.degradeJob,
    };
  }, [state, monthKey, store]);
}
