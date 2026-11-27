import {
  createApiMissionControlAdapter,
  mapJobSummary,
  mapUsageSummary,
} from '@/api/mission-control-adapter';
import type { RewiatyApiClient } from '@/api/client';
import type { JobSummary, UsageSummaryResponse } from '@/api/types';
import { DEGRADED_QUEUE_MESSAGE_AR } from '@/storage/mission-control-store';

function jobSummary(patch: Partial<JobSummary> = {}): JobSummary {
  return {
    job_id: 'job_1',
    book_id: 'book_water',
    status: 'running',
    stage: 'tashkeel',
    ai_level: 'essential',
    progress: {
      current_page: 61,
      total_pages: 100,
      percent: 64,
      ready_chapters_count: 2,
      total_chapters_estimated: 5,
    },
    created_at: '2026-11-26T10:00:00.000Z',
    updated_at: '2026-11-26T10:05:00.000Z',
    ...patch,
  };
}

function fakeClient(overrides: Partial<Record<keyof RewiatyApiClient, jest.Mock>> = {}) {
  return {
    listJobs: jest.fn(),
    pauseJob: jest.fn(),
    resumeJob: jest.fn(),
    getUsage: jest.fn(),
    ...overrides,
  } as unknown as RewiatyApiClient & {
    listJobs: jest.Mock;
    pauseJob: jest.Mock;
    resumeJob: jest.Mock;
    getUsage: jest.Mock;
  };
}

const USAGE_RESPONSE: UsageSummaryResponse = {
  month: '2026-11',
  totals: {
    text_cost_usd: 0.4234567,
    image_cost_usd: 0.1899999,
    total_cost_usd: 0.6134566,
    text_input_tokens: 1200,
    text_output_tokens: 800,
    images_generated: 3,
  },
  daily_images: { date: '2026-11-26', used: 3, limit: 20, remaining: 17 },
  books: [
    {
      book_id: 'book_water',
      text_cost_usd: 0.4234567,
      image_cost_usd: 0.1899999,
      total_cost_usd: 0.6134566,
      text_input_tokens: 1200,
      text_output_tokens: 800,
      images_generated: 3,
      budget_cap_usd: 5,
      budget_mode: 'auto',
    },
  ],
};

