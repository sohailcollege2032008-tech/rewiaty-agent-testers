#!/usr/bin/env bash
set -uo pipefail

export PATH="$HOME/.maestro/bin:$PATH"
APP_ID="com.rewiaty.app"

adb wait-for-device
# Why (tech): let the emulator finish booting and settle before any flow, and keep system ANR dialogs
# ("X isn't responding") from covering the app under test.
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put secure anr_show_background 0 >/dev/null 2>&1 || true
adb shell input keyevent 82 >/dev/null 2>&1 || true
sleep 20
close_system_dialogs() {
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
  adb shell input keyevent 4 >/dev/null 2>&1 || true
}

mkdir -p results/junit results/screenshots results/video results/logs results/debug
: > results/status.tsv

echo "==> Installing APK..."
adb install -r -g app.apk || adb install -r app.apk

echo "==> Pushing sample MD files to /sdcard/Download/..."
adb push app/samples/sample-ar.md /sdcard/Download/sample-ar.md
adb push app/samples/edge-cases.md /sdcard/Download/edge-cases.md
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///storage/emulated/0/Download/sample-ar.md" >/dev/null 2>&1 || true
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///storage/emulated/0/Download/edge-cases.md" >/dev/null 2>&1 || true
sleep 2

OVERALL_RC=0

run_flow() {
  local flow_id="$1"
  local flow_file="app/apps/mobile/.maestro/${flow_id}.yaml"
  local junit_file="results/junit/${flow_id}.xml"
  local debug_dir="results/debug/${flow_id}"
  local shot_dir="results/screenshots/${flow_id}"
  local rec_pid=""
  local flow_rc=0

  mkdir -p "$debug_dir" "$shot_dir"
  close_system_dialogs
  adb logcat -c || true

  adb shell rm -f "/sdcard/rec_${flow_id}.mp4" >/dev/null 2>&1 || true
  adb shell screenrecord --bit-rate 2000000 --time-limit 180 "/sdcard/rec_${flow_id}.mp4" >/dev/null 2>&1 &
  rec_pid=$!

  echo "==> Running Maestro flow: $flow_id"
  maestro test --format junit --output "$junit_file" --debug-output "$debug_dir" "$flow_file" \
    > "results/logs/${flow_id}-maestro.log" 2>&1 || flow_rc=$?

  adb shell pkill -INT screenrecord >/dev/null 2>&1 || true
  sleep 3
  kill "$rec_pid" >/dev/null 2>&1 || true
  wait "$rec_pid" >/dev/null 2>&1 || true
  adb pull "/sdcard/rec_${flow_id}.mp4" "results/video/${flow_id}.mp4" >/dev/null 2>&1 || true

  adb logcat -d > "results/logs/${flow_id}-logcat.txt" 2>/dev/null || true

  # Collect screenshots saved in working directory, debug output, or ~/.maestro/tests
  shopt -s nullglob
  for png in *.png "$debug_dir"/*.png "$debug_dir"/**/*.png; do
    [ -f "$png" ] && mv -f "$png" "$shot_dir/" 2>/dev/null || true
  done
  if [ -d "$HOME/.maestro/tests" ]; then
    find "$HOME/.maestro/tests" -name '*.png' -exec cp -n {} "$shot_dir/" \; 2>/dev/null || true
    rm -rf "$HOME/.maestro/tests"/* 2>/dev/null || true
  fi
  shopt -u nullglob

  if [ "$flow_rc" -eq 0 ]; then
    printf '%s\tPASS\tmaestro exit=0\n' "$flow_id" >> results/status.tsv
  else
    printf '%s\tFAIL\tmaestro exit=%s\n' "$flow_id" "$flow_rc" >> results/status.tsv
    OVERALL_RC="$flow_rc"
  fi

  return "$flow_rc"
}

# 1. first-launch-sample (clean state)
adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
run_flow "first-launch-sample" || true

# 2. import-md (clean state -> delete sample -> DocumentsUI import sample-ar.md)
adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
run_flow "import-md" || true

# 3. resume-position (clean state -> ch02 -> zoom -> force stop -> relaunch)
adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
run_flow "resume-position" || true

# 4. settings-live (clean state -> OLED + Amiri + size + CSP/font logcat verification)
adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
run_flow "settings-live" || true

SETTINGS_LOGCAT="results/logs/settings-live-logcat.txt"
cp -f "$SETTINGS_LOGCAT" results/logcat.txt 2>/dev/null || true

CSP_VIOLATIONS="$(grep -iE 'Refused to load|Content Security Policy|violates the following Content Security Policy' "$SETTINGS_LOGCAT" || true)"
AMIRI_CHECK="$(grep -i '\[rewiaty-fonts\]' "$SETTINGS_LOGCAT" | tail -n 1 || true)"

if [ -n "$CSP_VIOLATIONS" ]; then
  echo "CSP VIOLATION DETECTED:" | tee results/logs/csp-check.txt
  echo "$CSP_VIOLATIONS" | tee -a results/logs/csp-check.txt
  OVERALL_RC=1
  sed -i 's/^settings-live\tPASS\t.*/settings-live\tFAIL\tCSP violation detected in logcat/' results/status.tsv
elif echo "$AMIRI_CHECK" | grep -q 'amiri=true'; then
  echo "PASS (no CSP violations; $AMIRI_CHECK)" | tee results/logs/csp-check.txt
else
  echo "WARN/FAIL (no CSP violation, but Amiri confirmation missing: ${AMIRI_CHECK:-none})" | tee results/logs/csp-check.txt
  # Check if chromium logged any font error
  FONT_ERR="$(grep -iE 'chromium.*(woff2|font|Failed to load)' "$SETTINGS_LOGCAT" || true)"
  if [ -n "$FONT_ERR" ]; then
    echo "$FONT_ERR" | tee -a results/logs/csp-check.txt
    OVERALL_RC=1
    sed -i 's/^settings-live\tPASS\t.*/settings-live\tFAIL\tfont load error in chromium logcat/' results/status.tsv
  fi
fi

# 5. open-with-telegram (clean state -> VIEW intent on edge-cases.md -> Maestro verifies book opened)
adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
MEDIA_ID="$(adb shell content query --uri content://media/external/file --projection _id --where "_display_name='edge-cases.md'" 2>/dev/null | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | head -n 1 | tr -d '\r')"
if [ -n "$MEDIA_ID" ]; then
  INTENT_URI="content://media/external/file/${MEDIA_ID}"
else
  INTENT_URI="file:///storage/emulated/0/Download/edge-cases.md"
fi
echo "Triggering ACTION_VIEW with URI: $INTENT_URI" | tee results/logs/open-with-intent.txt
adb shell am start -W -a android.intent.action.VIEW -t text/markdown -d "$INTENT_URI" --grant-read-uri-permission "$APP_ID" \
  >> results/logs/open-with-intent.txt 2>&1 || true
sleep 2
run_flow "open-with-telegram" || true

# Append full logcat at the end as well
adb logcat -d >> results/logcat.txt 2>/dev/null || true

echo "==> Final flow status:"
cat results/status.tsv
exit "$OVERALL_RC"
