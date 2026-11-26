#!/usr/bin/env bash
# tests/run_flows_selection.sh — the flow-selection gate of scripts/run_rewiaty_flows.sh.
#
# Why (tech): the runner used to be a closed set of `if want_flow <id>` blocks. A flow id dispatched
# by the app repo that matched none of them ran nothing, left results/status.tsv empty and still
# exited 0 — a green device gate for a journey that never happened. These cases pin the three rules
# that close the hole, with no emulator and no Maestro: `adb`, `maestro` and `sleep` are stubs on PATH.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
RUNNER="$ROOT/scripts/run_rewiaty_flows.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASSED=0
FAILED=0
ok() { printf 'ok   %s\n' "$*"; PASSED=$((PASSED + 1)); }
no() { printf 'FAIL %s\n' "$*"; FAILED=$((FAILED + 1)); }

# --- stubs -------------------------------------------------------------------
# adb: the runner waits for sys.boot_completed, then only needs exit 0.
mkdir -p "$WORK/bin" "$WORK/home"
cat > "$WORK/bin/adb" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "shell" ] && [ "${2:-}" = "getprop" ] && [ "${3:-}" = "sys.boot_completed" ]; then
  printf '1\n'
fi
exit 0
STUB
# maestro: record the invocation (so we can prove which flow file ran) and return a chosen verdict.
cat > "$WORK/bin/maestro" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MAESTRO_CALLS"
if [ "${1:-}" = "test" ]; then exit "${MAESTRO_RC:-0}"; fi
exit 0
STUB
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/sleep"
chmod +x "$WORK/bin/adb" "$WORK/bin/maestro" "$WORK/bin/sleep"

# --- sandbox -----------------------------------------------------------------
new_sandbox() {
  local dir="$WORK/$1"
  mkdir -p "$dir/app/apps/mobile/.maestro" "$dir/app/samples"
  printf '%s\n' "$dir"
}

# add_flow <sandbox> <id> [extra steps] — extra steps let a fixture include a sub-flow.
add_flow() {
  local dir="$1" id="$2" extra="${3:-}"
  local file="$dir/app/apps/mobile/.maestro/$id.yaml"
  printf 'appId: com.rewiaty.app\n---\n' > "$file"
  if [ -n "$extra" ]; then
    printf '%s\n' "$extra" >> "$file"
  else
    printf -- '- assertVisible: "ready"\n' >> "$file"
  fi
}

# run_runner <sandbox> <FLOW> [maestro rc]
run_runner() {
  local dir="$1" flow="$2" rc="${3:-0}"
  (
    cd "$dir" || exit 99
    HOME="$WORK/home" PATH="$WORK/bin:$PATH" FLOW="$flow" \
      MAESTRO_CALLS="$dir/maestro-calls.txt" MAESTRO_RC="$rc" \
      bash "$RUNNER" > "$dir/run.log" 2>&1
  )
  printf '%s' "$?" > "$dir/exit-code"
}

status_of() { cat "$1/results/status.tsv" 2>/dev/null; }
# status_row <sandbox> <id> <verdict> [reason]: true when that exact row exists.
status_row() {
  status_of "$1" | awk -F'\t' -v id="$2" -v v="$3" -v r="${4:-}" \
    '$1 == id && $2 == v && (r == "" || $3 == r) { found = 1 } END { exit !found }'
}
status_count() {
  status_of "$1" | awk -F'\t' -v id="$2" '$1 == id { n++ } END { print n + 0 }'
}
exit_of() { cat "$1/exit-code"; }
ran_flows() { grep -o '[^ /]*\.yaml$' "$1/maestro-calls.txt" 2>/dev/null | sed 's/\.yaml$//' | sort -u; }

# --- 1. a requested id with a file but no dedicated block must RUN -------------
BOX="$(new_sandbox unknown-with-file)"
add_flow "$BOX" scroll-mode
add_flow "$BOX" lighting-themes
run_runner "$BOX" scroll-mode
if status_row "$BOX" scroll-mode PASS; then
  ok "unknown id with a flow file is run and recorded as PASS"
else
  no "unknown id with a flow file was not run: $(status_of "$BOX")"
fi
if ran_flows "$BOX" | grep -qx 'scroll-mode'; then
  ok "run_flow really invoked maestro on scroll-mode.yaml"
