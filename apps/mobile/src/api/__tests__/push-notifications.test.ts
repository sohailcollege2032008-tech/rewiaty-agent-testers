/**
 * F38 — Expo push notifications, tested entirely through the injected seams.
 *
 * No native module, no Expo push call and no network: the permissions adapter, token fetcher,
 * notifications module, KV store and API client are all in-memory fakes here.
 */
import {
  ensurePushRegisteredIfGranted,
  installPushNotificationHandling,
  PUSH_CHANNEL_NAME_AR,
  PUSH_MISSION_CONTROL_ROUTE,
  PUSH_READER_ROUTE,
  PUSH_REASON_MISSING_PROJECT_ID,
  PUSH_TOKEN_ID_KV_KEY,
  PUSH_UPLOAD_ROUTE,
  parsePushNotificationData,
  registerDevicePushToken,
  routeFromPushNotificationData,
  unregisterDevicePushToken,
  type ExpoNotificationResponseLike,
  type ExpoNotificationsLike,
  type PushBookLookup,
  type PushTokenApiClient,
  type PushTokenStore,
} from '@/api/push-notifications';
import type { PushNotificationData, PushTokenRequest } from '@/api/types';
import { waitFor } from '@testing-library/react-native';

function makeApiClient() {
  const registerPushToken = jest.fn(
    async (body: PushTokenRequest): Promise<{
      token_id: string;
      device_id: string;
      platform: PushTokenRequest['platform'];
      provider: PushTokenRequest['provider'];
      registered_at: string;
    }> => ({
      token_id: 'pt_new',
      device_id: body.device_id,
      platform: body.platform,
      provider: body.provider,
      registered_at: '2026-11-28T00:00:00Z',
    }),
  );
  const deletePushToken = jest.fn(async (_tokenId: string) => undefined);
  return { registerPushToken, deletePushToken };
}

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

function permissions(
  initial: 'granted' | 'undetermined' | 'denied',
  afterRequest: 'granted' | 'denied',
) {
  return {
    get: jest.fn(async () => ({ status: initial, granted: initial === 'granted' })),
    request: jest.fn(async () => ({
      status: afterRequest,
      granted: afterRequest === 'granted',
    })),
  };
}

const DEVICE_ID = 'dev_1';
const PLATFORM = 'android' as const;
/** A real-shaped book id: `book_` + the 16 lowercase hex chars `computeBookId` returns. */
const BOOK_ID = 'book_0123456789abcdef';
/** Second real-shaped id, used to prove routing is per id and not hardcoded. */
const OTHER_BOOK_ID = 'book_fedcba9876543210';

