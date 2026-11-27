#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ABIS="${1:-${ABIS:-arm64-v8a,x86_64}}"
SKIP_PREP="${SKIP_PREP:-0}"
SKIP_DICTIONARY="${SKIP_DICTIONARY:-0}"
DICT_CACHE_DIR="${DICT_CACHE_DIR:-.cache/arwiktionary}"
DICT_DB_PATH="$ROOT_DIR/apps/mobile/assets/dictionary/arwiktionary.sqlite"

build_dictionary() {
  if [ "$SKIP_DICTIONARY" = "1" ]; then
    echo "==> Skipping dictionary build (SKIP_DICTIONARY=1)"
    return 0
  fi

  echo "==> 3/6 Build offline dictionary ($DICT_DB_PATH)"
  # The dump and the generated SQLite file are git-ignored: the release APK gets
  # a freshly built database every time, verified against the pinned SHA-256 in
  # `scripts/dictionary-meta.json`.
  python3 "$ROOT_DIR/scripts/build-dictionary.py" \
    --download \
    --cache-dir "$DICT_CACHE_DIR" \
    --output "$DICT_DB_PATH"

  if [ ! -f "$DICT_DB_PATH" ]; then
    echo "ERROR: Dictionary database was not produced at $DICT_DB_PATH" >&2
    exit 1
  fi
  local dict_size
  dict_size="$(wc -c < "$DICT_DB_PATH")"
  if [ "${dict_size:-0}" -le 0 ]; then
    echo "ERROR: Dictionary database at $DICT_DB_PATH is empty" >&2
    exit 1
  fi
  echo "==> Bundled dictionary: ${dict_size} bytes"
  sha256sum "$DICT_DB_PATH"
}

if [ "$SKIP_PREP" != "1" ]; then
  echo "==> 1/6 npm ci"
  npm ci

  echo "==> 2/6 Build reader-engine and sync mobile assets"
  npm run build
  npm --workspace=@rewiaty/mobile run prebuild:assets

  # Must run before `expo prebuild` so the generated asset is present when the
  # native project and the Metro bundle are assembled.
  build_dictionary

  echo "==> 4/6 Expo prebuild (Android)"
  cd "$ROOT_DIR/apps/mobile"
  CI=1 npx expo prebuild -p android --clean --no-install
else
  echo "==> Skipping prep steps (SKIP_PREP=1)"
fi

echo "==> 5/6 Gradle assembleRelease (${ABIS})"
cd "$ROOT_DIR/apps/mobile/android"
./gradlew assembleRelease "-PreactNativeArchitectures=${ABIS}"

APK_PATH="$ROOT_DIR/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
  echo "ERROR: Release APK not found at $APK_PATH" >&2
  exit 1
fi

echo "==> 6/6 Built APK (${ABIS}): $APK_PATH"
ls -lh "$APK_PATH"
sha256sum "$APK_PATH"
