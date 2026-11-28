# F38 — Expo Push: release journey

Push is wired end to end in code, but a real notification cannot leave the device until the
**build machine** has an Expo project and an Android FCM registration. This page is the run
book for that journey: what is already true, what is missing, and the exact commands to prove
each step.

Nothing here needs a new account or a paid service. The Android path is free (Firebase Spark
project + Expo Services); iOS needs a paid Apple Developer account and is out of scope.

## What the code already does

| Piece | Location |
|---|---|
| Permission + token registration (never throws, never blocks a conversion) | `apps/mobile/src/api/push-notifications.ts` |
| Tap routing with payload validation (`chapter_ready`, `job_completed`) | `apps/mobile/src/api/push-notifications.ts` → `routeFromPushNotificationData` |
| Boot-time silent re-registration (no prompt) | `apps/mobile/src/app/_layout.tsx` |
| Permission prompt at the start of a conversion | `apps/mobile/src/app/pdf-upload.tsx` |
| Config plugin + Android channel `book-conversion` | `apps/mobile/app.json` |
| Opt-in dynamic config (project id + `google-services.json`) | `apps/mobile/app.config.js` |
| Release preflight runner | `scripts/push-release-preflight.mjs` |
| Backend sender (free Expo Push endpoint) | `rewiaty-backend` → `worker/push.py` |

The token path is:

1. `getPermissionsAsync` → `requestPermissionsAsync` (only from the upload gesture).
2. Android channel `book-conversion` is created **before** the permission prompt — Android 13+
   will not show the prompt until a channel exists.
3. `getExpoPushTokenAsync({ projectId })` — the project id comes from
   `Constants.expoConfig.extra.eas.projectId ?? Constants.easConfig.projectId`.
4. `POST /v1/devices/push-token` with `provider: "expo"`, using the **same** `device_id` the
   device JWT was issued for (`getAuthenticatedDeviceId`).

If the build has no project id, registration returns
`{ status: "unavailable", reason: "missing_project_id" }` and makes **no** network call. That is
deliberate: a tokenless registration would look successful while nothing could ever arrive.

## What is missing on this machine (measured, not assumed)

```
$ node scripts/push-release-preflight.mjs
==> F38 Expo push release preflight

[PASS   ] dependency             declared ~58.1.10, SDK bundle expects ~58.1.9
[PASS   ] lockfile               locked 58.1.10, workspace spec ~58.1.10
[PASS   ] config-plugin          plugin present, defaultChannel=book-conversion
[PASS   ] dynamic-config         app.config.js adds projectId/googleServicesFile only when the env provides them
[BLOCKED] eas-project-id         not set (EXPO_PUBLIC_EAS_PROJECT_ID or EAS_PROJECT_ID) — getExpoPushTokenAsync would reject with ERR_NOTIFICATIONS_NO_EXPERIENCE_ID
[BLOCKED] google-services-file   not set (EXPO_PUBLIC_GOOGLE_SERVICES_FILE or ANDROID_GOOGLE_SERVICES_FILE) — Android cannot register with FCM
[PASS   ] no-tracked-credentials no Firebase credential file is tracked by git
[NOTE   ] ios-note               iOS push needs paid Apple Developer credentials (out of scope for the free Android journey)

RESULT: BLOCKED — 2 blocker(s): eas-project-id, google-services-file
This build cannot obtain an Expo push token, so no push can be delivered.
```

Those two lines are the whole blocker. They are account/build inputs, not code defects, and
they cannot be invented — an invented UUID would fail at the Expo API, and a fake
`google-services.json` would fail FCM registration.

## Steps to unblock (owner-side, once, no new paid account)

1. **Expo project id** — from the existing Expo account/project (Expo dashboard → Project
   settings → *Project ID*, a UUID). Export it for the build:
   ```bash
   export EXPO_PUBLIC_EAS_PROJECT_ID=<project-uuid>
   ```
2. **FCM V1 credentials for Expo Services** — in the existing Firebase project
   (Console → Project settings → Service accounts → *Generate new private key*), upload the
   service-account JSON to the Expo project's Android credentials (Expo dashboard →
   Credentials → Android → *FCM V1 service account key*, or `eas credentials`). This is the
   credential Expo uses to deliver; it is stored in Expo, never in this repo.
3. **`google-services.json` for the app** — same Firebase project → *Your apps* → Android app
   `com.rewiaty.app` → download. Put it at `apps/mobile/google-services.json` (gitignored) and
   export the path:
   ```bash
   export ANDROID_GOOGLE_SERVICES_FILE=./google-services.json
   ```
4. Re-run the preflight; it must print `RESULT: READY`.

`google-services.json` is not a secret in the same sense as a private key, but this repo keeps
it out of git anyway (`apps/mobile/.gitignore`), so a leaked Firebase project cannot be
re-pointed by a commit.

## Build and journey

A dev/release build is required: Expo Go on Android has not supported remote push since SDK 53.

```bash
cd apps/mobile

# 1. prove the config resolves with the env (safe output only, no credential value)
npx expo config --type public | grep -A2 '"eas"'

# 2. build (EAS or local prebuild); the plugin applies POST_NOTIFICATIONS and the channel
npx expo prebuild --platform android
npx expo run:android --variant release

# 3. from a second terminal, watch the registration call in the API logs:
#    POST /v1/devices/push-token -> 201 with provider "expo"
```

Journey (Android device/emulator **with Google Play services**, signed in to a real account):

