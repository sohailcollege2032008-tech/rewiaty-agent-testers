/**
 * Device-authenticated API client factory.
 *
 * Why (L3 integration, review P1): every live call needs `Authorization: Bearer <jwt>`, and the
 * JWT comes from `POST /v1/auth/device` keyed by a stable device identity. Without this layer the
 * app would call `/v1/jobs`, `/v1/uploads/*` and the SSE stream anonymously and the backend would
 * answer 401 — the whole conversion flow would look broken while the code "worked".
 *
 * Security rules encoded here (non-negotiable):
 *
 * 1. `device_id` / `device_secret` live in `expo-secure-store` only, under fixed versioned keys.
 *    When secure storage is unavailable (Jest, web, a broken native module) a random value is
 *    generated and kept **in memory** for the lifetime of the process — never in kv, never on disk.
 * 2. Nothing here logs, stringifies or persists a secret. The only place a secret is written is
 *    the secure store itself; the only place a token travels is the `Authorization` header.
 * 3. Concurrent callers share one in-flight authentication promise, so ten parallel uploads
 *    register the device exactly once instead of racing ten `/v1/auth/device` calls.
 */

import type { RewiatyApiClientOptions } from './client';
import { RewiatyApiClient } from './client';
import type { DeviceAuthResponse, Platform } from './types';

/** Versioned storage keys: a future identity format gets its own key instead of mutating this one. */
export const DEVICE_ID_STORAGE_KEY = 'rewiaty_device_id_v1';
export const DEVICE_SECRET_STORAGE_KEY = 'rewiaty_device_secret_v1';

/** A token closer than this to expiry is treated as expired, so a request cannot age out in flight. */
export const DEVICE_TOKEN_REFRESH_SKEW_MS = 60_000;

/** The slice of `expo-secure-store` this module needs — injectable so tests never touch native code. */
export type DeviceSessionSecureStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

export interface AuthenticatedApiClientOptions {
  /** Test seam. Defaults to `expo-secure-store`; `null` forces the in-memory fallback. */
  secureStore?: DeviceSessionSecureStore | null;
  /** Test seam for token expiry. Defaults to `Date.now`. */
  now?: () => number;
  /** Test seam for the platform reported to the backend. Defaults to `Platform.OS`. */
  platform?: Platform;
  /** Test seam for HTTP. Defaults to the client's own `fetch` binding. */
  fetchImpl?: RewiatyApiClientOptions['fetchImpl'];
}

type DeviceSession = {
  client: RewiatyApiClient;
  token: string | null;
  /** Epoch ms at which the cached token stops being valid. */
  expiresAt: number;
  /** Shared in-flight authentication, so parallel requests register the device once. */
  authenticating: Promise<string> | null;
  deviceId: Promise<string> | null;
  deviceSecret: Promise<string> | null;
  /** Read-or-create the stable device id (the same identity used for `POST /v1/auth/device`). */
  getDeviceId: () => Promise<string>;
};

/** One session (one client) per normalized base URL. */
const sessions = new Map<string, DeviceSession>();

/**
 * In-memory identity fallback. Used only when secure storage is missing/unavailable; it dies with
 * the process, which is exactly right — a non-secure place must never become durable storage.
 */
const memoryStore = new Map<string, string>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/* ------------------------------------------------------------- secure store */

let defaultStoreResolved = false;
let defaultStore: DeviceSessionSecureStore | null = null;

/**
 * Resolve `expo-secure-store` lazily.
 *
 * Why `require` in a try/catch: on web and in some Jest environments the native module is absent
 * or throws on import. A module-level import would make every file that merely references this
 * factory fail; here a missing store degrades to the in-memory identity and nothing else breaks.
 */
function loadDefaultSecureStore(): DeviceSessionSecureStore | null {
  if (defaultStoreResolved) return defaultStore;
  defaultStoreResolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store') as Partial<DeviceSessionSecureStore>;
    if (typeof mod?.getItemAsync === 'function' && typeof mod?.setItemAsync === 'function') {
      defaultStore = {
        getItemAsync: (key) => mod.getItemAsync!(key),
        setItemAsync: (key, value) => mod.setItemAsync!(key, value),
      };
    }
  } catch {
    defaultStore = null;
  }
  return defaultStore;
}

