/**
 * F38 — free Expo push notifications for finished chapters and books.
 *
 * Design rules encoded here:
 *
 * 1. **No static import of `expo-notifications`.** The module is native-only and is resolved at
 *    runtime inside a `try/catch`, so Web, Jest and a TypeScript build with the package absent
 *    keep working; a real EAS/Expo build with the package installed picks it up automatically.
 * 2. **Every helper is pure/injectable.** Permissions, token retrieval, the notifications
 *    module, the KV store and the API client are all seams, so the tests exercise the whole flow
 *    with zero native code and zero network.
 * 3. **Never block a conversion.** Registration returns a result object instead of throwing;
 *    a denied permission is a normal, silent outcome.
 */

import type {
  PushNotificationData,
  PushPlatform,
  PushTokenRequest,
  PushTokenResponse,
} from './types';

/* ------------------------------------------------------------------ constants */

/** KV key that remembers which server-side token row this device currently owns. */
export const PUSH_TOKEN_ID_KV_KEY = 'push_token_id_v1';

export const PUSH_CHANNEL_ID = 'book-conversion';
export const PUSH_CHANNEL_NAME_AR = 'تحويل الكتب';
export const PUSH_CHANNEL_DESCRIPTION_AR = 'إشعارات جاهزية الفصول واكتمال تحويل الكتب';

export const PUSH_READER_ROUTE = '/reader/[id]' as const;
export const PUSH_MISSION_CONTROL_ROUTE = '/mission-control' as const;
export const PUSH_UPLOAD_ROUTE = '/pdf-upload' as const;

/**
 * `registerDevicePushToken` reason for "no EAS project id in this build".
 *
 * This is the expected outcome of an offline/CI build: `getExpoPushTokenAsync` rejects with
 * `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` without one, so we never call it. A real release build
 * gets the id from the dynamic config (`extra.eas.projectId`).
 */
export const PUSH_REASON_MISSING_PROJECT_ID = 'missing_project_id' as const;

/* ------------------------------------------------------------------ constants */

/**
 * Shape of every book id this app creates.
 *
 * Derived (not guessed) from `packages/book-format/src/hash.ts` + `src/storage/book-id.ts`:
 * `computeBookId` returns `` `book_${hashString(seed)}` `` and `hashString` is two 32-bit lanes
 * printed as 8 hex chars each — so exactly `book_` followed by 16 lowercase hex characters.
 * A notification can only ever be about a book the reader can open, so anything else is junk.
 */
export const PUSH_BOOK_ID_PATTERN = /^book_[0-9a-f]{16}$/;

/** Hard ceiling on a book id before it is even pattern-matched (also blocks buffer bloat). */
export const PUSH_BOOK_ID_MAX_LENGTH = 128;

/* ------------------------------------------------- notifications module seam */

/**
 * The slice of `expo-notifications` this module uses.
 *
 * Every member is optional and loosely typed on purpose: the app must compile and run with a
 * version of the package that dropped/renamed one of them, and the runtime guards below check
 * each capability before use.
 */
export interface ExpoNotificationPermissionLike {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}

export interface ExpoNotificationResponseLike {
  notification?: {
    date?: number;
    request?: {
      identifier?: string;
      content?: { data?: unknown };
    };
  };
}

export interface ExpoNotificationSubscriptionLike {
  remove?: () => void;
}

export interface ExpoNotificationsLike {
  getPermissionsAsync?: () => Promise<ExpoNotificationPermissionLike>;
  requestPermissionsAsync?: () => Promise<ExpoNotificationPermissionLike>;
  getExpoPushTokenAsync?: (options?: {
    projectId?: string;
    deviceId?: string;
  }) => Promise<{ data: string } | string>;
  setNotificationHandler?: (handler: {
    handleNotification: () => Promise<{
      shouldShowAlert?: boolean;
      shouldShowBanner?: boolean;
      shouldShowList?: boolean;
      shouldPlaySound?: boolean;
      shouldSetBadge?: boolean;
    }>;
  }) => void;
  setNotificationChannelAsync?: (
    channelId: string,
    channel: { name: string; description?: string; importance?: number },
  ) => Promise<unknown>;
  addNotificationResponseReceivedListener?: (
    listener: (response: ExpoNotificationResponseLike) => void,
  ) => ExpoNotificationSubscriptionLike;
  getLastNotificationResponseAsync?: () => Promise<ExpoNotificationResponseLike | null>;
  AndroidImportance?: { DEFAULT?: number; HIGH?: number };
}