describe('registerDevicePushToken', () => {
  it('registers with the Expo provider and persists token_id when permission is granted', async () => {
    const apiClient = makeApiClient();
    const store = makeStore();
    const getToken = jest.fn(async () => 'ExponentPushToken[abc]');

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: permissions('granted', 'granted'),
      getToken,
      notificationsModule: null,
      store,
    });

    expect(result).toEqual({
      status: 'registered',
      tokenId: 'pt_new',
      token: 'ExponentPushToken[abc]',
    });
    expect(getToken).toHaveBeenCalledWith({ deviceId: DEVICE_ID, platform: PLATFORM });
    expect(apiClient.registerPushToken).toHaveBeenCalledWith({
      device_id: DEVICE_ID,
      platform: PLATFORM,
      provider: 'expo',
      token: 'ExponentPushToken[abc]',
    });
    expect(store.setTokenId).toHaveBeenCalledWith('pt_new');
    expect(store.current()).toBe('pt_new');
    expect(apiClient.deletePushToken).not.toHaveBeenCalled();
  });

  it('prompts for permission when undetermined and registers once granted', async () => {
    const apiClient = makeApiClient();
    const store = makeStore();
    const perms = permissions('undetermined', 'granted');

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: perms,
      getToken: async () => 'ExponentPushToken[abc]',
      notificationsModule: null,
      store,
    });

    expect(perms.request).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('registered');
  });

  it('returns denied with no token fetch and no API call when permission is refused', async () => {
    const apiClient = makeApiClient();
    const store = makeStore();
    const perms = permissions('undetermined', 'denied');
    const getToken = jest.fn(async () => 'ExponentPushToken[abc]');

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: perms,
      getToken,
      notificationsModule: null,
      store,
    });

    expect(result).toEqual({ status: 'denied' });
    expect(getToken).not.toHaveBeenCalled();
    expect(apiClient.registerPushToken).not.toHaveBeenCalled();
    expect(store.setTokenId).not.toHaveBeenCalled();
    // Nothing stored means nothing to unsubscribe from.
    expect(apiClient.deletePushToken).not.toHaveBeenCalled();
  });

  it('unsubscribes the stored server token when permission is (or becomes) denied', async () => {
    const apiClient = makeApiClient();
    const store = makeStore('pt_old');

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: permissions('denied', 'denied'),
      getToken: async () => 'ExponentPushToken[abc]',
      notificationsModule: null,
      store,
    });

    expect(result).toEqual({ status: 'denied' });
    // A token row for a device that can never display a notification is dead weight: delete it
    // and forget the id so the next launch cannot believe it is still subscribed.
    expect(apiClient.deletePushToken).toHaveBeenCalledWith('pt_old');
    expect(store.clearTokenId).toHaveBeenCalled();
    expect(store.setTokenId).not.toHaveBeenCalled();
    expect(store.current()).toBeNull();
  });

  it('never throws when the permission adapter itself fails', async () => {
    const apiClient = makeApiClient();
    const store = makeStore();

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: {
        get: async () => {
          throw new Error('native module exploded');
        },
      },
      getToken: async () => 'ExponentPushToken[abc]',
      notificationsModule: null,
      store,
    });

    expect(result).toEqual({ status: 'failed', reason: 'permission_error' });
    expect(apiClient.registerPushToken).not.toHaveBeenCalled();
  });

  it('treats a device with no push capability (null token) as unavailable, with no API call', async () => {
    const apiClient = makeApiClient();
    const store = makeStore();

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: permissions('granted', 'granted'),
      getToken: async () => null,
      notificationsModule: null,
      store,
    });

    expect(result).toEqual({ status: 'unavailable', reason: 'no_token' });
    expect(apiClient.registerPushToken).not.toHaveBeenCalled();
    expect(store.setTokenId).not.toHaveBeenCalled();
  });

  it('re-registration deletes the previous server token and stores the new one', async () => {
    const apiClient = makeApiClient();
    const store = makeStore('pt_old');

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: permissions('granted', 'granted'),
      getToken: async () => 'ExponentPushToken[new]',
      notificationsModule: null,
      store,
    });

    expect(result.status).toBe('registered');
    expect(apiClient.deletePushToken).toHaveBeenCalledWith('pt_old');
    expect(store.current()).toBe('pt_new');
  });

  it('keeps the previous token id when registration fails', async () => {
    const apiClient = makeApiClient();
    apiClient.registerPushToken.mockRejectedValueOnce(new Error('network down'));
    const store = makeStore('pt_old');

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: permissions('granted', 'granted'),
      getToken: async () => 'ExponentPushToken[new]',
      notificationsModule: null,
      store,
    });

    expect(result).toEqual({ status: 'failed', reason: 'api_error' });
    expect(apiClient.deletePushToken).not.toHaveBeenCalled();
    expect(store.current()).toBe('pt_old');
  });
});

