#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ABIS="${1:-${ABIS:-arm64-v8a,x86_64}}"
SKIP_PREP="${SKIP_PREP:-0}"

if [ "$SKIP_PREP" != "1" ]; then
  echo "==> 1/4 npm ci"
  npm ci

  echo "==> 2/4 Build reader-engine and sync mobile assets"
  npm run build
  npm --workspace=@rewiaty/mobile run prebuild:assets

  echo "==> 3/4 Expo prebuild (Android)"
  cd "$ROOT_DIR/apps/mobile"
  CI=1 npx expo prebuild -p android --clean --no-install
else
  echo "==> Skipping prep steps (SKIP_PREP=1)"
fi

echo "==> 4/4 Gradle assembleRelease (${ABIS})"
cd "$ROOT_DIR/apps/mobile/android"
./gradlew assembleRelease "-PreactNativeArchitectures=${ABIS}"

APK_PATH="$ROOT_DIR/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
  echo "ERROR: Release APK not found at $APK_PATH" >&2
  exit 1
fi

echo "==> Built APK (${ABIS}): $APK_PATH"
ls -lh "$APK_PATH"
sha256sum "$APK_PATH"