let cachedNotificationsModule: ExpoNotificationsLike | null | undefined;

/**
 * Resolve `expo-notifications` lazily.
 *
 * Why `require` in a `try/catch`: a static import would make the whole bundle fail on Web and
 * every Jest/typecheck path where the native package is not installed. Here a missing module
 * degrades to `null`, and every helper below turns that into a calm no-op.
 */
export function loadExpoNotifications(): ExpoNotificationsLike | null {
  if (cachedNotificationsModule !== undefined) return cachedNotificationsModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as ExpoNotificationsLike | undefined;
    cachedNotificationsModule = mod && typeof mod === 'object' ? mod : null;
  } catch {
    cachedNotificationsModule = null;
  }
  return cachedNotificationsModule;
}

/** Clears the loader cache. Tests only. */
export function resetExpoNotificationsLoaderForTests(): void {
  cachedNotificationsModule = undefined;
}

/* ------------------------------------------------------- EAS project id */

/**
 * The Expo Services project id this build was configured for, or `null`.
 *
 * Expo's documented source of truth is `expo-constants`:
 * `Constants.expoConfig.extra.eas.projectId ?? Constants.easConfig.projectId`. The module is
 * required lazily (and defensively) so a missing `expo-constants` degrades to "no project id"
 * instead of crashing registration, and so tests can run without the native module.
 *
 * Why this matters (F38): `getExpoPushTokenAsync` needs the id to attribute the token. Without
 * it Expo rejects with `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID`; calling it anyway would turn a
 * clear "this build has no push project" into a confusing generic `token_error`.
 */
export function resolveExpoProjectId(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const constantsModule = require('expo-constants') as
      | {
          default?: {
            expoConfig?: { extra?: { eas?: { projectId?: unknown } } };
            easConfig?: { projectId?: unknown };
          };
          expoConfig?: { extra?: { eas?: { projectId?: unknown } } };
          easConfig?: { projectId?: unknown };
        }
      | undefined;
    const constants = constantsModule?.default ?? constantsModule;
    const fromExpoConfig = constants?.expoConfig?.extra?.eas?.projectId;
    const fromEasConfig = constants?.easConfig?.projectId;
    const value = typeof fromExpoConfig === 'string' ? fromExpoConfig : fromEasConfig;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Test seam: replace/clear the project id resolution. */
let cachedProjectIdOverride: { value: string | null } | null = null;

export function setExpoProjectIdForTests(value: string | null): void {
  cachedProjectIdOverride = { value };
}

export function resetExpoProjectIdForTests(): void {
  cachedProjectIdOverride = null;
}

function effectiveExpoProjectId(): string | null {
  return cachedProjectIdOverride ? cachedProjectIdOverride.value : resolveExpoProjectId();
}

/* ----------------------------------------------------------- token KV store */

/** Persistent home of the current `token_id`. Injectable so tests stay off SQLite. */
export interface PushTokenStore {
  getTokenId(): Promise<string | null>;
  setTokenId(tokenId: string): Promise<void>;
  clearTokenId(): Promise<void>;
}

let defaultTokenStore: PushTokenStore | null = null;

/**
 * Default store over the app's existing `kv` table (`@/storage/database`).
 *
 * The module is required lazily: importing `expo-sqlite` at file load would break Web/Jest, and
 * a broken database must never make push registration throw.
 */
export function loadDefaultPushTokenStore(): PushTokenStore {
  if (defaultTokenStore) return defaultTokenStore;
  const loadDb = (): {
    getKv: <T>(key: string, fallback: T) => Promise<T>;
    setKv: <T>(key: string, value: T) => Promise<void>;
  } => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../storage/database') as {
      getKv: <T>(key: string, fallback: T) => Promise<T>;
      setKv: <T>(key: string, value: T) => Promise<void>;
    };
  };
  defaultTokenStore = {
    async getTokenId() {
      try {
        const value = await loadDb().getKv<string | null>(PUSH_TOKEN_ID_KV_KEY, null);
        return typeof value === 'string' && value.length > 0 ? value : null;
      } catch {
        return null;
      }
    },
    async setTokenId(tokenId) {
      try {
        await loadDb().setKv(PUSH_TOKEN_ID_KV_KEY, tokenId);
      } catch {
        // Losing the id only costs a duplicate registration next launch; never fatal.
      }
    },
    async clearTokenId() {
      try {
        await loadDb().setKv(PUSH_TOKEN_ID_KV_KEY, null);
      } catch {
        // Same as above.
      }
    },
  };
  return defaultTokenStore;
}