else
  no "maestro never saw scroll-mode.yaml (calls: $(cat "$BOX/maestro-calls.txt" 2>/dev/null))"
fi
if [ "$(exit_of "$BOX")" = "0" ]; then
  ok "a requested flow that passed exits 0"
else
  no "a requested flow that passed exited $(exit_of "$BOX")"
fi

# --- 2. a requested id WITHOUT a file is a FAIL line, never a silent success ---
BOX="$(new_sandbox unknown-without-file)"
add_flow "$BOX" scroll-mode
run_runner "$BOX" ghost-flow
if status_row "$BOX" ghost-flow FAIL "no flow file for requested id"; then
  ok "requests id with no flow file records FAIL 'no flow file for requested id'"
else
  no "missing flow file did not record a FAIL line: $(status_of "$BOX")"
fi
if [ "$(exit_of "$BOX")" != "0" ]; then
  ok "a requested flow with no result exits non-zero ($(exit_of "$BOX"))"
else
  no "a requested flow with no result exited 0"
fi

# --- 3. an empty status file is never success --------------------------------
# A dispatch whose flow field arrives blank/garbage (",,") requests nothing: no block matches, no
# candidate exists, so status.tsv stays 0 bytes. That is exactly the shape of the original hole —
# the workflow must go red instead of reporting a green gate for zero journeys.
BOX="$(new_sandbox empty)"
run_runner "$BOX" ,,
if [ ! -s "$BOX/results/status.tsv" ]; then
  ok "a blank flow list leaves status.tsv empty (the hole this test exists for)"
else
  no "expected an empty status.tsv, got: $(status_of "$BOX")"
fi
if [ ! -s "$BOX/maestro-calls.txt" ]; then
  ok "a blank flow list runs no flow at all"
else
  no "a blank flow list still ran maestro: $(cat "$BOX/maestro-calls.txt")"
fi
if [ "$(exit_of "$BOX")" != "0" ]; then
  ok "an empty status.tsv exits non-zero ($(exit_of "$BOX"))"
else
  no "an empty status.tsv exited 0 — a green gate for nothing"
fi
if grep -q 'is empty' "$BOX/run.log" 2>/dev/null; then
  ok "the empty-status failure says why"
else
  no "no clear message for the empty status file: $(tail -n 3 "$BOX/run.log" 2>/dev/null)"
fi

# --- 4. `all` enumerates new journeys but skips shared sub-flow files --------
BOX="$(new_sandbox all-with-subflow)"
add_flow "$BOX" import-epub "- runFlow: import-epub-steps.yaml"
add_flow "$BOX" import-epub-steps
add_flow "$BOX" scroll-mode
run_runner "$BOX" all
if status_row "$BOX" scroll-mode PASS; then
  ok "FLOW=all picks up a journey that has no dedicated block"
else
  no "FLOW=all skipped the new journey: $(status_of "$BOX")"
fi
if [ "$(status_count "$BOX" import-epub-steps)" != "0" ]; then
  no "FLOW=all ran the shared sub-flow import-epub-steps as a journey"
else
  ok "FLOW=all does not run a flow that another flow includes"
fi
if [ "$(status_count "$BOX" import-epub)" = "1" ]; then
  ok "a flow that a dedicated block already ran is not run twice"
else
  no "import-epub was recorded more than once: $(status_of "$BOX")"
fi
if [ "$(exit_of "$BOX")" = "0" ]; then
  ok "FLOW=all with all flows passing exits 0"
else
  no "FLOW=all with all flows passing exited $(exit_of "$BOX"): $(status_of "$BOX")"
fi

# --- 5. a failing generic flow keeps the run red -----------------------------
BOX="$(new_sandbox generic-fails)"
add_flow "$BOX" scroll-mode
run_runner "$BOX" scroll-mode 42
if status_row "$BOX" scroll-mode FAIL "maestro exit=42"; then
  ok "a generic flow's own failure is recorded as FAIL"
else
  no "generic flow failure not recorded: $(status_of "$BOX")"
fi
if [ "$(exit_of "$BOX")" != "0" ]; then
  ok "a failing generic flow exits non-zero ($(exit_of "$BOX"))"
else
  no "a failing generic flow exited 0"
fi

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
