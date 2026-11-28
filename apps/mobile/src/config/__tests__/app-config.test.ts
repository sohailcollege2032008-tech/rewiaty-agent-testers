/**
 * F38 — release-build configuration for Expo push.
 *
 * These assertions are the difference between "the code calls getExpoPushTokenAsync" and "a
 * release build can actually get a token": the SDK-matching dependency, the config plugin, the
 * lockfile entry, and the opt-in dynamic config that supplies the EAS project id and the
 * Firebase `google-services.json` path.
 *
 * Nothing here reads a real credential. The dynamic-config cases pass a fake UUID/path through
 * the same pure builder Expo uses, so the test proves the wiring without needing an account.
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';

const nodeRequire = createRequire(__filename);
const MOBILE_ROOT = path.resolve(__dirname, '../../..');

const appJson = nodeRequire(path.join(MOBILE_ROOT, 'app.json')) as {
  expo: {
    scheme?: string;
    android?: { package?: string; googleServicesFile?: string };
    plugins?: unknown[];
    extra?: { eas?: { projectId?: string } };
  };
};
const mobilePackage = nodeRequire(path.join(MOBILE_ROOT, 'package.json')) as {
  dependencies?: Record<string, string>;
};
const repoLock = nodeRequire(path.join(MOBILE_ROOT, '../../package-lock.json')) as {
  packages?: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};
const bundledNativeModules = nodeRequire('expo/bundledNativeModules.json') as Record<
  string,
  string
>;

type BuildConfig = (input?: {
  config?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}) => {
  scheme?: string;
  android?: { package?: string; googleServicesFile?: string };
  plugins?: unknown[];
  extra?: { eas?: { projectId?: string } };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const buildConfig = nodeRequire(path.join(MOBILE_ROOT, 'app.config.js')) as BuildConfig;

const FAKE_PROJECT_ID = '11111111-2222-3333-4444-555555555555';

/** Parse `~x.y.z` / `x.y.z` into numbers. */
function parseVersion(value: string): [number, number, number] {
  const match = /^[~^]?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) throw new Error(`unparseable version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

describe('expo-notifications dependency matches the installed Expo SDK', () => {
  it('is declared with a range the SDK bundle accepts', () => {
    const declared = mobilePackage.dependencies?.['expo-notifications'];
    expect(declared).toBeTruthy();

    const [declaredMajor, declaredMinor, declaredPatch] = parseVersion(declared!);
    const bundled = bundledNativeModules['expo-notifications'];
    expect(bundled).toBeTruthy();
    const [bundleMajor, bundleMinor, bundlePatch] = parseVersion(bundled!);

    expect(declaredMajor).toBe(bundleMajor);
    expect(declaredMinor).toBe(bundleMinor);
    // A newer patch in the same minor is the SDK-compatible upgrade line (`~x.y.z`).
    expect(declaredPatch).toBeGreaterThanOrEqual(bundlePatch);
  });

  it('is present in the committed lockfile with a version that satisfies the range', () => {
    const workspace = repoLock.packages?.['apps/mobile'];
    expect(workspace?.dependencies?.['expo-notifications']).toBe(
      mobilePackage.dependencies?.['expo-notifications'],
    );

    const locked = repoLock.packages?.['node_modules/expo-notifications'];
    expect(locked?.version).toBeTruthy();
    const [lockedMajor, lockedMinor] = parseVersion(locked!.version!);
    const [declaredMajor, declaredMinor] = parseVersion(
      mobilePackage.dependencies!['expo-notifications']!,
    );
    expect(lockedMajor).toBe(declaredMajor);
    expect(lockedMinor).toBe(declaredMinor);
  });

  it('still declares expo-constants (the documented projectId source)', () => {
    expect(mobilePackage.dependencies?.['expo-constants']).toBeTruthy();
  });
});

describe('app.json config plugin', () => {
  it('registers the expo-notifications plugin on the book-conversion channel', () => {
    const plugins = appJson.expo.plugins ?? [];
    const entry = plugins.find(
      (plugin) =>
        plugin === 'expo-notifications' ||
        (Array.isArray(plugin) && plugin[0] === 'expo-notifications'),
    ) as [string, { defaultChannel?: string }] | undefined;

    expect(entry).toBeTruthy();
    expect(Array.isArray(entry)).toBe(true);
    expect(entry![1]?.defaultChannel).toBe('book-conversion');
  });

  it('keeps the app identity and existing plugins unchanged', () => {
    expect(appJson.expo.scheme).toBe('rewiaty');
    expect(appJson.expo.android?.package).toBe('com.rewiaty.app');
    const plugins = appJson.expo.plugins ?? [];
    for (const required of ['expo-router', 'expo-sqlite', 'expo-asset', 'expo-sharing']) {
      expect(plugins).toContain(required);
    }
  });
});

describe('app.config.js is opt-in and credential-free by default', () => {
  it('returns the plain app.json config when no push env vars are set', () => {
    const resolved = buildConfig({ env: {} });

    expect(resolved.extra?.eas?.projectId).toBeUndefined();
    expect(resolved.android?.googleServicesFile).toBeUndefined();
    expect(resolved.scheme).toBe('rewiaty');
    expect(resolved.android?.package).toBe('com.rewiaty.app');
  });

  it('adds extra.eas.projectId from EXPO_PUBLIC_EAS_PROJECT_ID', () => {
    const resolved = buildConfig({ env: { EXPO_PUBLIC_EAS_PROJECT_ID: FAKE_PROJECT_ID } });
    expect(resolved.extra?.eas?.projectId).toBe(FAKE_PROJECT_ID);
  });

  it('accepts the short EAS_PROJECT_ID alias', () => {
    const resolved = buildConfig({ env: { EAS_PROJECT_ID: FAKE_PROJECT_ID } });
    expect(resolved.extra?.eas?.projectId).toBe(FAKE_PROJECT_ID);
  });

  it('adds android.googleServicesFile from either env name, trimmed', () => {
    const long = buildConfig({
      env: { EXPO_PUBLIC_GOOGLE_SERVICES_FILE: '  ./google-services.json  ' },
    });
    expect(long.android?.googleServicesFile).toBe('./google-services.json');

    const short = buildConfig({
      env: { ANDROID_GOOGLE_SERVICES_FILE: './firebase/google-services.json' },
    });
    expect(short.android?.googleServicesFile).toBe('./firebase/google-services.json');
  });

  it('ignores blank values instead of configuring an empty project id', () => {
    const resolved = buildConfig({
      env: { EXPO_PUBLIC_EAS_PROJECT_ID: '   ', ANDROID_GOOGLE_SERVICES_FILE: '' },
    });
    expect(resolved.extra?.eas?.projectId).toBeUndefined();
    expect(resolved.android?.googleServicesFile).toBeUndefined();
  });

  it('merges over the config Expo passes instead of dropping app.json fields', () => {
    const resolved = buildConfig({
      config: { name: 'روايتي', scheme: 'rewiaty', android: { package: 'com.rewiaty.app' } },
      env: { EAS_PROJECT_ID: FAKE_PROJECT_ID },
    });
    // `buildConfig` is not typed for `name`, so read it structurally.
    expect((resolved as { name?: string }).name).toBe('روايتي');
    expect(resolved.scheme).toBe('rewiaty');
    expect(resolved.android?.package).toBe('com.rewiaty.app');
    expect(resolved.extra?.eas?.projectId).toBe(FAKE_PROJECT_ID);
  });

  it('never contains a credential value in the tracked default config', () => {
    const resolved = buildConfig({ env: {} });
    const serialized = JSON.stringify(resolved);
    expect(serialized).not.toMatch(/private_key|BEGIN PRIVATE KEY|AIza[0-9A-Za-z_-]{20,}/);
  });
});

describe('Firebase google-services.json stays out of version control', () => {
  it('is ignored by the mobile .gitignore', () => {
    const { readFileSync } = nodeRequire('node:fs') as typeof import('node:fs');
    const ignore = readFileSync(path.join(MOBILE_ROOT, '.gitignore'), 'utf8');
    expect(ignore).toContain('google-services.json');
  });

  it('is not a tracked file in this repository', () => {
    const { execFileSync } = nodeRequire('node:child_process') as typeof import('node:child_process');
    const tracked = execFileSync(
      'git',
      ['ls-files', '--', 'apps/mobile/google-services.json', 'apps/mobile/GoogleService-Info.plist'],
      { cwd: path.resolve(MOBILE_ROOT, '../..'), encoding: 'utf8' },
    ).trim();
    expect(tracked).toBe('');
  });
});