describe('Expo project id and Android channel (real release path)', () => {
  function makeNativeModule() {
    const order: string[] = [];
    const module: ExpoNotificationsLike & { order: string[] } = {
      order,
      getPermissionsAsync: jest.fn(async () => {
        order.push('permission');
        return { status: 'granted', granted: true };
      }),
      requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
      setNotificationChannelAsync: jest.fn(async () => {
        order.push('channel');
        return undefined;
      }),
      getExpoPushTokenAsync: jest.fn(async (options?: { projectId?: string }) => {
        order.push(`token:${options?.projectId ?? ''}`);
        return { data: 'ExponentPushToken[real]' };
      }),
      AndroidImportance: { DEFAULT: 3, HIGH: 4 },
    };
    return module;
  }

  it('fetches the token with the configured project id (never without one)', async () => {
    const notifications = makeNativeModule();
    const apiClient = makeApiClient();

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      projectId: '  11111111-2222-3333-4444-555555555555  ',
      notificationsModule: notifications,
      store: makeStore(),
    });

    expect(result).toEqual({
      status: 'registered',
      tokenId: 'pt_new',
      token: 'ExponentPushToken[real]',
    });
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: '11111111-2222-3333-4444-555555555555',
    });
  });

  it('creates the Android channel BEFORE asking permission and fetching the token', async () => {
    const notifications = makeNativeModule();

    await registerDevicePushToken({
      apiClient: makeApiClient() as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      projectId: '11111111-2222-3333-4444-555555555555',
      notificationsModule: notifications,
      store: makeStore(),
    });

    expect(notifications.order).toEqual([
      'channel',
      'permission',
      'token:11111111-2222-3333-4444-555555555555',
    ]);
  });

  it('stays unavailable (and silent) when the build has no project id', async () => {
    const notifications = makeNativeModule();
    const apiClient = makeApiClient();

    const result = await registerDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      projectId: null,
      notificationsModule: notifications,
      store: makeStore(),
    });

    expect(result).toEqual({
      status: 'unavailable',
      reason: PUSH_REASON_MISSING_PROJECT_ID,
    });
    // No prompt, no channel, no token call, no server row — this build cannot push at all.
    expect(notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(apiClient.registerPushToken).not.toHaveBeenCalled();
  });

  it('still reports notifications_unavailable when the native module has no token API', async () => {
    const result = await registerDevicePushToken({
      apiClient: makeApiClient() as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      projectId: '11111111-2222-3333-4444-555555555555',
      notificationsModule: { getPermissionsAsync: async () => ({ status: 'granted' }) },
      store: makeStore(),
    });

    expect(result).toEqual({ status: 'unavailable', reason: 'notifications_unavailable' });
  });
});

describe('ensurePushRegisteredIfGranted', () => {
  it('never prompts: denied permission stays silent with no API call', async () => {
    const apiClient = makeApiClient();
    const perms = permissions('undetermined', 'granted');

    const result = await ensurePushRegisteredIfGranted({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: perms,
      getToken: async () => 'ExponentPushToken[abc]',
      notificationsModule: null,
      store: makeStore(),
    });

    expect(result).toEqual({ status: 'denied' });
    expect(perms.request).not.toHaveBeenCalled();
    expect(apiClient.registerPushToken).not.toHaveBeenCalled();
  });

  it('registers silently when permission was already granted', async () => {
    const apiClient = makeApiClient();
    const perms = permissions('granted', 'granted');

    const result = await ensurePushRegisteredIfGranted({
      apiClient: apiClient as unknown as PushTokenApiClient,
      deviceId: DEVICE_ID,
      platform: PLATFORM,
      permissions: perms,
      getToken: async () => 'ExponentPushToken[abc]',
      notificationsModule: null,
      store: makeStore(),
    });

    expect(result.status).toBe('registered');
    expect(perms.request).not.toHaveBeenCalled();
  });
});

describe('unregisterDevicePushToken', () => {
  it('deletes the stored server token and clears the KV id', async () => {
    const apiClient = makeApiClient();
    const store = makeStore('pt_old');

    await unregisterDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      store,
    });

    expect(apiClient.deletePushToken).toHaveBeenCalledWith('pt_old');
    expect(store.clearTokenId).toHaveBeenCalled();
    expect(store.current()).toBeNull();
  });

  it('does nothing on the server when there is no stored token', async () => {
    const apiClient = makeApiClient();

    await unregisterDevicePushToken({
      apiClient: apiClient as unknown as PushTokenApiClient,
      store: makeStore(),
    });

    expect(apiClient.deletePushToken).not.toHaveBeenCalled();
  });
});