/* ---------------------------------------------------------------- API seam */

/** The two API calls registration needs; a real `RewiatyApiClient` satisfies it structurally. */
export interface PushTokenApiClient {
  registerPushToken(body: PushTokenRequest): Promise<PushTokenResponse>;
  deletePushToken(tokenId: string): Promise<void>;
}

/* ------------------------------------------------------------- permissions */

export interface PushPermissionsAdapter {
  get?: () => Promise<ExpoNotificationPermissionLike>;
  request?: () => Promise<ExpoNotificationPermissionLike>;
}

export type PushRegistrationStatus = 'registered' | 'denied' | 'unavailable' | 'failed';

export type PushRegistrationResult =
  | { status: 'registered'; tokenId: string; token: string }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

/* --------------------------------------------------------------- helpers */

function isNativePushPlatform(platform: string): platform is PushPlatform {
  return platform === 'android' || platform === 'ios';
}

/** A trimmed, non-empty project id or `null`. */
function normalizeProjectId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPermissionGranted(permission: ExpoNotificationPermissionLike | null | undefined): boolean {
  if (!permission) return false;
  return permission.granted === true || permission.status === 'granted';
}

function defaultPermissions(
  notifications: ExpoNotificationsLike | null,
): Required<PushPermissionsAdapter> {
  return {
    get: async () => {
      if (!notifications?.getPermissionsAsync) return { status: 'undetermined' };
      return notifications.getPermissionsAsync();
    },
    request: async () => {
      if (!notifications?.requestPermissionsAsync) return { status: 'undetermined' };
      return notifications.requestPermissionsAsync();
    },
  };
}

function defaultGetToken(
  notifications: ExpoNotificationsLike | null,
  projectId: string,
): ((context: { deviceId: string; platform: PushPlatform }) => Promise<string | null>) | null {
  if (!notifications?.getExpoPushTokenAsync) return null;
  return async () => {
    // The project id is required by Expo: without it the call rejects with
    // `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` instead of returning a usable token.
    const result = await notifications.getExpoPushTokenAsync!({ projectId });
    if (typeof result === 'string') return result;
    return typeof result?.data === 'string' ? result.data : null;
  };
}

/* -------------------------------------------------------------- registration */

export interface RegisterDevicePushTokenOptions {
  apiClient: PushTokenApiClient;
  deviceId: string;
  platform: PushPlatform;
  /** Test/native seam; defaults to the notifications module's own permission calls. */
  permissions?: PushPermissionsAdapter;
  /** Test seam; defaults to `getExpoPushTokenAsync` on the notifications module. */
  getToken?: (context: {
    deviceId: string;
    platform: PushPlatform;
    projectId?: string;
  }) => Promise<string | null>;
  /** Test seam; defaults to the lazily-loaded `expo-notifications`. */
  notificationsModule?: ExpoNotificationsLike | null;
  /**
   * EAS project id override. Defaults to `expo-constants` (`extra.eas.projectId`, then
   * `easConfig.projectId`). Only consulted when `getToken` is not injected.
   */
  projectId?: string | null;
  /** Test seam; defaults to the app `kv` table store. */
  store?: PushTokenStore;
  /**
   * `true` (default) asks the user when permission is still undetermined.
   * `false` never prompts — used by the boot-time path so the app does not ask on first launch.
   */
  requestPermission?: boolean;
}

/**
 * Request permission (when allowed), fetch the Expo token, register it and remember the
 * returned `token_id`.
 *
 * Never throws: every failure is a result object, so a caller can `void` it from a user gesture
 * without endangering the conversion flow.
 */
