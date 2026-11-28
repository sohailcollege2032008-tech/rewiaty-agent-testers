/**
 * Dynamic Expo app config — opt-in only, no credentials in the repo.
 *
 * `app.json` stays the single source of truth for everything that is not build-machine
 * specific. This file adds exactly two things, and only when the build environment provides
 * them:
 *
 * 1. `extra.eas.projectId` — the Expo Services project UUID that `getExpoPushTokenAsync`
 *    attributes the device token to. `expo-constants` reads it at runtime
 *    (`Constants.expoConfig.extra.eas.projectId`).
 * 2. `android.googleServicesFile` — the Firebase `google-services.json` path, which registers
 *    the Android app with FCM. The file itself is gitignored; only the path is configured.
 *
 * Env names (both read, first non-empty wins) — the `EXPO_PUBLIC_*` one is the documented
 * public-env convention, the short one is convenient in a shell:
 *
 *   EXPO_PUBLIC_EAS_PROJECT_ID | EAS_PROJECT_ID          → extra.eas.projectId
 *   EXPO_PUBLIC_GOOGLE_SERVICES_FILE | ANDROID_GOOGLE_SERVICES_FILE
 *                                                          → android.googleServicesFile
 *
 * With none set, the config is byte-for-byte the `app.json` config: an offline/CI build keeps
 * working, and push simply reports `missing_project_id` instead of pretending to register.
 */

const APP_JSON = require('./app.json');

const EAS_PROJECT_ID_ENV_NAMES = ['EXPO_PUBLIC_EAS_PROJECT_ID', 'EAS_PROJECT_ID'];
const GOOGLE_SERVICES_ENV_NAMES = [
  'EXPO_PUBLIC_GOOGLE_SERVICES_FILE',
  'ANDROID_GOOGLE_SERVICES_FILE',
];

/** First non-empty, trimmed env value among `names`. */
function firstEnv(env, names) {
  for (const name of names) {
    const raw = env ? env[name] : undefined;
    if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
  }
  return null;
}

/** The EAS project UUID from the environment, or `null`. */
function readEasProjectId(env = process.env) {
  return firstEnv(env, EAS_PROJECT_ID_ENV_NAMES);
}

/** The `google-services.json` path from the environment, or `null`. */
function readGoogleServicesFile(env = process.env) {
  return firstEnv(env, GOOGLE_SERVICES_ENV_NAMES);
}

/**
 * Build the Expo config.
 *
 * Expo calls this as `({ config })` with the `app.json` payload when both files exist; the
 * `env` parameter is only for tests/preflight, never set by Expo.
 */
function buildConfig({ config, env } = {}) {
  const base = config && typeof config === 'object' ? config : APP_JSON.expo;
  const resolvedEnv = env || process.env;

  const next = {
    ...base,
    android: { ...(base.android || {}) },
    extra: { ...(base.extra || {}) },
  };

  const easProjectId = readEasProjectId(resolvedEnv);
  if (easProjectId) {
    next.extra.eas = { ...(next.extra.eas || {}), projectId: easProjectId };
  }

  const googleServicesFile = readGoogleServicesFile(resolvedEnv);
  if (googleServicesFile) {
    next.android.googleServicesFile = googleServicesFile;
  }

  return next;
}

module.exports = buildConfig;
module.exports.buildConfig = buildConfig;
module.exports.readEasProjectId = readEasProjectId;
module.exports.readGoogleServicesFile = readGoogleServicesFile;
module.exports.EAS_PROJECT_ID_ENV_NAMES = EAS_PROJECT_ID_ENV_NAMES;
module.exports.GOOGLE_SERVICES_ENV_NAMES = GOOGLE_SERVICES_ENV_NAMES;