describe('routeFromPushNotificationData', () => {
  const chapterPayload: PushNotificationData = {
    event: 'chapter_ready',
    book_id: BOOK_ID,
    job_id: 'job_1',
    chapter_id: 'ch01',
    chapter_index: 1,
  };

  const jobPayload: PushNotificationData = {
    event: 'job_completed',
    book_id: BOOK_ID,
    job_id: 'job_1',
  };

  it('routes chapter_ready to the reader for that book (reader restores its own position)', () => {
    expect(routeFromPushNotificationData(chapterPayload)).toEqual({
      pathname: PUSH_READER_ROUTE,
      params: { id: BOOK_ID },
    });
  });

  it('routes job_completed to the finished book', () => {
    expect(routeFromPushNotificationData(jobPayload)).toEqual({
      pathname: PUSH_READER_ROUTE,
      params: { id: BOOK_ID },
    });
  });

  it('routes a chapter_ready with no chapter fields (older backend) to the same book', () => {
    expect(
      routeFromPushNotificationData({ event: 'chapter_ready', book_id: BOOK_ID, job_id: 'job_1' }),
    ).toEqual({ pathname: PUSH_READER_ROUTE, params: { id: BOOK_ID } });
  });

  it('ignores stray chapter fields on job_completed', () => {
    expect(
      routeFromPushNotificationData({
        event: 'job_completed',
        book_id: BOOK_ID,
        job_id: 'job_1',
        chapter_id: 'ch01',
        chapter_index: 1,
      }),
    ).toEqual({ pathname: PUSH_READER_ROUTE, params: { id: BOOK_ID } });
  });

  it('falls back to Mission Control when the book is not imported locally', () => {
    expect(routeFromPushNotificationData(chapterPayload, { bookReady: false })).toEqual({
      pathname: PUSH_MISSION_CONTROL_ROUTE,
    });
    expect(routeFromPushNotificationData(jobPayload, { bookReady: false })).toEqual({
      pathname: PUSH_MISSION_CONTROL_ROUTE,
    });
  });

  it('falls back to the upload screen when a completed book no longer exists', () => {
    expect(
      routeFromPushNotificationData(jobPayload, { bookReady: false, bookExists: false }),
    ).toEqual({ pathname: PUSH_UPLOAD_ROUTE });
  });

  it('ignores invalid or unrelated payloads', () => {
    expect(routeFromPushNotificationData(null)).toBeNull();
    expect(routeFromPushNotificationData(undefined)).toBeNull();
    expect(routeFromPushNotificationData('chapter_ready')).toBeNull();
    expect(routeFromPushNotificationData({})).toBeNull();
    expect(routeFromPushNotificationData({ event: 'other_event', book_id: 'b', job_id: 'j' })).toBeNull();
    expect(routeFromPushNotificationData({ event: 'chapter_ready', job_id: 'j' })).toBeNull();
    expect(routeFromPushNotificationData({ event: 'chapter_ready', book_id: 'b' })).toBeNull();
    expect(
      routeFromPushNotificationData({ event: 'job_completed', book_id: '', job_id: 'j' }),
    ).toBeNull();
  });
});

