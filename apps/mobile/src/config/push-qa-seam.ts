/**
 * F38 / #92 — compile-time QA seam for the notification release journey.
 *
 * Why this file exists: the release APK that the testers CI builds is **offline** (no
 * `EXPO_PUBLIC_API_BASE_URL`, no Expo project id, no FCM credentials, no Google Play services).
 * On that build the real registration path is still exercised, but the two facts it needs from
 * the outside world cannot exist:
 *
 * 1. the OS permission + Expo push token (`expo-notifications`), and
 * 2. the API transport (`POST /v1/devices/push-token`).
 *
 * So this seam stubs **only those two edges**, and nothing else:
 *
 * - permissions always report `granted`;
 * - `getExpoPushTokenAsync` is replaced by a deterministic token string;
 * - the API client is an in-memory object returning the same response shape the backend does;
 * - `registerDevicePushToken` (the real function, real validation, real KV write) still runs.
 *
 * It also accepts one QA deep link so a journey can feed an intent payload through the **real**
 * `routeFromPushNotificationData` function without a real push sender.
 *
 * Activation is compile-time and opt-in only:
 *
 *   EXPO_PUBLIC_PUSH_QA_SEAM=1
 *
 * Expo/Metro inlines `process.env.EXPO_PUBLIC_*` into a literal during a production bundle, so a
 * normal release contains `false` here and the QA branch can never be enabled at runtime. No
 * secret, credential, real endpoint or production data is involved.
 */

import {
  parsePushNotificationData,
  registerDevicePushToken,
  type PushPermissionsAdapter,
  type PushRegistrationResult,
  type PushRouteTarget,
  type PushTokenApiClient,
  type PushTokenStore,
} from '@/api/push-notifications';
import type { PushNotificationData, PushPlatform } from '@/api/types';

/** Build-time switch. `false` in every normal release because Metro inlines the literal. */
export const PUSH_QA_SEAM_ENABLED = process.env.EXPO_PUBLIC_PUSH_QA_SEAM === '1';

/** Pure, testable form of the switch above. */
export function evaluatePushQaSeamFlag(raw: string | undefined): boolean {
  return raw === '1';
}

/* --------------------------------------------------------------- deterministic fixtures */

/** Fake device identity used by the stub API client (never a real device JWT). */
export const PUSH_QA_DEVICE_ID = 'qa-push-seam-device';
/** Fake Expo token; the seam never sends it anywhere. */
export const PUSH_QA_TOKEN = 'ExponentPushToken[qa-seam]';
/** Fake server row id, mirroring `PushTokenResponse.token_id`. */
export const PUSH_QA_TOKEN_ID = 'qa-push-token';
/** Query marker that selects the QA tap path; absent from every real link. */
export const PUSH_QA_TAP_PARAM = 'qa_push';
/** Alias the journey uses for the bundled sample book (its runtime id is content-derived). */
export const PUSH_QA_SAMPLE_BOOK_ID = 'book_sample';
/** Shape-valid stand-in used only to carry the alias through the production payload parser. */
const PUSH_QA_BOOK_ID_STAND_IN = 'book_0000000000000000';

/* --------------------------------------------------------------------- status store */

export type PushQaRegistrationStatus = 'idle' | 'pending' | 'registered' | 'failed';

export interface PushQaStatusSnapshot {
  registration: PushQaRegistrationStatus;
  /** `/reader/<id>` produced by the real router, or `null` before a tap. */
  route: string | null;
}

