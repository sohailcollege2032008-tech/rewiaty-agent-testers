#!/usr/bin/env bash
# Test for scripts/push-release-preflight.mjs — the run file of the F38 push release journey.
#
# Why: the preflight is what tells us whether a release build can actually get an Expo push
# token. If it is wrong in either direction the journey lies — a BLOCKED repo that reports READY
# ships a build with no push, and a properly configured machine that reports BLOCKED hides the
# bug. This pins both verdicts, the exit codes, and that no credential value is echoed.
#
# No network, no Expo account, no device. Run: bash scripts/__tests__/push-preflight.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/push-release-preflight.mjs"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASSED=0
FAILED=0
pass() { echo "ok   - $1"; PASSED=$((PASSED + 1)); }
fail() { echo "FAIL - $1"; FAILED=$((FAILED + 1)); }

assert_contains() { # name haystack needle
  case "$2" in
    *"$3"*) pass "$1" ;;
    *) fail "$1 (missing: $3)" ;;
  esac
}

assert_not_contains() { # name haystack needle
  case "$2" in
    *"$3"*) fail "$1 (leaked: $3)" ;;
    *) pass "$1" ;;
  esac
}

assert_eq() { # name expected actual
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi
}

FAKE_UUID="11111111-2222-3333-4444-555555555555"
GOOGLE_FILE="$TMP_DIR/google-services.json"
printf '{"project_info":{"project_number":"000"}}\n' >"$GOOGLE_FILE"

# Strip the push env so the host cannot make the test pass by accident.
clean_env=(env -u EXPO_PUBLIC_EAS_PROJECT_ID -u EAS_PROJECT_ID \
  -u EXPO_PUBLIC_GOOGLE_SERVICES_FILE -u ANDROID_GOOGLE_SERVICES_FILE)

# ---- 1. no push env: repo is complete, machine is not -> BLOCKED, exit 0 (CI-safe)
OUT="$("${clean_env[@]}" node "$SCRIPT" 2>&1)"
RC=$?
assert_eq "no-env exits 0 (report only)" "0" "$RC"
assert_contains "no-env names the project-id blocker" "$OUT" "BLOCKED] eas-project-id"
assert_contains "no-env names the google-services blocker" "$OUT" "BLOCKED] google-services-file"
assert_contains "no-env prints the verdict" "$OUT" "RESULT: BLOCKED"
assert_contains "dependency check passes" "$OUT" "PASS   ] dependency"
assert_contains "lockfile check passes" "$OUT" "PASS   ] lockfile"
assert_contains "config plugin check passes" "$OUT" "PASS   ] config-plugin"
assert_not_contains "no-env prints no project id value" "$OUT" "$FAKE_UUID"

# ---- 2. fully configured: READY
OUT="$(env EXPO_PUBLIC_EAS_PROJECT_ID="$FAKE_UUID" ANDROID_GOOGLE_SERVICES_FILE="$GOOGLE_FILE" \
  node "$SCRIPT" 2>&1)"
RC=$?
assert_eq "configured exits 0" "0" "$RC"
assert_contains "configured verdict is READY" "$OUT" "RESULT: READY"
assert_not_contains "configured output has no blocker" "$OUT" "BLOCKED"

# ---- 3. --require-ready turns a blocked machine into a hard failure
"${clean_env[@]}" node "$SCRIPT" --require-ready >/dev/null 2>&1
assert_eq "--require-ready exits 1 when blocked" "1" "$?"

# ---- 4. a malformed project id is a blocker, not a pass
OUT="$(env EAS_PROJECT_ID="not-a-uuid" ANDROID_GOOGLE_SERVICES_FILE="$GOOGLE_FILE" \
  node "$SCRIPT" 2>&1)"
assert_contains "malformed project id is blocked" "$OUT" "BLOCKED] eas-project-id"
assert_contains "malformed project id verdict" "$OUT" "RESULT: BLOCKED"

# ---- 5. a configured path that does not exist is a blocker
OUT="$(env EXPO_PUBLIC_EAS_PROJECT_ID="$FAKE_UUID" \
  ANDROID_GOOGLE_SERVICES_FILE="$TMP_DIR/absent.json" node "$SCRIPT" 2>&1)"
assert_contains "missing google-services file is blocked" "$OUT" "BLOCKED] google-services-file"

# ---- 6. --json is parseable and carries the blocker ids
JSON_OUT="$("${clean_env[@]}" node "$SCRIPT" --json 2>/dev/null)"
if printf '%s' "$JSON_OUT" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const r=JSON.parse(s);
  if (r.ready !== false) { console.error('ready should be false'); process.exit(1); }
  if (!Array.isArray(r.blockers) || !r.blockers.includes('eas-project-id')) {
    console.error('missing eas-project-id blocker'); process.exit(1);
  }
})" 2>"$TMP_DIR/json.err"; then
  pass "--json is valid and lists blockers"
else
  fail "--json is valid and lists blockers ($(cat "$TMP_DIR/json.err"))"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "PUSH PREFLIGHT TEST: $PASSED passed"
  exit 0
fi
echo "PUSH PREFLIGHT TEST: $PASSED passed, $FAILED failed"
exit 1
