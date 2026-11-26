import {
  DEGRADED_QUEUE_MESSAGE_AR,
  getMonthKey,
  type MissionControlAdapter,
  type MissionJob,
  type MissionJobKind,
  type MissionJobStatus,
  type UsageEntry,
} from '@/storage/mission-control-store';

import type { RewiatyApiClient } from './client';
import type { JobStage, JobStatus, JobSummary, PauseReason, UsageSummaryResponse } from './types';

/**
 * F48 (live half) — the OpenAPI client behind Mission Control.
 *
 * The screen stays adapter-agnostic: this file is the only place where the wire contract
 * (`/v1/jobs`, `/v1/usage`) turns into the calm model the reader sees. Two rules are
 * non-negotiable here:
 *
 * 1. A provider / rate-limit / budget failure is never surfaced as an error. It becomes a
 *    `degraded` job carrying the single allowed Arabic sentence, and the raw English
 *    message is dropped on the floor.
 * 2. Money is passed through as the raw USD number the backend reports — no rounding,
 *    because sub-cent usage must not collapse into `$0.00` before it is aggregated.
 */

/** Reasons that mean "waiting quietly", never "broken". */
const DEGRADING_PAUSE_REASONS: ReadonlySet<PauseReason> = new Set([
  'rate_limited_429',
  'quota_exhausted',
  'budget_exceeded',
]);

/** Calm Arabic detail per wire stage. Never the provider's English text. */
const STAGE_DETAIL_AR: Record<JobStage, string> = {
  queued: 'في قائمة الانتظار',
  rendering: 'تحضير الصفحات',
  detecting: 'قراءة الملف',
  segmenting: 'تقسيم الفصول',
  ocr: 'قراءة الصور',
  qa: 'مراجعة الجودة',
  tashkeel: 'تشكيل النص',
  assembling: 'تجهيز الكتاب',
  bundling: 'تجميع الفصول',
  completed: 'تم',
};

/** Fallback title when the caller cannot resolve a book title yet. */
const FALLBACK_BOOK_TITLE_AR = 'كتاب';

/**
 * `JobSummary` carries no job kind; the stage is the only signal on the wire. Tashkeel is
 * the one stage that names its own job, everything else belongs to the conversion pipeline.
 */
function mapKind(stage: JobStage): MissionJobKind {
  return stage === 'tashkeel' ? 'tashkeel' : 'pdf-convert';
}

function mapStatus(status: JobStatus): MissionJobStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'queued':
      return 'queued';
    case 'paused':
      return 'paused';
    case 'failed':
      return 'degraded';
    case 'completed':
    case 'cancelled':
      // A cancelled job is finished work, not a live one: it must leave the badge alone.
      return 'completed';
  }
}

function toMillis(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * `JobProgress.percent` is 0..100 on the wire; `MissionJob.progress` is 0..1.
 * Anything missing or out of range is clamped instead of leaking a NaN into the bar.
 */
function progressToUnit(percent: number | undefined): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0;
  return Math.min(1, Math.max(0, percent / 100));
}

function detailAr(job: JobSummary): string {
  const base = STAGE_DETAIL_AR[job.stage] ?? 'قيد التنفيذ';
  const current = job.progress?.current_page;
  const total = job.progress?.total_pages;
  if (typeof total === 'number' && total > 0 && typeof current === 'number' && current > 0) {
    return `${base} · صفحة ${current} من ${total}`;
  }
  return base;
}

export type MissionControlAdapterOptions = {
  /** Books live in the local library; the API only returns ids. */
  resolveBookTitle?: (bookId: string) => string;
  /** `YYYY-MM`, defaults to the reader's local month. */
  monthKey?: () => string;
};

export function mapJobSummary(
  job: JobSummary,
  options: MissionControlAdapterOptions = {},
  now: number = Date.now(),
): MissionJob {
  const pausedAndWaiting =
    job.pause_reason !== undefined && DEGRADING_PAUSE_REASONS.has(job.pause_reason);
  const degraded = job.status === 'failed' || pausedAndWaiting;
  const status: MissionJobStatus = degraded ? 'degraded' : mapStatus(job.status);

  return {
    id: job.job_id,
    bookId: job.book_id,
    bookTitle: options.resolveBookTitle?.(job.book_id) ?? FALLBACK_BOOK_TITLE_AR,
    kind: mapKind(job.stage),
    status,
    progress: progressToUnit(job.progress?.percent),
    detailAr: degraded ? DEGRADED_QUEUE_MESSAGE_AR : detailAr(job),
    ...(degraded ? { degradedReasonAr: DEGRADED_QUEUE_MESSAGE_AR } : {}),
    createdAt: toMillis(job.created_at, now),
    updatedAt: toMillis(job.updated_at, now),
  };
}

/**
 * One `UsageEntry` per book per channel, so the Mission Control split (text vs image)
 * is exact. Text units are tokens in+out; image units are generated images.
 */
export function mapUsageSummary(
  summary: UsageSummaryResponse,
  fallbackMonthKey: string,
  options: MissionControlAdapterOptions = {},
  now: number = Date.now(),
): UsageEntry[] {
  const monthKey = summary.month || fallbackMonthKey;
  const monthStart = Date.parse(`${monthKey}-01T00:00:00.000Z`);
  const createdAt = Number.isFinite(monthStart) ? monthStart : now;
  const entries: UsageEntry[] = [];

  for (const book of summary.books ?? []) {
    const bookTitle = options.resolveBookTitle?.(book.book_id) ?? FALLBACK_BOOK_TITLE_AR;
    entries.push({
      id: `${book.book_id}:text`,
      bookId: book.book_id,
      bookTitle,
      monthKey,
      channel: 'text',
      // Raw, unrounded: the aggregation layer owns formatting.
      costUsd: book.text_cost_usd ?? 0,
      units: (book.text_input_tokens ?? 0) + (book.text_output_tokens ?? 0),
      createdAt,
    });
    entries.push({
      id: `${book.book_id}:image`,
      bookId: book.book_id,
      bookTitle,
      monthKey,
      channel: 'image',
      costUsd: book.image_cost_usd ?? 0,
      units: book.images_generated ?? 0,
      createdAt,
    });
  }

  return entries;
}

/**
 * The live Mission Control adapter: reads real jobs and usage, and forwards pause/resume
 * to the backend. Failures bubble up as `ApiError`, which the store already turns into a
 * calm degraded state instead of a dialog.
 */
export function createApiMissionControlAdapter(
  client: RewiatyApiClient,
  options: MissionControlAdapterOptions = {},
): MissionControlAdapter {
  return {
    async fetchJobs() {
      // One page is enough for the mission list; the contract returns the newest first.
      const response = await client.listJobs({ limit: 50 });
      const now = Date.now();
      return (response.jobs ?? []).map((job) => mapJobSummary(job, options, now));
    },
    async pauseJob(jobId: string) {
      await client.pauseJob(jobId);
    },
    async resumeJob(jobId: string) {
      await client.resumeJob(jobId);
    },
    async fetchUsage() {
      const monthKey = options.monthKey?.() ?? getMonthKey();
      const response = await client.getUsage(monthKey);
      return mapUsageSummary(response, monthKey, options);
    },
  };
}
