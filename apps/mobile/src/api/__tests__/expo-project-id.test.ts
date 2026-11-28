/**
 * F38 — the EAS project id resolver.
 *
 * The real project id comes from `expo-constants` at runtime
 * (`Constants.expoConfig.extra.eas.projectId ?? Constants.easConfig.projectId`). This file
 * proves every branch of that resolver without the native module being installed, by mocking
 * `expo-constants` virtually and reloading the module under test per case.
 */
import type { ExpoNotificationsLike } from '@/api/push-notifications';

const PROJECT_ID = '11111111-2222-3333-4444-555555555555';

function loadWithConstants(mock: unknown) {
  jest.resetModules();
  jest.doMock('expo-constants', () => mock, { virtual: true });
  return jest.requireActual<typeof import('@/api/push-notifications')>(
    '@/api/push-notifications',
  );
}

describe('resolveExpoProjectId', () => {
  afterEach(() => {
    jest.dontMock('expo-constants');
    jest.resetModules();
  });

  it('reads extra.eas.projectId from expoConfig', () => {
    const mod = loadWithConstants({
      __esModule: true,
      default: { expoConfig: { extra: { eas: { projectId: PROJECT_ID } } } },
    });
    expect(mod.resolveExpoProjectId()).toBe(PROJECT_ID);
  });

  it('falls back to easConfig.projectId', () => {
    const mod = loadWithConstants({
      __esModule: true,
      default: { easConfig: { projectId: PROJECT_ID } },
    });
    expect(mod.resolveExpoProjectId()).toBe(PROJECT_ID);
  });

  it('trims whitespace and treats blank/missing values as absent', () => {
    const spaced = loadWithConstants({
      __esModule: true,
      default: { expoConfig: { extra: { eas: { projectId: `  ${PROJECT_ID}  ` } } } },
    });
    expect(spaced.resolveExpoProjectId()).toBe(PROJECT_ID);

    const blank = loadWithConstants({
      __esModule: true,
      default: { expoConfig: { extra: { eas: { projectId: '   ' } } } },
    });
    expect(blank.resolveExpoProjectId()).toBeNull();

    const missing = loadWithConstants({ __esModule: true, default: {} });
    expect(missing.resolveExpoProjectId()).toBeNull();
  });

  it('returns null (never throws) when expo-constants cannot be resolved', () => {
    jest.resetModules();
    jest.doMock(
      'expo-constants',
      () => {
        throw new Error('native module missing');
      },
      { virtual: true },
    );
    const mod = jest.requireActual<typeof import('@/api/push-notifications')>(
      '@/api/push-notifications',
    );
    expect(mod.resolveExpoProjectId()).toBeNull();
  });

  // The resolver is only trusted if the value reaches the Expo call; this pins the join.
  it('feeds the resolved id into getExpoPushTokenAsync through the default token path', async () => {
    jest.resetModules();
    jest.doMock(
      'expo-constants',
      () => ({ __esModule: true, default: { easConfig: { projectId: PROJECT_ID } } }),
      { virtual: true },
    );
    const mod = jest.requireActual<typeof import('@/api/push-notifications')>(
      '@/api/push-notifications',
    );

    const getExpoPushTokenAsync = jest.fn(async () => ({ data: 'ExponentPushToken[real]' }));
    const notifications: ExpoNotificationsLike = {
      getPermissionsAsync: async () => ({ status: 'granted', granted: true }),
      setNotificationChannelAsync: async () => undefined,
      getExpoPushTokenAsync,
    };
    const store: import('@/api/push-notifications').PushTokenStore = {
      getTokenId: async () => null,
      setTokenId: async () => undefined,
      clearTokenId: async () => undefined,
    };
    const apiClient: import('@/api/push-notifications').PushTokenApiClient = {
      registerPushToken: async (body) => ({
        token_id: 'pt_1',
        device_id: body.device_id,
        platform: body.platform,
        provider: body.provider,
        registered_at: '2026-11-28T00:00:00Z',
      }),
      deletePushToken: async () => undefined,
    };

    const result = await mod.registerDevicePushToken({
      apiClient,
      deviceId: 'dev_1',
      platform: 'android',
      notificationsModule: notifications,
      store,
    });

    expect(result.status).toBe('registered');
    expect(getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });
});
