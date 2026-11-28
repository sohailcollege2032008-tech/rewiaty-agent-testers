#!/usr/bin/env node
/**
 * F38 push release preflight — "can this build actually deliver an Expo push notification?"
 *
 * This is the run file for the push release journey. It checks the repository side (dependency,
 * lockfile, config plugin, dynamic config) and the build-machine side (EAS project id, Firebase
 * `google-services.json`), and prints a verdict. It never contacts Expo, never needs an account,
 * never reads a credential value, and never prints one.
 *
 * Usage:
 *   node scripts/push-release-preflight.mjs            # report, exit 0 (CI-safe)
 *   node scripts/push-release-preflight.mjs --json     # machine-readable report
 *   node scripts/push-release-preflight.mjs --require-ready
 *                                                      # exit 1 unless every check passes
 *
 * Env inputs (the same names `apps/mobile/app.config.js` reads):
 *   EXPO_PUBLIC_EAS_PROJECT_ID | EAS_PROJECT_ID
 *   EXPO_PUBLIC_GOOGLE_SERVICES_FILE | ANDROID_GOOGLE_SERVICES_FILE
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const MOBILE_ROOT = path.join(REPO_ROOT, 'apps/mobile');
const APP_CONFIG = path.join(MOBILE_ROOT, 'app.config.js');

const EAS_PROJECT_ID_ENV_NAMES = ['EXPO_PUBLIC_EAS_PROJECT_ID', 'EAS_PROJECT_ID'];
const GOOGLE_SERVICES_ENV_NAMES = [
  'EXPO_PUBLIC_GOOGLE_SERVICES_FILE',
  'ANDROID_GOOGLE_SERVICES_FILE',
];
// Generic 8-4-4-4-12 hex shape. Deliberately not version/variant-strict: Expo project ids are
// UUIDs, but a non-v4 id is still a valid id and must not be reported as "not a project UUID".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function firstEnv(env, names) {
  for (const name of names) {
    const raw = env[name];
    if (typeof raw === 'string' && raw.trim().length > 0) return { name, value: raw.trim() };
  }
  return null;
}

function parseVersion(value) {
  const match = /^[~^]?(\d+)\.(\d+)\.(\d+)/.exec(String(value).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function gitTracked(relativePaths) {
  return safe(
    () =>
      execFileSync('git', ['ls-files', '--', ...relativePaths], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim(),
    '',
  );
}

function collect(env = process.env) {
  const checks = [];
  const add = (id, ok, detail, { blocking = true } = {}) => {
    checks.push({ id, ok, detail, blocking });
  };

  /* ---- repository: dependency ---- */
  const mobilePackage = safe(() => readJson(path.join(MOBILE_ROOT, 'package.json')), {});
  const declared = mobilePackage?.dependencies?.['expo-notifications'] ?? null;
  const bundled = safe(
    () => require('expo/bundledNativeModules.json')['expo-notifications'],
    null,
  );
  const declaredVersion = declared ? parseVersion(declared) : null;
  const bundledVersion = bundled ? parseVersion(bundled) : null;
  const versionsCompatible =
    Boolean(declaredVersion && bundledVersion) &&
    declaredVersion[0] === bundledVersion[0] &&
    declaredVersion[1] === bundledVersion[1] &&
    declaredVersion[2] >= bundledVersion[2];
  add(
    'dependency',
    Boolean(declared) && (bundled ? versionsCompatible : true),
    declared
      ? `declared ${declared}${bundled ? `, SDK bundle expects ${bundled}` : ''}`
      : 'expo-notifications is not in apps/mobile/package.json',
  );

  /* ---- repository: lockfile ---- */
  const lock = safe(() => readJson(path.join(REPO_ROOT, 'package-lock.json')), {});
  const locked = lock?.packages?.['node_modules/expo-notifications']?.version ?? null;
  const workspaceSpec =
    lock?.packages?.['apps/mobile']?.dependencies?.['expo-notifications'] ?? null;
  add(
    'lockfile',
    Boolean(locked) && workspaceSpec === declared,
    locked
      ? `locked ${locked}, workspace spec ${workspaceSpec}`
      : 'no node_modules/expo-notifications entry (run npm install --package-lock-only)',
  );

  /* ---- repository: config plugin ---- */
  const appJson = safe(() => readJson(path.join(MOBILE_ROOT, 'app.json')), { expo: {} });
  const plugins = Array.isArray(appJson?.expo?.plugins) ? appJson.expo.plugins : [];
  const pluginEntry = plugins.find(
    (p) =>
      p === 'expo-notifications' ||
      (Array.isArray(p) && p[0] === 'expo-notifications'),
  );
  const channel = Array.isArray(pluginEntry) ? pluginEntry[1]?.defaultChannel : null;
  add(
    'config-plugin',
    Boolean(pluginEntry) && channel === 'book-conversion',
    pluginEntry
      ? `plugin present, defaultChannel=${channel ?? '(none)'}`
      : 'app.json plugins[] has no expo-notifications entry',
  );

  /* ---- repository: dynamic config is opt-in ---- */
  const buildConfig = safe(() => require(APP_CONFIG), null);
  const withoutEnv = safe(() => buildConfig({ env: {} }), null);
  const withEnv = safe(
    () =>
      buildConfig({
        env: {
          EXPO_PUBLIC_EAS_PROJECT_ID: '11111111-2222-3333-4444-555555555555',
          ANDROID_GOOGLE_SERVICES_FILE: './google-services.json',
        },
      }),
    null,
  );
  add(
    'dynamic-config',
    Boolean(withoutEnv) &&
      withoutEnv?.extra?.eas?.projectId === undefined &&
      withoutEnv?.android?.googleServicesFile === undefined &&
      withEnv?.extra?.eas?.projectId === '11111111-2222-3333-4444-555555555555' &&
      withEnv?.android?.googleServicesFile === './google-services.json',
    withoutEnv
      ? 'app.config.js adds projectId/googleServicesFile only when the env provides them'
      : 'apps/mobile/app.config.js could not be loaded',
  );

  /* ---- build machine: EAS project id ---- */
  const projectIdEnv = firstEnv(env, EAS_PROJECT_ID_ENV_NAMES);
  const projectId = projectIdEnv?.value ?? null;
  const projectIdShapeOk = Boolean(projectId) && UUID_RE.test(projectId);
  add(
    'eas-project-id',
    projectIdShapeOk,
    projectIdEnv
      ? projectIdShapeOk
        ? `set via ${projectIdEnv.name} (UUID-shaped)`
        : `set via ${projectIdEnv.name} but it is not a project UUID`
      : `not set (${EAS_PROJECT_ID_ENV_NAMES.join(' or ')}) — getExpoPushTokenAsync would reject with ERR_NOTIFICATIONS_NO_EXPERIENCE_ID`,
  );

  /* ---- build machine: Firebase google-services.json ---- */
  const servicesEnv = firstEnv(env, GOOGLE_SERVICES_ENV_NAMES);
  const servicesPath = servicesEnv ? path.resolve(MOBILE_ROOT, servicesEnv.value) : null;
  const servicesPresent = Boolean(servicesPath) && existsSync(servicesPath);
  add(
    'google-services-file',
    servicesPresent,
    servicesEnv
      ? servicesPresent
        ? `found (via ${servicesEnv.name})`
        : `set via ${servicesEnv.name} but the file does not exist at that path`
      : `not set (${GOOGLE_SERVICES_ENV_NAMES.join(' or ')}) — Android cannot register with FCM`,
  );

  /* ---- safety: no credentials tracked ---- */
  const trackedSecrets = gitTracked([
    'apps/mobile/google-services.json',
    'apps/mobile/GoogleService-Info.plist',
  ]);
  add(
    'no-tracked-credentials',
    trackedSecrets === '',
    trackedSecrets === ''
      ? 'no Firebase credential file is tracked by git'
      : `tracked credential file(s): ${trackedSecrets.replace(/\n/g, ', ')}`,
  );

  /* ---- informational (not blocking) ---- */
  const iosCredential = safe(() => {
    // iOS push needs a paid Apple Developer account; record the fact, do not block Android.
    return 'iOS push needs paid Apple Developer credentials (out of scope for the free Android journey)';
  }, null);
  checks.push({
    id: 'ios-note',
    ok: true,
    blocking: false,
    detail: iosCredential,
  });

  const blocking = checks.filter((c) => c.blocking);
  const failed = blocking.filter((c) => !c.ok);
  return {
    ready: failed.length === 0,
    checks,
    blockers: failed.map((c) => c.id),
  };
}

function printReport(report) {
  console.log('==> F38 Expo push release preflight');
  console.log('');
  for (const check of report.checks) {
    const tag = check.blocking ? (check.ok ? 'PASS   ' : 'BLOCKED') : 'NOTE   ';
    console.log(`[${tag}] ${check.id.padEnd(22)} ${check.detail}`);
  }
  console.log('');
  if (report.ready) {
    console.log('RESULT: READY — a release build can request an Expo push token.');
    console.log('Next: build the release APK with these env vars, then run the push journey:');
    console.log('  1. apps/mobile/.maestro once the token row exists (see docs/PUSH-RELEASE.md)');
    console.log('  2. send a chapter_ready payload from the backend worker and tap the banner');
  } else {
    console.log(`RESULT: BLOCKED — ${report.blockers.length} blocker(s): ${report.blockers.join(', ')}`);
    console.log('This build cannot obtain an Expo push token, so no push can be delivered.');
    console.log('Exact unblock steps: docs/PUSH-RELEASE.md');
  }
}

const args = new Set(process.argv.slice(2));
const report = collect(process.env);

if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (args.has('--require-ready') && !report.ready) {
  process.exitCode = 1;
}