describe('createApiMissionControlAdapter', () => {
  describe('fetchJobs', () => {
    it('maps the wire statuses, stage-derived kind and 0..100 percent faithfully', async () => {
      const client = fakeClient();
      client.listJobs.mockResolvedValue({
        jobs: [
          jobSummary({ job_id: 'job_running', status: 'running', stage: 'tashkeel' }),
          jobSummary({ job_id: 'job_queued', status: 'queued', stage: 'queued' }),
          jobSummary({ job_id: 'job_paused', status: 'paused', stage: 'ocr', pause_reason: 'user_paused' }),
          jobSummary({ job_id: 'job_done', status: 'completed', stage: 'completed' }),
        ],
      });

      const adapter = createApiMissionControlAdapter(client, {
        resolveBookTitle: (bookId) => (bookId === 'book_water' ? 'حجر الماء' : 'كتاب'),
      });
      const jobs = await adapter.fetchJobs();

      expect(client.listJobs).toHaveBeenCalledWith({ limit: 50 });
      expect(jobs.map((job) => [job.id, job.status, job.kind])).toEqual([
        ['job_running', 'running', 'tashkeel'],
        ['job_queued', 'queued', 'pdf-convert'],
        ['job_paused', 'paused', 'pdf-convert'],
        ['job_done', 'completed', 'pdf-convert'],
      ]);

      const running = jobs[0]!;
      expect(running.bookTitle).toBe('حجر الماء');
      expect(running.progress).toBeCloseTo(0.64, 5);
      expect(running.detailAr).toContain('صفحة 61 من 100');
      expect(running.createdAt).toBe(Date.parse('2026-11-26T10:00:00.000Z'));
      expect(running.updatedAt).toBe(Date.parse('2026-11-26T10:05:00.000Z'));
      expect(running.degradedReasonAr).toBeUndefined();
    });

    it('follows next_cursor so older active jobs past page 1 are not lost', async () => {
      const client = fakeClient();
      client.listJobs
        .mockResolvedValueOnce({
          jobs: [
            jobSummary({ job_id: 'job_new_running', status: 'running', stage: 'tashkeel' }),
            jobSummary({ job_id: 'job_done_page1', status: 'completed', stage: 'completed' }),
          ],
          next_cursor: 'cursor_2',
        })
        .mockResolvedValueOnce({
          jobs: [
            // Older active work that used to disappear from the screen and the badge.
            jobSummary({ job_id: 'job_older_running', status: 'running', stage: 'ocr' }),
          ],
        });

      const adapter = createApiMissionControlAdapter(client);
      const jobs = await adapter.fetchJobs();

      expect(client.listJobs).toHaveBeenCalledTimes(2);
      expect(client.listJobs).toHaveBeenNthCalledWith(1, { limit: 50 });
      expect(client.listJobs).toHaveBeenNthCalledWith(2, { limit: 50, cursor: 'cursor_2' });
      expect(jobs.map((job) => job.id)).toEqual([
        'job_new_running',
        'job_done_page1',
        'job_older_running',
      ]);
      expect(jobs.find((job) => job.id === 'job_older_running')?.status).toBe('running');
    });

    it('drops duplicate job_ids across pages and stops on a repeated cursor', async () => {
      const client = fakeClient();
      client.listJobs
        .mockResolvedValueOnce({
          jobs: [jobSummary({ job_id: 'job_1' })],
          next_cursor: 'cursor_2',
        })
        .mockResolvedValueOnce({
          jobs: [jobSummary({ job_id: 'job_1' }), jobSummary({ job_id: 'job_2' })],
          // A misbehaving server handing back the same cursor must not loop forever.
          next_cursor: 'cursor_2',
        })
        .mockResolvedValueOnce({
          jobs: [jobSummary({ job_id: 'job_3' })],
        });

      const adapter = createApiMissionControlAdapter(client);
      const jobs = await adapter.fetchJobs();

      expect(client.listJobs).toHaveBeenCalledTimes(2);
      expect(jobs.map((job) => job.id)).toEqual(['job_1', 'job_2']);
    });

    it('degrades a failed job calmly, with the one allowed Arabic sentence and no raw error', () => {
      const failed = {
        ...jobSummary({ status: 'failed', stage: 'ocr' }),
        // Even if a provider message ever leaks into a field, the mapper never reads it.
        error: { code: 'provider_500', message: 'Upstream provider exploded', retryable: true },
      };
      const mapped = mapJobSummary(failed as JobSummary);

      expect(mapped.status).toBe('degraded');
      expect(mapped.degradedReasonAr).toBe(DEGRADED_QUEUE_MESSAGE_AR);
      expect(mapped.detailAr).toBe(DEGRADED_QUEUE_MESSAGE_AR);
      expect(JSON.stringify(mapped)).not.toContain('exploded');
      expect(JSON.stringify(mapped)).not.toContain('provider_500');
    });

    it.each(['rate_limited_429', 'quota_exhausted', 'budget_exceeded'] as const)(
      'degrades a paused job whose pause_reason is %s',
      (pauseReason) => {
        const mapped = mapJobSummary(
          jobSummary({ status: 'paused', stage: 'tashkeel', pause_reason: pauseReason }),
        );

        expect(mapped.status).toBe('degraded');
        expect(mapped.degradedReasonAr).toBe(DEGRADED_QUEUE_MESSAGE_AR);
        expect(mapped.progress).toBeCloseTo(0.64, 5);
      },
    );

    it('keeps a user-paused job paused without a degraded reason', () => {
      const mapped = mapJobSummary(
        jobSummary({ status: 'paused', stage: 'ocr', pause_reason: 'user_paused' }),
      );

      expect(mapped.status).toBe('paused');
      expect(mapped.degradedReasonAr).toBeUndefined();
    });

    it('clamps a missing or out-of-range percent instead of producing NaN', () => {
      const missing = mapJobSummary(
        jobSummary({ progress: { current_page: 0, total_pages: 0, percent: Number.NaN, ready_chapters_count: 0, total_chapters_estimated: 0 } }),
      );
      const over = mapJobSummary(jobSummary({ progress: { ...jobSummary().progress, percent: 187 } }));

      expect(missing.progress).toBe(0);
      expect(over.progress).toBe(1);
    });
  });

  it('forwards pause and resume to the backend', async () => {
    const client = fakeClient();
    client.pauseJob.mockResolvedValue({});
    client.resumeJob.mockResolvedValue({});
    const adapter = createApiMissionControlAdapter(client);

    await adapter.pauseJob('job_1');
    await adapter.resumeJob('job_1');

    expect(client.pauseJob).toHaveBeenCalledWith('job_1');
    expect(client.resumeJob).toHaveBeenCalledWith('job_1');
  });

  describe('fetchUsage', () => {
    it('maps both channels per book with raw unrounded USD costs', async () => {
      const client = fakeClient();
      client.getUsage.mockResolvedValue(USAGE_RESPONSE);
      const adapter = createApiMissionControlAdapter(client, {
        monthKey: () => '2026-11',
        resolveBookTitle: () => 'حجر الماء',
      });

      const usage = await adapter.fetchUsage();

      expect(client.getUsage).toHaveBeenCalledWith('2026-11');
      expect(usage).toHaveLength(2);

      const text = usage.find((entry) => entry.channel === 'text')!;
      const image = usage.find((entry) => entry.channel === 'image')!;

      expect(text).toEqual(
        expect.objectContaining({
          bookId: 'book_water',
          bookTitle: 'حجر الماء',
          monthKey: '2026-11',
          channel: 'text',
          // 0.4234567 must survive untouched, not become 0.42.
          costUsd: 0.4234567,
          units: 2000,
        }),
      );
      expect(image).toEqual(
        expect.objectContaining({
          channel: 'image',
          costUsd: 0.1899999,
          units: 3,
        }),
      );
    });

    it('falls back to the requested month when the response omits one', () => {
      const entries = mapUsageSummary({ ...USAGE_RESPONSE, month: '' }, '2026-10');

      expect(entries.every((entry) => entry.monthKey === '2026-10')).toBe(true);
      expect(entries[0]!.createdAt).toBe(Date.parse('2026-10-01T00:00:00.000Z'));
    });

    it('emits zero-cost channel rows for a book with no spend, without inventing money', () => {
      const entries = mapUsageSummary(
        {
          ...USAGE_RESPONSE,
          books: [
            {
              book_id: 'book_free',
              text_cost_usd: 0,
              image_cost_usd: 0,
              total_cost_usd: 0,
              text_input_tokens: 0,
              text_output_tokens: 0,
              images_generated: 0,
              budget_cap_usd: 5,
              budget_mode: 'auto',
            },
          ],
        },
        '2026-11',
      );

      expect(entries.map((entry) => [entry.channel, entry.costUsd])).toEqual([
        ['text', 0],
        ['image', 0],
      ]);
    });
  });
});