describe('parsePushNotificationData — book_id must be a real book id', () => {
  // `computeBookId` (src/storage/book-id.ts) returns `book_` + two 32-bit lanes as 16 lowercase
  // hex chars, so anything else is not a book this app could ever open.
  it('accepts the exact shape the storage layer generates', () => {
    expect(
      parsePushNotificationData({ event: 'job_completed', book_id: BOOK_ID, job_id: 'job_1' }),
    ).toEqual({ event: 'job_completed', book_id: BOOK_ID, job_id: 'job_1' });
    expect(parsePushNotificationData({ event: 'job_completed', book_id: OTHER_BOOK_ID, job_id: 'j' }))
      .toEqual({ event: 'job_completed', book_id: OTHER_BOOK_ID, job_id: 'j' });
  });

  it('rejects every id that is not `book_` + 16 lowercase hex chars', () => {
    const junk = [
      'book_1',
      'book_',
      'book_0123456789abcde', // 15 chars
      'book_0123456789abcdef0', // 17 chars
      'book_0123456789ABCDEF', // uppercase
      'book_0123456789abcdeg', // non-hex char
      '0023456789abcdef0',
      'Book_0123456789abcdef',
      ' book_0123456789abcdef',
      'book_0123456789abcdef ',
      'book_0123456789abcde\u0000',
      'book_sample',
      'book_../0123456789abcd',
      'book_0123/456789abcdef',
      'book_0123\\456789abcdef',
      'book_0123456789abcdef/../../etc/passwd',
      `book_${'0'.repeat(200)}`,
    ];
    for (const bookId of junk) {
      expect(
        parsePushNotificationData({ event: 'chapter_ready', book_id: bookId, job_id: 'job_1' }),
      ).toBeNull();
    }
  });

  it('rejects path traversal, separators, whitespace and over-long ids explicitly', () => {
    for (const bookId of [
      '../book_0123456789abcdef',
      'book_0123456789abcdef\\..',
      'book_0123456789 abcdef',
      'book_0123456789\tabcdef',
      `book_${'a'.repeat(128)}`,
    ]) {
      expect(
        routeFromPushNotificationData({ event: 'job_completed', book_id: bookId, job_id: 'j' }),
      ).toBeNull();
    }
  });

  it('rejects a non-string book_id', () => {
    for (const bookId of [42, null, undefined, {}, ['book_0123456789abcdef']]) {
      expect(
        parsePushNotificationData({ event: 'chapter_ready', book_id: bookId, job_id: 'job_1' }),
      ).toBeNull();
    }
  });
});

describe('parsePushNotificationData', () => {
  it('keeps only valid optional fields', () => {
    expect(
      parsePushNotificationData({
        event: 'chapter_ready',
        book_id: BOOK_ID,
        job_id: 'job_1',
        chapter_id: '  ',
        chapter_index: 0,
      }),
    ).toEqual({ event: 'chapter_ready', book_id: BOOK_ID, job_id: 'job_1' });
    expect(
      parsePushNotificationData({
        event: 'chapter_ready',
        book_id: BOOK_ID,
        job_id: 'job_1',
        chapter_index: -1,
      }),
    ).toEqual({ event: 'chapter_ready', book_id: BOOK_ID, job_id: 'job_1' });
  });
});

