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
}

mkdir -p results/junit results/screenshots results/video results/logs results/debug
: > results/status.tsv

# Why (tech): the workflow passes the requested flow id as $FLOW. Without this gate every dispatch
# re-ran all journeys (a 4-minute fix cost a 15-minute run). "all" or empty keeps the full sweep.
WANT_FLOWS="${FLOW:-all}"
want_flow() {
  [ "$WANT_FLOWS" = "all" ] && return 0
  case ",$WANT_FLOWS," in *",$1,"*) return 0 ;; esac
  return 1
}
echo "==> Requested flows: $WANT_FLOWS"

echo "==> Installing APK..."
adb install -r -g app.apk || adb install -r app.apk

echo "==> Pushing sample MD files to /sdcard/Download/..."
adb push app/samples/sample-ar.md /sdcard/Download/sample-ar.md
adb push app/samples/edge-cases.md /sdcard/Download/edge-cases.md
# Why (tech): the 200k-word novel is generated, not committed (samples/long-ar.md is gitignored),
# so the runner generates it from samples/gen-long.mjs and pushes the exact file the flow imports.
if want_flow long-book-open && [ -f app/samples/gen-long.mjs ]; then
  echo "==> Generating the 200k-word sample (long-ar.md)..."
  node app/samples/gen-long.mjs | tee results/logs/long-sample.txt
  wc -w app/samples/long-ar.md | tee -a results/logs/long-sample.txt
  adb push app/samples/long-ar.md /sdcard/Download/long-ar.md
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///storage/emulated/0/Download/long-ar.md" >/dev/null 2>&1 || true
fi
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

  # Why: branches cut before a journey existed don't ship its yaml; with FLOW=all that is a SKIP,
  # not a red run. An explicitly requested flow that is missing still fails.
  if [ ! -f "$flow_file" ]; then
    if [ "$WANT_FLOWS" = "all" ]; then
      echo "==> SKIP $flow_id (no $flow_file on this ref)"
      printf '%s\tSKIP\tflow file absent on this ref\n' "$flow_id" >> results/status.tsv
      return 0
    fi
  fi

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
  # Why (tech): the accessibility tree is the only way to see what Maestro actually saw when a
  # WebView text selector fails; keep one dump per flow next to the screenshots.
  maestro hierarchy > "results/logs/hierarchy-${flow_id}.xml" 2>/dev/null || true

  # Why (tech): --debug-output writes <dir>/.maestro/tests/<ts>/<flow>/takeScreenshot/*.png, three
  # levels deep, so the old "$debug_dir"/**/*.png glob (no globstar) never matched and every run
  # uploaded zero screenshots. commands.json is Maestro's own per-command journal, the fastest way
  # to see which step failed and what it saw.
  shopt -s nullglob globstar
  for png in *.png "$debug_dir"/**/*.png; do
    [ -f "$png" ] && cp -f "$png" "$shot_dir/" 2>/dev/null || true
  done
  shopt -u nullglob globstar
  cp -f "$debug_dir"/.maestro/tests/*/*/commands.json "results/logs/${flow_id}-commands.json" 2>/dev/null || true
  cp -f "$debug_dir"/.maestro/tests/*/*/logs/maestro.log "results/logs/${flow_id}-maestro-debug.log" 2>/dev/null || true
  if [ -d "$HOME/.maestro/tests" ]; then
    find "$HOME/.maestro/tests" -name '*.png' -exec cp -n {} "$shot_dir/" \; 2>/dev/null || true
    rm -rf "$HOME/.maestro/tests"/* 2>/dev/null || true
  fi

  if [ "$flow_rc" -eq 0 ]; then
    printf '%s\tPASS\tmaestro exit=0\n' "$flow_id" >> results/status.tsv
  else
    printf '%s\tFAIL\tmaestro exit=%s\n' "$flow_id" "$flow_rc" >> results/status.tsv
    OVERALL_RC="$flow_rc"
  fi

  return "$flow_rc"
}

# 1. first-launch-sample (clean state)
if want_flow first-launch-sample; then
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  run_flow "first-launch-sample" || true
fi

# 2. import-md (clean state -> delete sample -> DocumentsUI import sample-ar.md)
if want_flow import-md; then
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  run_flow "import-md" || true
fi

# 3. resume-position (clean state -> ch02 -> zoom -> force stop -> relaunch)
if want_flow resume-position; then
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  run_flow "resume-position" || true
fi

# 4. settings-live (clean state -> OLED + Amiri + size + CSP/font logcat verification)
if want_flow settings-live; then
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
fi

# 5. open-with-telegram (clean state -> VIEW intent on edge-cases.md -> Maestro verifies book opened)
if want_flow open-with-telegram; then
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  # Why (tech): Telegram / file managers hand over a content:// URI with a read grant; file:// between apps
  # is blocked since Android 7. So we index the pushed file in MediaStore and send its content:// URI.
  mkdir -p results/logs; : > results/logs/open-with-intent.txt
  adb shell "content call --uri content://media --method scan_volume --arg external_primary" >> results/logs/open-with-intent.txt 2>&1 || true
  sleep 3
  MEDIA_ID=""
  for coll in downloads file; do
    # Why (tech): the whole command goes as ONE quoted string; otherwise the device shell strips the inner quotes
    # of the WHERE clause and the query silently returns nothing (run 45517261586).
    QOUT="$(adb shell "content query --uri content://media/external/${coll} --projection _id:_display_name --where \"_display_name='edge-cases.md'\"" 2>&1)"
    echo "[$coll] $QOUT" >> results/logs/open-with-intent.txt
    MEDIA_ID="$(printf '%s' "$QOUT" | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | head -n 1 | tr -d '\r')"
    if [ -n "$MEDIA_ID" ]; then INTENT_URI="content://media/external/${coll}/${MEDIA_ID}"; break; fi
  done
  if [ -z "$MEDIA_ID" ]; then
    echo "ERROR: edge-cases.md not indexed in MediaStore; refusing to fall back to file:// (not a real-world path)" | tee -a results/logs/open-with-intent.txt
    INTENT_URI=""
  fi
  echo "Triggering ACTION_VIEW with URI: $INTENT_URI" | tee -a results/logs/open-with-intent.txt
  [ -n "$INTENT_URI" ] && adb shell am start -W -a android.intent.action.VIEW -t text/markdown -d "$INTENT_URI" --grant-read-uri-permission "$APP_ID" \
    >> results/logs/open-with-intent.txt 2>&1 || true
  sleep 2
  run_flow "open-with-telegram" || true
fi

# 6. footnote-popover (clean state -> bundled novel ch04 -> tap [^1] -> popover -> close -> same page)
if want_flow footnote-popover; then
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  run_flow "footnote-popover" || true
fi

# 7. rotate-position (clean state -> page 4 -> landscape -> portrait). The flow fails on purpose
#    when the app never reflows (total page count stays 26), because that is the F3 bug itself.
if want_flow rotate-position; then
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  run_flow "rotate-position" || true
  adb shell settings put system accelerometer_rotation 1 >/dev/null 2>&1 || true
fi

# 8. keep-awake: the screen timeout must be shorter than the flow's 45s idle, and the device must
#    not be kept awake by the cable ("stay awake while plugged in" is what would fake a PASS).
#    Why 30s and not 15s: an Expo cold start after `pm clear` needs 15-20s before the reader opens,
#    and a 15s timeout slept the screen mid-launch (run 45614321052) — that tested the emulator,
#    not the reader. The last input is the tap that opens the book, so 45 > 30 still proves it.
if want_flow keep-awake; then
  ORIG_SCREEN_OFF="$(adb shell settings get system screen_off_timeout 2>/dev/null | tr -d '\r')"
  case "$ORIG_SCREEN_OFF" in ''|null) ORIG_SCREEN_OFF=2147483647 ;; esac
  echo "==> keep-awake: screen_off_timeout=30000 (was $ORIG_SCREEN_OFF), stay_on_while_plugged_in=0"
  adb shell settings put system screen_off_timeout 30000
  adb shell settings put global stay_on_while_plugged_in 0
  adb shell svc power stayon false >/dev/null 2>&1 || true
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  # Warm the app up to the library before Maestro starts, so the 30s timer does not expire during
  # a cold start. The wake keyevent resets the timer if the warm-up itself slept the screen.
  adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  sleep 10
  adb shell input keyevent 224 >/dev/null 2>&1 || true
  adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
  run_flow "keep-awake" || true
  {
    echo "== after the 45s reader idle (no input since the book was opened) =="
    echo "screen_off_timeout=$(adb shell settings get system screen_off_timeout 2>/dev/null | tr -d '\r')"
    echo "stay_on_while_plugged_in=$(adb shell settings get global stay_on_while_plugged_in 2>/dev/null | tr -d '\r')"
    # Why (tech): API 34 prints "  mWakefulness=Asleep" with leading spaces, so the raw line never
    # equals "mWakefulness=Awake"; extract the token instead of comparing the whole line.
    adb shell dumpsys power | grep -oE "mWakefulness=[A-Za-z]+" | head -n 1 | sed 's/^/wakefulness: /'
    adb shell dumpsys power | grep -E "Display Power: state=" | head -n 1
    echo "== maestro verdict =="
    cat results/logs/keep-awake-maestro.log 2>/dev/null || true
  } | tee results/logs/keep-awake-power.txt

  KEEP_AWAKE_POWER="$(grep -m1 'wakefulness:' results/logs/keep-awake-power.txt | sed 's/.*wakefulness: //' | tr -d '\r' || true)"
  KEEP_AWAKE_SECONDS="$(python3 - <<'PY'
import re
try:
    xml = open('results/junit/keep-awake.xml', encoding='utf-8').read()
    m = re.search(r'time="([0-9.]+)"', xml)
    print(m.group(1) if m else '0')
except Exception:
    print('0')
PY
)"
  if [ "$KEEP_AWAKE_POWER" != "Awake" ]; then
    echo "ERROR: keep-awake: device was not Awake after the reader idle (wakefulness=${KEEP_AWAKE_POWER:-unknown})" | tee -a results/logs/keep-awake-power.txt
    sed -i 's/^keep-awake\tPASS\t.*/keep-awake\tFAIL\tdevice slept during the 45s reader idle/' results/status.tsv
    OVERALL_RC=1
  fi
  if ! awk -v s="$KEEP_AWAKE_SECONDS" 'BEGIN { exit !(s >= 45) }'; then
    echo "ERROR: keep-awake: flow only took ${KEEP_AWAKE_SECONDS}s, so the 45s idle did not run" | tee -a results/logs/keep-awake-power.txt
    sed -i 's/^keep-awake\tPASS\t.*/keep-awake\tFAIL\t45s idle did not elapse/' results/status.tsv
    OVERALL_RC=1
  fi

  # Negative control in the same conditions: the library screen (no reader) must sleep inside the
  # same 30s window, otherwise the emulator never sleeps and the positive result proves nothing.
  echo "==> keep-awake control: library only, no reader, same screenrecord load"
  adb shell input keyevent 224 >/dev/null 2>&1 || true
  adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  adb shell am start -n com.rewiaty.app/.MainActivity >/dev/null 2>&1 || true
  adb shell rm -f /sdcard/rec_keep_awake_control.mp4 >/dev/null 2>&1 || true
  adb shell screenrecord --bit-rate 2000000 --time-limit 45 /sdcard/rec_keep_awake_control.mp4 >/dev/null 2>&1 &
  CONTROL_REC_PID=$!
  sleep 40
  {
    echo "== control: library screen, no reader, 40s after launch (timeout 30s) =="
    adb shell dumpsys power | grep -oE "mWakefulness=[A-Za-z]+" | head -n 1 | sed 's/^/wakefulness: /'
  } | tee -a results/logs/keep-awake-power.txt
  adb shell pkill -INT screenrecord >/dev/null 2>&1 || true
  kill "$CONTROL_REC_PID" >/dev/null 2>&1 || true
  CONTROL_POWER="$(grep -A3 '== control:' results/logs/keep-awake-power.txt | grep -m1 'wakefulness:' | sed 's/.*wakefulness: //' | tr -d '\r' || true)"
  if [ "$CONTROL_POWER" = "Asleep" ]; then
    echo "==> keep-awake control PASSED: the library screen slept at the same 30s timeout" | tee -a results/logs/keep-awake-power.txt
  elif [ -n "$CONTROL_POWER" ]; then
    echo "ERROR: keep-awake control did not sleep (wakefulness=$CONTROL_POWER); the keep-awake result cannot be trusted" | tee -a results/logs/keep-awake-power.txt
    sed -i 's/^keep-awake\tPASS\t.*/keep-awake\tFAIL\tcontrol screen did not sleep, result inconclusive/' results/status.tsv
    OVERALL_RC=1
  fi
  adb shell input keyevent 224 >/dev/null 2>&1 || true
  adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
  adb shell input keyevent 82 >/dev/null 2>&1 || true
  adb shell settings put system screen_off_timeout "$ORIG_SCREEN_OFF" >/dev/null 2>&1 || true
fi

# 9. long-book-open (clean state -> import the generated 200k-word novel -> cold open timed at 2s)
if want_flow long-book-open && [ -f app/samples/gen-long.mjs ]; then
  adb shell pm clear "$APP_ID" >/dev/null 2>&1 || true
  run_flow "long-book-open" || true
fi

# Append full logcat at the end as well
adb logcat -d >> results/logcat.txt 2>/dev/null || true

echo "==> Final flow status:"
cat results/status.tsv
exit "$OVERALL_RC"