export async function registerDevicePushToken(
  options: RegisterDevicePushTokenOptions,
): Promise<PushRegistrationResult> {
  if (!isNativePushPlatform(options.platform)) {
    return { status: 'unavailable', reason: 'unsupported_platform' };
  }

  const notifications =
    options.notificationsModule === undefined
      ? loadExpoNotifications()
      : options.notificationsModule;
  const permissions = {
    ...defaultPermissions(notifications),
    ...(options.permissions ?? {}),
  };

  const projectId =
    options.projectId !== undefined
      ? normalizeProjectId(options.projectId)
      : effectiveExpoProjectId();
  const getToken =
    options.getToken ??
    (notifications?.getExpoPushTokenAsync && projectId
      ? defaultGetToken(notifications, projectId)
      : null);
  if (!getToken) {
    if (!notifications?.getExpoPushTokenAsync) {
      return { status: 'unavailable', reason: 'notifications_unavailable' };
    }
    // Build has no EAS project id: there is no honest token to register. Reported as
    // `unavailable` (a build configuration fact, not a user-facing failure).
    return { status: 'unavailable', reason: PUSH_REASON_MISSING_PROJECT_ID };
  }

  // Android 13+ only shows the notification permission prompt after a channel exists, and the
  // official flow creates the channel before fetching the token. Never fatal.
  await ensureNotificationChannel(notifications);

  let permission: ExpoNotificationPermissionLike;
  try {
    permission = await permissions.get();
    if (!isPermissionGranted(permission) && options.requestPermission !== false) {
      permission = await permissions.request();
    }
  } catch {
    return { status: 'failed', reason: 'permission_error' };
  }
  if (!isPermissionGranted(permission)) {
    // Permission is (or became) denied: a stored server row can never produce a visible
    // notification on this device, so stop the backend from sending to it and forget the id.
    // `unregisterDevicePushToken` is already best-effort and never throws.
    await unregisterDevicePushToken({
      apiClient: options.apiClient,
      store: options.store,
    });
    return { status: 'denied' };
  }

  let token: string | null;
  try {
    token = await getToken(
      projectId
        ? { deviceId: options.deviceId, platform: options.platform, projectId }
        : { deviceId: options.deviceId, platform: options.platform },
    );
  } catch {
    // Simulators and devices without FCM/APNs land here; that is not an app error.
    return { status: 'failed', reason: 'token_error' };
  }
  if (!token || token.trim().length === 0) {
    return { status: 'unavailable', reason: 'no_token' };
  }

  const store = options.store ?? loadDefaultPushTokenStore();
  let previousTokenId: string | null = null;
  try {
    previousTokenId = await store.getTokenId();
  } catch {
    previousTokenId = null;
  }

  let response: PushTokenResponse;
  try {
    response = await options.apiClient.registerPushToken({
      device_id: options.deviceId,
      platform: options.platform,
      provider: 'expo',
      token,
    });
  } catch {
    return { status: 'failed', reason: 'api_error' };
  }
  if (!response || typeof response.token_id !== 'string' || response.token_id.length === 0) {
    return { status: 'failed', reason: 'invalid_response' };
  }

  // Clean re-registration: drop the previous server row only after the new one exists, so a
  // failed registration never silently unsubscribes the device.
  if (previousTokenId && previousTokenId !== response.token_id) {
    try {
      await options.apiClient.deletePushToken(previousTokenId);
    } catch {
      // Best effort: a stale row is harmless compared to losing the live one.
    }
  }

  try {
    await store.setTokenId(response.token_id);
  } catch {
    // Handled inside the default store; an injected store may still throw.
  }

  return { status: 'registered', tokenId: response.token_id, token };
}

/**
 * Boot-time registration: only proceeds when permission is already granted, so launching the
 * app never shows a permission prompt.
 */
export async function ensurePushRegisteredIfGranted(
  options: Omit<RegisterDevicePushTokenOptions, 'requestPermission'>,
): Promise<PushRegistrationResult> {
  return registerDevicePushToken({ ...options, requestPermission: false });
}

/** Opt-out: delete the server-side token this device owns and forget its id. */
export async function unregisterDevicePushToken(options: {
  apiClient: Pick<PushTokenApiClient, 'deletePushToken'>;
  store?: PushTokenStore;
}): Promise<void> {
  const store = options.store ?? loadDefaultPushTokenStore();
  let tokenId: string | null = null;
  try {
    tokenId = await store.getTokenId();
  } catch {
    tokenId = null;
  }
  if (tokenId) {
    try {
      await options.apiClient.deletePushToken(tokenId);
    } catch {
      // The device may already be gone server-side; clearing the local id is what matters.
    }
  }
  try {
    await store.clearTokenId();
  } catch {
    // Nothing else to do.
  }
}

/* ------------------------------------------------------------ payload routing */

/** True only for an id this app's own storage layer could have produced. */
export function isValidPushBookId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > PUSH_BOOK_ID_MAX_LENGTH) return false;
  // Path traversal / separators / whitespace can never be part of a generated id, and this
  // rejects them explicitly before the shape check (defence in depth for a value that later
  // reaches a route param and a file path).
  if (/[/\\]/.test(value)) return false;
  if (value.includes('..')) return false;
  if (/\s/.test(value)) return false;
  return PUSH_BOOK_ID_PATTERN.test(value);
}

