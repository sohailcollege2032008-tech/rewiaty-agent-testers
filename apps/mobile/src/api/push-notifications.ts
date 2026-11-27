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

/** Fixed Arabic copy — never assembled from server strings. */
export const PUSH_NOTIFICATION_COPY_AR = {
  channelName: PUSH_CHANNEL_NAME_AR,
  channelDescription: PUSH_CHANNEL_DESCRIPTION_AR,
  chapterReady: {
    title: 'فصل جديد جاهز',
    body: 'فصلك الجديد جاهز للقراية — افتحه وابدأ.',
  },
  jobCompleted: {
    title: 'الكتاب خلص',
    body: 'تحويل الكتاب خلص بالكامل. افتحه وابدا اقرا.',
  },
} as const;

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
): ((context: { deviceId: string; platform: PushPlatform }) => Promise<string | null>) | null {
  if (!notifications?.getExpoPushTokenAsync) return null;
  return async () => {
    const result = await notifications.getExpoPushTokenAsync!();
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
  getToken?: (context: { deviceId: string; platform: PushPlatform }) => Promise<string | null>;
  /** Test seam; defaults to the lazily-loaded `expo-notifications`. */
  notificationsModule?: ExpoNotificationsLike | null;
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
  const getToken = options.getToken ?? defaultGetToken(notifications);
  if (!getToken) return { status: 'unavailable', reason: 'notifications_unavailable' };

  let permission: ExpoNotificationPermissionLike;
  try {
    permission = await permissions.get();
    if (!isPermissionGranted(permission) && options.requestPermission !== false) {
      permission = await permissions.request();
    }
  } catch {
    return { status: 'failed', reason: 'permission_error' };
  }
  if (!isPermissionGranted(permission)) return { status: 'denied' };

  let token: string | null;
  try {
    token = await getToken({ deviceId: options.deviceId, platform: options.platform });
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

export function parsePushNotificationData(data: unknown): PushNotificationData | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  if (raw.event !== 'chapter_ready' && raw.event !== 'job_completed') return null;
  if (typeof raw.book_id !== 'string' || raw.book_id.trim().length === 0) return null;
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
      params: { id: string; chapter?: string; chapterIndex?: string };
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
    return {
      pathname: PUSH_READER_ROUTE,
      params: {
        id: parsed.book_id,
        ...(parsed.chapter_id ? { chapter: parsed.chapter_id } : {}),
        ...(typeof parsed.chapter_index === 'number'
          ? { chapterIndex: String(parsed.chapter_index) }
          : {}),
      },
    };
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
      importance: notifications.AndroidImportance?.DEFAULT ?? 3,
    });
  } catch {
    // A missing channel only affects Android presentation, not the tap payload.
  }
}

export interface InstallPushNotificationHandlingOptions {
  navigate: (target: PushRouteTarget) => void;
  notificationsModule?: ExpoNotificationsLike | null;
  routeOptions?: PushRouteOptions;
}

/**
 * Wire the app lifecycle: present notifications in the foreground, create the Android channel
 * and navigate when the user taps one (including a tap that cold-started the app).
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

  const handleResponse = (response: ExpoNotificationResponseLike | null | undefined): void => {
    const identifier = response?.notification?.request?.identifier;
    if (identifier) {
      if (handledResponseIds.has(identifier)) return;
      handledResponseIds.add(identifier);
    }
    const target = routeFromPushNotificationData(
      response?.notification?.request?.content?.data,
      options.routeOptions,
    );
    if (target) options.navigate(target);
  };

  let subscription: ExpoNotificationSubscriptionLike | undefined;
  try {
    subscription = notifications.addNotificationResponseReceivedListener?.(handleResponse);
  } catch {
    subscription = undefined;
  }

  // A tap that launched the app from a killed state has no live listener; the OS hands it back
  // once. Deduped by identifier above so it cannot navigate twice on the same launch.
  if (notifications.getLastNotificationResponseAsync) {
    void Promise.resolve()
      .then(() => notifications.getLastNotificationResponseAsync!())
      .then((response) => {
        if (response) handleResponse(response);
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