describe('installPushNotificationHandling', () => {
  function makeNotifications(): ExpoNotificationsLike & {
    emit: (data: unknown, identifier: string) => void;
  } {
    let listener: ((response: ExpoNotificationResponseLike) => void) | null = null;
    return {
      setNotificationHandler: jest.fn(),
      setNotificationChannelAsync: jest.fn(async () => undefined),
      addNotificationResponseReceivedListener: jest.fn(
        (cb: (response: ExpoNotificationResponseLike) => void) => {
          listener = cb;
          return { remove: jest.fn() };
        },
      ),
      getLastNotificationResponseAsync: jest.fn(async () => null),
      AndroidImportance: { DEFAULT: 3 },
      emit: (data: unknown, identifier: string) => {
        listener?.({
          notification: { request: { identifier, content: { data } } },
        });
      },
    };
  }

  it('navigates on a chapter_ready tap and ignores unrelated payloads', async () => {
    const notifications = makeNotifications();
    const navigate = jest.fn();
    const bookLookup: PushBookLookup = { getBookRecord: jest.fn(async () => ({ id: BOOK_ID })) };

    const unsubscribe = installPushNotificationHandling({
      notificationsModule: notifications,
      navigate,
      bookLookup,
    });

    expect(notifications.setNotificationHandler).toHaveBeenCalled();
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: PUSH_CHANNEL_NAME_AR }),
    );

    notifications.emit(
      { event: 'chapter_ready', book_id: BOOK_ID, job_id: 'job_1', chapter_id: 'ch01' },
      'response-1',
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        pathname: PUSH_READER_ROUTE,
        params: { id: BOOK_ID },
      }),
    );

    navigate.mockClear();
    notifications.emit({ event: 'something_else' }, 'response-2');
    // Give the async path a turn; a rejected payload must never navigate.
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('sends a tap for a book that is not on this device to Mission Control (never the reader)', async () => {
    const notifications = makeNotifications();
    const navigate = jest.fn();
    const bookLookup: PushBookLookup = { getBookRecord: jest.fn(async () => null) };

    const unsubscribe = installPushNotificationHandling({
      notificationsModule: notifications,
      navigate,
      bookLookup,
    });

    notifications.emit(
      { event: 'chapter_ready', book_id: BOOK_ID, job_id: 'job_1', chapter_id: 'ch01' },
      'missing-1',
    );

    // The wiring is async: the local record is read before routing.
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(bookLookup.getBookRecord).toHaveBeenCalledWith(BOOK_ID);
    expect(navigate).toHaveBeenCalledWith({ pathname: PUSH_MISSION_CONTROL_ROUTE });

    unsubscribe();
  });

  it('routes job_completed for a book missing locally to Mission Control, not the empty reader', async () => {
    const notifications = makeNotifications();
    const navigate = jest.fn();
    const bookLookup: PushBookLookup = { getBookRecord: jest.fn(async () => null) };

    const unsubscribe = installPushNotificationHandling({
      notificationsModule: notifications,
      navigate,
      bookLookup,
    });

    notifications.emit({ event: 'job_completed', book_id: OTHER_BOOK_ID, job_id: 'job_9' }, 'done-1');

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith({ pathname: PUSH_MISSION_CONTROL_ROUTE });

    unsubscribe();
  });

  it('opens the reader for a book that IS in the local library', async () => {
    const notifications = makeNotifications();
    const navigate = jest.fn(async () => undefined);
    const bookLookup: PushBookLookup = { getBookRecord: jest.fn(async () => ({ id: OTHER_BOOK_ID })) };

    const unsubscribe = installPushNotificationHandling({
      notificationsModule: notifications,
      navigate,
      bookLookup,
    });

    notifications.emit(
      { event: 'chapter_ready', book_id: OTHER_BOOK_ID, job_id: 'job_2', chapter_index: 1 },
      'present-1',
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        pathname: PUSH_READER_ROUTE,
        params: { id: OTHER_BOOK_ID },
      }),
    );

    unsubscribe();
  });

  it('leaves routing untouched (no false "missing") when the local lookup itself fails', async () => {
    const notifications = makeNotifications();
    const navigate = jest.fn();
    const bookLookup: PushBookLookup = {
      getBookRecord: jest.fn(async () => {
        throw new Error('sqlite unavailable');
      }),
    };

    const unsubscribe = installPushNotificationHandling({
      notificationsModule: notifications,
      navigate,
      bookLookup,
    });

    notifications.emit(
      { event: 'chapter_ready', book_id: BOOK_ID, job_id: 'job_3', chapter_index: 1 },
      'unknown-1',
    );

    // Unknown local state keeps the previous behaviour: the reader restores its own position.
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ pathname: PUSH_READER_ROUTE, params: { id: BOOK_ID } }),
    );

    unsubscribe();
  });

  it('is a no-op when the notifications module is unavailable', () => {
    const navigate = jest.fn();
    const unsubscribe = installPushNotificationHandling({
      notificationsModule: null,
      navigate,
    });

    expect(() => unsubscribe()).not.toThrow();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('Arabic channel copy', () => {
  it('uses the fixed Arabic channel name and KV key', () => {
    expect(PUSH_TOKEN_ID_KV_KEY).toBe('push_token_id_v1');
    expect(PUSH_CHANNEL_NAME_AR).toBe('تحويل الكتب');
  });
});