export function parsePushNotificationData(data: unknown): PushNotificationData | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw.event !== 'chapter_ready' && raw.event !== 'job_completed') return null;
  if (!isValidPushBookId(raw.book_id)) return null;
  if (typeof raw.job_id !== 'string' || raw.job_id.trim().length === 0) return null;

  const parsed: PushNotificationData = {
    event: raw.event,
    book_id: raw.book_id,
    job_id: raw.job_id,
  };
  if (typeof raw.chapter_id === 'string' && raw.chapter_id.trim().length > 0) {
    parsed.chapter_id = raw.chapter_id;
  }
  if (
    typeof raw.chapter_index === 'number' &&
    Number.isInteger(raw.chapter_index) &&
    raw.chapter_index >= 1
  ) {
    parsed.chapter_index = raw.chapter_index;
  }
  return parsed;
}

export type PushRouteTarget =
  | {
      pathname: typeof PUSH_READER_ROUTE;
      params: { id: string };
    }
  | { pathname: typeof PUSH_MISSION_CONTROL_ROUTE }
  | { pathname: typeof PUSH_UPLOAD_ROUTE };

export interface PushRouteOptions {
  /** Whether the tapped book's bundle is already imported locally. `undefined` = unknown. */
  bookReady?: boolean;
  /** Whether the book still exists at all (local or on the server). `undefined` = unknown. */
  bookExists?: boolean;
}

/**
 * Pure validation + routing for a notification tap.
 *
 * Returns `null` for anything that is not one of our events, so an unrelated notification can
 * never navigate the app by accident.
 */
export function routeFromPushNotificationData(
  data: unknown,
  options: PushRouteOptions = {},
): PushRouteTarget | null {
  const parsed = parsePushNotificationData(data);
  if (!parsed) return null;

  if (parsed.event === 'chapter_ready') {
    // A ready chapter on a book that is not on this device: Mission Control is where the job and
    // its "open" action live, so the reader never opens empty.
    if (options.bookReady === false) return { pathname: PUSH_MISSION_CONTROL_ROUTE };
    // The reader route only consumes the book id. Chapter 1 is the first streamed chapter (the
    // contract pins `chapter_index: 1`), and the book is unread, so opening it lands on that
    // chapter — while a reader who already started keeps their saved position instead of being
    // yanked back. The parsed chapter fields stay validated for routing decisions, not as URL
    // params the reader ignores.
    return { pathname: PUSH_READER_ROUTE, params: { id: parsed.book_id } };
  }

  // `job_completed`: open the finished book. If the book is gone entirely, the only useful
  // surface is a fresh conversion; if it merely is not imported yet, Mission Control imports it.
  if (options.bookReady === false) {
    if (options.bookExists === false) return { pathname: PUSH_UPLOAD_ROUTE };
    return { pathname: PUSH_MISSION_CONTROL_ROUTE };
  }
  return { pathname: PUSH_READER_ROUTE, params: { id: parsed.book_id } };
}

/* ------------------------------------------------------------- tap handling */

const handledResponseIds = new Set<string>();

/**
 * A book id the notification talks about: whether the tapped book is actually in the local
 * library. `getBookRecord` is the app's own storage read, so `null` really means "this device
 * cannot open it" (the reader would otherwise land on its error state).
 */
export interface PushBookLookup {
  getBookRecord(bookId: string): Promise<{ id: string } | null>;
}

let defaultBookLookup: PushBookLookup | null = null;

/**
 * Default lookup over the app's `books` table.
 *
 * Required lazily for the same reason as the token store: importing `expo-sqlite` at module load
 * would break Web/Jest, and a broken database must not make a notification tap throw.
 */
export function loadDefaultPushBookLookup(): PushBookLookup {
  if (defaultBookLookup) return defaultBookLookup;
  defaultBookLookup = {
    async getBookRecord(bookId) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const database = require('../storage/database') as {
        getBookRecord: (id: string) => Promise<unknown | null>;
      };
      const record = await database.getBookRecord(bookId);
      return record ? { id: bookId } : null;
    },
  };
  return defaultBookLookup;
}

