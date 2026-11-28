/**
 * F38 / #92 — QA seam unit coverage.
 *
 * Everything here is in-memory: no device, no Expo token, no network, no real endpoint. The
 * tests pin the three things the journey relies on:
 *
 * 1. the seam is opt-in only (`EXPO_PUBLIC_PUSH_QA_SEAM=1`);
 * 2. the registration path is the **real** function with only the OS/API edges stubbed, and it
 *    writes `token_id` to the store (the on-device proof the banner also shows);
 * 3. the QA tap link parses into a real notification payload and produces the reader route for
 *    the bundled sample book.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { listBooks } from '@/storage/database';
import { computeBookId } from '@/storage/book-id';
import { routeFromPushNotificationData } from '@/api/push-notifications';
import type { PushTokenStore } from '@/api/push-notifications';
import {
  createPushQaApiClient,
  evaluatePushQaSeamFlag,
  getPushQaStatusSnapshot,
  parsePushQaTapUrl,
  PUSH_QA_SAMPLE_BOOK_ID,
  PUSH_QA_TOKEN,
  PUSH_QA_TOKEN_ID,
  pushRouteLabel,
  registerPushQaSeamToken,
  resetPushQaStatusForTests,
  resolvePushQaBookId,
} from '@/config/push-qa-seam';

jest.mock('@/storage/database', () => ({
  listBooks: jest.fn(),
}));

const listBooksMock = listBooks as jest.MockedFunction<typeof listBooks>;

function makeStore(initial: string | null = null): PushTokenStore & {
  current: () => string | null;
} {
  let value = initial;
  return {
    getTokenId: jest.fn(async () => value),
    setTokenId: jest.fn(async (tokenId: string) => {
      value = tokenId;
    }),
    clearTokenId: jest.fn(async () => {
      value = null;
    }),
    current: () => value,
  };
}

const BUNDLED_ID = 'book_898d8c1a8ed51866';

function bookRecord(id: string, isBundled: boolean) {
  return {
    id,
    title: id === BUNDLED_ID ? 'حَجَرُ الْمَاءِ' : 'رواية المستخدم',
    author: id === BUNDLED_ID ? 'روايتي' : null,
    dir: 'rtl' as const,
    coverSeed: id,
    coverColor: null,
    progress: 0,
    lastOpenedAt: 1,
    addedAt: 1,
    isBundled,
  };
}
const TAP_URL = `rewiaty://?qa_push=1&event=chapter_ready&book_id=${PUSH_QA_SAMPLE_BOOK_ID}&job_id=qa-job-1&chapter_id=qa-ch-1&chapter_index=1`;

beforeEach(() => {
  resetPushQaStatusForTests();
  listBooksMock.mockReset();
});

describe('the seam is compile-time opt-in only', () => {
  it('is enabled only by the exact value 1', () => {
    expect(evaluatePushQaSeamFlag('1')).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1 ']) {
      expect(evaluatePushQaSeamFlag(value)).toBe(false);
    }
  });
});

describe('registerPushQaSeamToken', () => {
  it('runs the real registration with deterministic edges and stores token_id', async () => {
    const store = makeStore();

    const result = await registerPushQaSeamToken({ platform: 'android', store });

    expect(result).toEqual({
      status: 'registered',
      tokenId: PUSH_QA_TOKEN_ID,
      token: PUSH_QA_TOKEN,
    });
    expect(store.setTokenId).toHaveBeenCalledWith(PUSH_QA_TOKEN_ID);
    expect(store.current()).toBe(PUSH_QA_TOKEN_ID);
    expect(getPushQaStatusSnapshot().registration).toBe('registered');
  });

  it('uses an in-memory API client with the backend response shape (no URL, no request)', async () => {
    const client = createPushQaApiClient();
    const response = await client.registerPushToken({
      device_id: 'qa-push-seam-device',
      platform: 'android',
      provider: 'expo',
      token: PUSH_QA_TOKEN,
    });

    expect(response).toEqual({
      token_id: PUSH_QA_TOKEN_ID,
      device_id: 'qa-push-seam-device',
      platform: 'android',
      provider: 'expo',
      registered_at: '2026-01-01T00:00:00Z',
    });
    // There is no transport to call, so deleting is a safe no-op.
    await expect(client.deletePushToken(PUSH_QA_TOKEN_ID)).resolves.toBeUndefined();
  });
});

describe('parsePushQaTapUrl', () => {
  it('accepts the QA link and keeps the production payload shape', () => {
    expect(parsePushQaTapUrl(TAP_URL)).toEqual({
      event: 'chapter_ready',
      book_id: PUSH_QA_SAMPLE_BOOK_ID,
      job_id: 'qa-job-1',
      chapter_id: 'qa-ch-1',
      chapter_index: 1,
    });
  });

  it('rejects anything that is not our scheme + marker', () => {
    expect(parsePushQaTapUrl(null)).toBeNull();
    expect(parsePushQaTapUrl('')).toBeNull();
    expect(parsePushQaTapUrl('https://evil.test/?qa_push=1&event=chapter_ready')).toBeNull();
    expect(
      parsePushQaTapUrl(
        'rewiaty://?event=chapter_ready&book_id=book_sample&job_id=qa-job-1',
      ),
    ).toBeNull();
  });

  it('delegates payload validation to the production parser', () => {
    expect(
      parsePushQaTapUrl('rewiaty://?qa_push=1&event=chapter_ready&job_id=qa-job-1'),
    ).toBeNull();
    // `chapter_index` below 1 is dropped, not trusted.
    const parsed = parsePushQaTapUrl(
      'rewiaty://?qa_push=1&event=job_completed&book_id=book_sample&job_id=qa-job-2&chapter_index=0',
    );
    expect(parsed).toEqual({
      event: 'job_completed',
      book_id: PUSH_QA_SAMPLE_BOOK_ID,
      job_id: 'qa-job-2',
    });
  });
});

describe('resolvePushQaBookId', () => {
  it('maps the journey alias to the bundled sample’s real content-derived id', async () => {
    listBooksMock.mockResolvedValue([
      bookRecord('book_user_1', false),
      bookRecord(BUNDLED_ID, true),
    ]);

    await expect(resolvePushQaBookId(PUSH_QA_SAMPLE_BOOK_ID)).resolves.toBe(BUNDLED_ID);
  });

  it('passes any other book id through untouched', async () => {
    listBooksMock.mockResolvedValue([bookRecord(BUNDLED_ID, true)]);
    await expect(resolvePushQaBookId('book_user_1')).resolves.toBe('book_user_1');
    expect(listBooksMock).not.toHaveBeenCalled();
  });
});

describe('the bundled sample id pinned by the Maestro journey', () => {
  it('matches the committed sample asset', () => {
    const samplePath = path.resolve(__dirname, '../../../assets/sample-ar.md');
    const raw = readFileSync(samplePath, 'utf8');
    expect(computeBookId(raw)).toBe(BUNDLED_ID);
  });
});

describe('routing through the production function', () => {
  it('produces the reader route for the resolved bundled book', async () => {
    listBooksMock.mockResolvedValue([bookRecord(BUNDLED_ID, true)]);
    const payload = parsePushQaTapUrl(TAP_URL);
    expect(payload).not.toBeNull();

    const bookId = await resolvePushQaBookId(payload!.book_id);
    const target = routeFromPushNotificationData(
      { ...payload!, book_id: bookId },
      { bookReady: true, bookExists: true },
    );

    expect(target).toEqual({ pathname: '/reader/[id]', params: { id: BUNDLED_ID } });
    expect(pushRouteLabel(target!)).toBe(`/reader/${BUNDLED_ID}`);
  });

  it('labels non-reader targets without inventing params', () => {
    expect(pushRouteLabel({ pathname: '/mission-control' })).toBe('/mission-control');
    expect(pushRouteLabel({ pathname: '/pdf-upload' })).toBe('/pdf-upload');
  });
});