let snapshot: PushQaStatusSnapshot = { registration: 'idle', route: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function setPushQaRegistration(status: PushQaRegistrationStatus): void {
  if (snapshot.registration === status) return;
  snapshot = { ...snapshot, registration: status };
  emit();
}

export function setPushQaRoute(route: string | null): void {
  if (snapshot.route === route) return;
  snapshot = { ...snapshot, route };
  emit();
}

export function getPushQaStatusSnapshot(): PushQaStatusSnapshot {
  return snapshot;
}

export function subscribePushQaStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetPushQaStatusForTests(): void {
  snapshot = { registration: 'idle', route: null };
  listeners.clear();
}

/* ------------------------------------------------------------------- stubbed edges */

/** OS permission edge: always granted, so the journey never sees a prompt. */
export function createPushQaPermissions(): Required<PushPermissionsAdapter> {
  const granted = async () => ({ status: 'granted', granted: true });
  return { get: granted, request: granted };
}

/**
 * API transport edge: an in-memory client with the backend response shape. It has no URL and
 * performs no request, so there is no endpoint and nothing to leak.
 */
export function createPushQaApiClient(): PushTokenApiClient {
  return {
    async registerPushToken(body) {
      return {
        token_id: PUSH_QA_TOKEN_ID,
        device_id: body.device_id,
        platform: body.platform,
        provider: 'expo',
        registered_at: '2026-01-01T00:00:00Z',
      };
    },
    async deletePushToken() {
      // Nothing to delete server-side in a stub.
    },
  };
}

/**
 * Run the **real** registration function with the two stubbed edges.
 *
 * The KV write (`push_token_id_v1`), the payload validation and the result mapping are the ones
 * production uses. The journey reads the result from the QA status banner (and the same KV key is
 * set on device), which is the proof that registration completed without a crash.
 */
export async function registerPushQaSeamToken(options: {
  platform: PushPlatform;
  store?: PushTokenStore;
}): Promise<PushRegistrationResult> {
  setPushQaRegistration('pending');
  const result = await registerDevicePushToken({
    apiClient: createPushQaApiClient(),
    deviceId: PUSH_QA_DEVICE_ID,
    platform: options.platform,
    permissions: createPushQaPermissions(),
    getToken: async () => PUSH_QA_TOKEN,
    notificationsModule: null,
    store: options.store,
  });
  setPushQaRegistration(result.status === 'registered' ? 'registered' : 'failed');
  return result;
}

/* ---------------------------------------------------------------------- tap routing */

/**
 * Parse the QA tap link into the same payload shape a real notification carries.
 *
 * Strict on purpose: it only accepts the app scheme plus the `qa_push=1` marker, then delegates
 * every field rule to `parsePushNotificationData` (the function production tap handling uses).
 */
export function parsePushQaTapUrl(url: string | null | undefined): PushNotificationData | null {
  if (typeof url !== 'string' || !url.startsWith('rewiaty://')) return null;
  const queryIndex = url.indexOf('?');
  if (queryIndex < 0) return null;

  const params = new Map<string, string>();
  for (const pair of url.slice(queryIndex + 1).split('&')) {
    if (!pair) continue;
    const equals = pair.indexOf('=');
    const rawKey = equals >= 0 ? pair.slice(0, equals) : pair;
    const rawValue = equals >= 0 ? pair.slice(equals + 1) : '';
    const key = safeDecode(rawKey);
    if (!params.has(key)) params.set(key, safeDecode(rawValue));
  }
  if (params.get(PUSH_QA_TAP_PARAM) !== '1') return null;

  const chapterIndexRaw = params.get('chapter_index');
  // The journey alias is not a real id, so the strict book-id rule in the production parser
  // would drop it. Validate the rest of the payload against a shape-valid stand-in, then hand the
  // alias back so `resolvePushQaBookId` maps it to the bundled book's real content-derived id.
  const rawBookId = params.get('book_id');
  const bookIdForValidation =
    rawBookId === PUSH_QA_SAMPLE_BOOK_ID ? PUSH_QA_BOOK_ID_STAND_IN : rawBookId;
  const parsed = parsePushNotificationData({
    event: params.get('event'),
    book_id: bookIdForValidation,
    job_id: params.get('job_id'),
    chapter_id: params.get('chapter_id'),
    chapter_index: chapterIndexRaw === undefined ? undefined : Number(chapterIndexRaw),
  });
  if (!parsed || rawBookId === undefined) return null;
  return rawBookId === parsed.book_id ? parsed : { ...parsed, book_id: rawBookId };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** A readable label for the QA banner: `/reader/<id>` or the bare route path. */
export function pushRouteLabel(target: PushRouteTarget): string {
  if ('params' in target) return target.pathname.replace('[id]', target.params.id);
  return target.pathname;
}

/**
 * Resolve the journey's `book_sample` alias to the bundled sample's real, content-derived id.
 *
 * The runtime id of the bundled novel is `book_<hash>` (see `computeBookId`); `book_sample` is
 * the fixture name used in unit tests. A real push always carries the runtime id, so resolving
 * the alias here keeps the routing function on the production path with a real book id.
 */
export async function resolvePushQaBookId(bookId: string): Promise<string> {
  if (bookId !== PUSH_QA_SAMPLE_BOOK_ID) return bookId;
  try {
    // Lazy require: the QA path must not pull SQLite into Web/Jest module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const database = require('../storage/database') as {
      listBooks: () => Promise<Array<{ id: string; isBundled?: boolean }>>;
    };
    const books = await database.listBooks();
    const bundled = books.find((book) => book.isBundled);
    return bundled?.id ?? bookId;
  } catch {
    return bookId;
  }
}