1. Install the release build and launch it. No permission prompt appears (boot registration is
   silent by design).
2. Library → import a PDF → the app asks for notification permission; allow it.
3. Wait for the worker to publish Chapter 1. Expect a banner titled **«الفصل الأول جاهز»** with
   the body **«الفصل الأول جاهز، ابدأ اقرا»**.
4. Background the app before the notification arrives, then tap it. The app must open
   `/reader/<book_id>`. The tap carries `chapter_id`/`chapter_index`, but the reader route
   consumes only the book id: Chapter 1 is the first streamed chapter and a new book opens on it,
   while a reader who already started keeps their saved position (no yank-back).
5. Repeat for completion: banner **«اكتمل تحويل الكتاب»** → tap → the finished book in the
   reader.
6. Kill the app, send one more notification, tap from the tray. Cold-start routing must land in
   the same place (the boot path reads the last response once, deduped by identifier).

Expected payload (backend `worker/push.py`, contract `contracts/openapi.yaml`):

```json
{
  "event": "chapter_ready",
  "book_id": "...",
  "job_id": "...",
  "chapter_id": "...",
  "chapter_index": 1
}
```

The backend sends without `channelId`; the plugin's `defaultChannel: "book-conversion"` is what
routes FCM v1 notifications onto the channel the app creates. If the channel name ever changes,
change both places.

## Local verification (no credentials, no device, no student/customer)

```bash
bash scripts/__tests__/push-preflight.sh
npm --workspace=@rewiaty/mobile test -- push-notifications expo-project-id app-config
npm --workspace=@rewiaty/mobile run typecheck
```

The Jest coverage is the honest substitute until the two blockers are cleared:

- project id reaches `getExpoPushTokenAsync` and never gets called when absent;
- channel → permission → token ordering on Android;
- registration with permission granted/denied/unavailable, re-registration, API failure;
- payload validation rejects unrelated notifications and routes both events, including the
  cold-start dedupe;
- the dependency/lockfile/plugin/dynamic-config release wiring.

Nothing in that list reaches a student, a customer, Expo, FCM, or a network.

## #92 — offline QA release journey (what the testers CI runs)

The testers CI builds and tests a **release APK with no network inputs**: no
`EXPO_PUBLIC_API_BASE_URL`, no Expo project id, no FCM credentials, no Google Play services.
A real Expo token therefore cannot exist on that build, and a real Expo send is out of scope for
this journey. What the journey must prove is narrower and honest:

1. registration completes **without a crash**, and
2. a notification payload routes through the **same** function the production tap path uses and
   opens the correct book.

That is done with one compile-time seam, `EXPO_PUBLIC_PUSH_QA_SEAM=1`:

| Edge | In a normal release | In the QA build |
|---|---|---|
| OS permission | real `expo-notifications` | always `granted` (no prompt) |
| Expo token | real `getExpoPushTokenAsync` | deterministic `ExponentPushToken[qa-seam]` |
| API transport | real `POST /v1/devices/push-token` | in-memory client, same response shape, **no URL, no request** |
| Registration logic | `registerDevicePushToken` | **the same real function** (validation + KV write `push_token_id_v1`) |
| Tap routing | `routeFromPushNotificationData` | **the same real function** |

Activation is compile-time only: Expo/Metro inlines `process.env.EXPO_PUBLIC_PUSH_QA_SEAM` into a
literal during a production bundle, so a normal release contains `false` and the QA branch cannot
be turned on at runtime. There is no secret tool, no credential, no real endpoint and no Expo
send anywhere in the journey.

The flow is declared once in `.factory/flows.yaml` (`push-registration-deeplink`) and its Maestro
journey is `apps/mobile/.maestro/push-registration-deeplink.yaml`:

1. launch with a clean state; the QA banner shows `push-qa:registered` (real registration path
   finished, KV id written);
2. `openLink: rewiaty:///?qa_push=1&event=chapter_ready&book_id=book_sample&...` feeds a real
   payload shape through `parsePushNotificationData` → `routeFromPushNotificationData`;
3. the banner shows `push-qa:route:/reader/book_898d8c1a8ed51866` and the reader opens
   (`reader-book-vessel`, no `reader-error-state`).

`book_sample` is the journey alias for the bundled sample; its runtime id is content-derived
(`book_898d8c1a8ed51866`) and is pinned by a unit test. If `assets/sample-ar.md` changes, that
test fails and the new id must be placed in the Maestro journey.

### Android release journey in the testers repository

The `l6/push-release-qa` workflow ref sets `EXPO_PUBLIC_PUSH_QA_SEAM=1` only for
`push-registration-deeplink`. It labels the test artifact `rewiaty-push-qa-apk`
and skips the separate ARM64 distribution build. It needs no API URL, Expo project ID,
FCM configuration or credentials.

Dispatch the workflow on that ref after pushing the app commit to the testers repository
as `src/<sha12>`:

```bash
gh workflow run rewiaty-flows.yml \
  -R sohailcollege2032008-tech/rewiaty-agent-testers \
  --ref l6/push-release-qa -f src_ref=src/<sha12> -f flow=push-registration-deeplink
```

### Running it locally (no credentials, no device)

```bash
npm --workspace=@rewiaty/mobile test -- push-qa-seam app-config push-notifications
npm --workspace=@rewiaty/mobile run typecheck
bash scripts/__tests__/ci-flows-list.sh
```