/**
 * Convert "is this book here?" into router options.
 *
 * - present → the reader may open it (`bookReady`/`bookExists` true);
 * - missing → `bookReady: false` only: `bookExists` stays unknown on purpose, because the book
 *   may still live on the server and Mission Control is the surface that can import or restart
 *   the job. Passing `false` there would send the user to a fresh upload instead;
 * - lookup failure → no options at all, so a flaky DB never misroutes a tap.
 */
async function resolveLocalBookRouteOptions(
  lookup: PushBookLookup,
  bookId: string,
): Promise<PushRouteOptions> {
  let record: { id: string } | null;
  try {
    record = await lookup.getBookRecord(bookId);
  } catch {
    return {};
  }
  return record ? { bookReady: true, bookExists: true } : { bookReady: false };
}

/** Foreground presentation: show the notification instead of swallowing it. */
export function applyForegroundNotificationHandler(
  notifications: ExpoNotificationsLike | null = loadExpoNotifications(),
): boolean {
  if (!notifications?.setNotificationHandler) return false;
  try {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/** Android groups notifications into a channel; the name is user-visible, so it is Arabic. */
export async function ensureNotificationChannel(
  notifications: ExpoNotificationsLike | null = loadExpoNotifications(),
): Promise<void> {
  if (!notifications?.setNotificationChannelAsync) return;
  try {
    await notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: PUSH_CHANNEL_NAME_AR,
      description: PUSH_CHANNEL_DESCRIPTION_AR,
      // HIGH = heads-up for "your chapter is ready"; the backend sends sound: "default".
      importance:
        notifications.AndroidImportance?.HIGH ?? notifications.AndroidImportance?.DEFAULT ?? 4,
    });
  } catch {
    // A missing channel only affects Android presentation, not the tap payload.
  }
}

export interface InstallPushNotificationHandlingOptions {
  /** May be async; the handler awaits it so a tap's navigation completes in order. */
  navigate: (target: PushRouteTarget) => void | Promise<void>;
  notificationsModule?: ExpoNotificationsLike | null;
  /** Explicit overrides (used by tests); the local book lookup always wins for ready/exists. */
  routeOptions?: PushRouteOptions;
  /** Test seam; defaults to the app's own `books` table. */
  bookLookup?: PushBookLookup;
}

/**
 * Wire the app lifecycle: present notifications in the foreground, create the Android channel
 * and navigate when the user taps one (including a tap that cold-started the app).
 *
 * The tap path reads the local library record **before** routing, so a notification for a book
 * this device does not have lands on Mission Control instead of an empty reader error screen.
 *
 * Returns an unsubscribe function; a no-op when `expo-notifications` is unavailable.
 */
export function installPushNotificationHandling(
  options: InstallPushNotificationHandlingOptions,
): () => void {
  const notifications =
    options.notificationsModule === undefined
      ? loadExpoNotifications()
      : options.notificationsModule;
  if (!notifications) return () => undefined;

  applyForegroundNotificationHandler(notifications);
  void ensureNotificationChannel(notifications);

  const handleResponse = async (
    response: ExpoNotificationResponseLike | null | undefined,
  ): Promise<void> => {
    const identifier = response?.notification?.request?.identifier;
    if (identifier) {
      if (handledResponseIds.has(identifier)) return;
      handledResponseIds.add(identifier);
    }
    const parsed = parsePushNotificationData(
      response?.notification?.request?.content?.data,
    );
    if (!parsed) return;

    const lookup = options.bookLookup ?? loadDefaultPushBookLookup();
    const localOptions = await resolveLocalBookRouteOptions(lookup, parsed.book_id);
    const target = routeFromPushNotificationData(parsed, {
      ...options.routeOptions,
      ...localOptions,
    });
    if (target) await options.navigate(target);
  };

  let subscription: ExpoNotificationSubscriptionLike | undefined;
  try {
    subscription = notifications.addNotificationResponseReceivedListener?.((response) => {
      void handleResponse(response).catch(() => undefined);
    });
  } catch {
    subscription = undefined;
  }

  // A tap that launched the app from a killed state has no live listener; the OS hands it back
  // once. Deduped by identifier above so it cannot navigate twice on the same launch.
  if (notifications.getLastNotificationResponseAsync) {
    void Promise.resolve()
      .then(() => notifications.getLastNotificationResponseAsync!())
      .then((response) => {
        if (response) return handleResponse(response);
        return undefined;
      })
      .catch(() => undefined);
  }

  return () => {
    try {
      subscription?.remove?.();
    } catch {
      // Already removed.
    }
  };
}