/** 32 random bytes as hex, preferring a CSPRNG and degrading to `Math.random` only as a last resort. */
function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => unknown } })
    .crypto;
  if (typeof cryptoObj?.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function readStoredValue(
  store: DeviceSessionSecureStore | null,
  key: string,
): Promise<string | null> {
  if (store) {
    try {
      const value = await store.getItemAsync(key);
      if (typeof value === 'string' && value.length > 0) return value;
    } catch {
      // A locked/broken keychain must not break the app: fall through to memory.
    }
  }
  const fallback = memoryStore.get(key);
  return fallback && fallback.length > 0 ? fallback : null;
}

async function writeStoredValue(
  store: DeviceSessionSecureStore | null,
  key: string,
  value: string,
): Promise<void> {
  if (store) {
    try {
      await store.setItemAsync(key, value);
      return;
    } catch {
      // Persisting failed; the in-memory copy below still keeps this run consistent.
    }
  }
  memoryStore.set(key, value);
}

/** Read-or-create a device secret/id. The generated value is never logged. */
async function ensureStoredValue(
  store: DeviceSessionSecureStore | null,
  key: string,
  create: () => string,
): Promise<string> {
  const existing = await readStoredValue(store, key);
  if (existing) return existing;
  const created = create();
  await writeStoredValue(store, key, created);
  return created;
}

/* ------------------------------------------------------------- platform */

function resolvePlatform(override?: Platform): Platform {
  if (override) return override;
  // Why require: `react-native` is present in the app, and the test seam above keeps tests away
  // from it; importing it statically would still be fine, but this keeps the factory testable
  // in plain Node without a React Native runtime.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as { Platform?: { OS?: string } };
    const os = rn.Platform?.OS;
    if (os === 'android' || os === 'ios' || os === 'web') return os;
  } catch {
    // Fall through to the neutral default.
  }
  return 'android';
}

/* ------------------------------------------------------------- sessions */

function createSession(baseUrl: string, options: AuthenticatedApiClientOptions): DeviceSession {
  const store =
    options.secureStore === undefined ? loadDefaultSecureStore() : options.secureStore;
  const now = options.now ?? Date.now;
  const platform = resolvePlatform(options.platform);

  const session: DeviceSession = {
    client: null as unknown as RewiatyApiClient,
    token: null,
    expiresAt: 0,
    authenticating: null,
    deviceId: null,
    deviceSecret: null,
    getDeviceId: () => readDeviceId(),
  };

  const readDeviceId = (): Promise<string> => {
    if (!session.deviceId) {
      session.deviceId = ensureStoredValue(store, DEVICE_ID_STORAGE_KEY, () => `dev_${randomHex(16)}`);
    }
    return session.deviceId;
  };

  const readDeviceSecret = (): Promise<string> => {
    if (!session.deviceSecret) {
      session.deviceSecret = ensureStoredValue(store, DEVICE_SECRET_STORAGE_KEY, () => randomHex(32));
    }
    return session.deviceSecret;
  };

  const authenticate = async (): Promise<string> => {
    const [deviceId, deviceSecret] = await Promise.all([readDeviceId(), readDeviceSecret()]);
    const response: DeviceAuthResponse = await session.client.authenticateDevice({
      device_id: deviceId,
      device_secret: deviceSecret,
      platform,
    });
    const token = response.access_token;
    const lifetimeSec = Number.isFinite(response.expires_in) ? Math.max(0, response.expires_in) : 0;
    session.token = token;
    session.expiresAt = now() + lifetimeSec * 1000;
    // The server may rotate the secret on first registration; keep the newest one only.
    if (typeof response.device_secret === 'string' && response.device_secret.length > 0) {
      session.deviceSecret = Promise.resolve(response.device_secret);
      await writeStoredValue(store, DEVICE_SECRET_STORAGE_KEY, response.device_secret);
    }
    return token;
  };

  session.client = new RewiatyApiClient({
    baseUrl,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    // Why this shape: `authenticateDevice` sends `auth: false`, so the token provider is never
    // re-entered from inside authentication — the lock below can never deadlock.
    getAccessToken: async () => {
      if (session.token && session.expiresAt - now() > DEVICE_TOKEN_REFRESH_SKEW_MS) {
        return session.token;
      }
      if (session.authenticating) return session.authenticating;
      const pending = authenticate();
      session.authenticating = pending;
      try {
        return await pending;
      } finally {
        if (session.authenticating === pending) session.authenticating = null;
      }
    },
  });

  return session;
}

/**
 * The one authenticated client for a base URL.
 *
 * Reused per base URL so the JWT (and the device identity) is shared by the PDF-upload service,
 * Mission Control and the SSE stream instead of each surface registering a separate device.
 */
export function getAuthenticatedApiClient(
  baseUrl: string,
  options: AuthenticatedApiClientOptions = {},
): RewiatyApiClient {
  return getOrCreateSession(baseUrl, options).client;
}

/**
 * The stable device id for a base URL — the same identity `getAuthenticatedApiClient` registers.
 *
 * Why (F38): the push token row is keyed by `device_id`, so registration must use the *same*
 * value the JWT was issued for; generating a second identity would create a token row the
 * device never authenticates with.
 */
export function getAuthenticatedDeviceId(
  baseUrl: string,
  options: AuthenticatedApiClientOptions = {},
): Promise<string> {
  return getOrCreateSession(baseUrl, options).getDeviceId();
}

function getOrCreateSession(
  baseUrl: string,
  options: AuthenticatedApiClientOptions,
): DeviceSession {
  const key = normalizeBaseUrl(baseUrl);
  const existing = sessions.get(key);
  if (existing) return existing;
  const created = createSession(key, options);
  sessions.set(key, created);
  return created;
}

/** Drops every cached client, token and in-memory identity. Tests only. */
export function resetAuthenticatedApiClientsForTests(): void {
  sessions.clear();
  memoryStore.clear();
  defaultStoreResolved = false;
  defaultStore = null;
}
