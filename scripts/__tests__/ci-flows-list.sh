#!/usr/bin/env bash
# Test for the flow-list builder inside scripts/ci-flows.sh.
# Why: the sweep's flow list used to be a hard-coded array that drifted from `.factory/flows.yaml`,
# so new journeys were silently never dispatched. This pins the builder — exact ids, file order,
# deduped, `flows:` block only — against a temp yaml. No git, no network, no CI.
#
# Run: bash scripts/__tests__/ci-flows-list.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ci-flows.sh"
REAL_FLOWS="$REPO_ROOT/.factory/flows.yaml"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASSED=0
FAILED=0
pass() { echo "ok   - $1"; PASSED=$((PASSED + 1)); }
fail() { echo "FAIL - $1"; FAILED=$((FAILED + 1)); }

assert_eq() { # name expected actual
  if [ "$2" = "$3" ]; then
    pass "$1"
  else
    fail "$1"
    printf '       expected:\n%s\n       actual:\n%s\n' "$2" "$3"
  fi
}

FIXTURE="$TMP_DIR/flows.yaml"
cat >"$FIXTURE" <<'YAML'
# fixture — shape copied from .factory/flows.yaml
flows:
  - id: alpha
    who: "قارئ"
    steps: "run: bash scripts/ci-flows.sh alpha is not an id line"
    run: "bash scripts/ci-flows.sh alpha"
  - id: beta
  - id: "quoted-b"
  - id: delta  # trailing comment
    target: release-apk
  - id: gamma
    steps: |
      - id: not-a-real-id
  - id: alpha
other:
  - id: must-not-leak
YAML

LIST="$(CI_FLOWS_YAML="$FIXTURE" bash "$SCRIPT" --list-flows 2>"$TMP_DIR/err")"
RC=$?
assert_eq "temp flows.yaml exits 0" "0" "$RC"
assert_eq "temp flows.yaml lists the ids in file order, deduped, no leak" \
  "alpha
beta
quoted-b
delta
gamma" "$LIST"
assert_eq "no stderr on the happy path" "" "$(cat "$TMP_DIR/err")"

# A yaml with no `flows:` ids is a broken source, not an empty sweep: it must abort loudly.
: >"$TMP_DIR/empty.yaml"
CI_FLOWS_YAML="$TMP_DIR/empty.yaml" bash "$SCRIPT" --list-flows >"$TMP_DIR/out" 2>"$TMP_DIR/err"
assert_eq "empty yaml exits 1" "1" "$?"
case "$(cat "$TMP_DIR/err")" in
  *"no flow ids found"*) pass "empty yaml says why" ;;
  *) fail "empty yaml says why: $(cat "$TMP_DIR/err")" ;;
esac

# The real file must parse to the same number of ids a plain count of `- id:` rows sees.
REAL_IDS="$(bash "$SCRIPT" --list-flows)"
REAL_COUNT="$(printf '%s\n' "$REAL_IDS" | grep -c .)"
GREP_COUNT="$(grep -cE '^[[:space:]]*-[[:space:]]+id:' "$REAL_FLOWS")"
assert_eq "real .factory/flows.yaml: ids == '- id:' rows" "$GREP_COUNT" "$REAL_COUNT"
case "$REAL_IDS" in
  *" "*|*"	"*|*'"'*) fail "real ids carry no whitespace or quotes: $REAL_IDS" ;;
  *) pass "real ids carry no whitespace or quotes" ;;
esac

# `all` skips journeys that need their own build (the push QA seam APK); `--list-flows` keeps them.
ALL_IDS="$(bash "$SCRIPT" --list-all-flows)"
case "$REAL_IDS" in
  *push-registration-deeplink*) pass "--list-flows keeps push-registration-deeplink" ;;
  *) fail "--list-flows keeps push-registration-deeplink" ;;
esac
case "$ALL_IDS" in
  *push-registration-deeplink*) fail "--list-all-flows skips push-registration-deeplink" ;;
  *) pass "--list-all-flows skips push-registration-deeplink" ;;
esac
ALL_COUNT="$(printf '%s\n' "$ALL_IDS" | grep -c .)"
assert_eq "all = every id minus the 1 separate-build journey" "$((REAL_COUNT - 1))" "$ALL_COUNT"

# An unknown id is rejected by name, and the error points at the file that defines the list.
bash "$SCRIPT" definitely-not-a-flow >"$TMP_DIR/out" 2>"$TMP_DIR/err"
RC=$?
EB="$(cat "$TMP_DIR/err")"
assert_eq "unknown id exits 2" "2" "$RC"
case "$EB" in
  *"'definitely-not-a-flow' is not an id in .factory/flows.yaml."*) pass "unknown id names flows.yaml" ;;
  *) fail "unknown id names flows.yaml: $EB" ;;
esac
case "$EB" in
  *"Valid flow IDs (from .factory/flows.yaml)"*) pass "usage lists the derived ids" ;;
  *) fail "usage lists the derived ids: $EB" ;;
esac

echo
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
