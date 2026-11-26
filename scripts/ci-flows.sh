#!/usr/bin/env bash
set -euo pipefail

FLOW_TARGET="${1:-}"
VALID_FLOWS=("first-launch-sample" "import-md" "import-epub" "import-epub-broken" "resume-position" "settings-live" "open-with-telegram" "drag-page-direction" "highlight-add" "scrubber-direction" "footnote-popover" "rotate-position" "keep-awake" "long-book-open" "jump-back")
# Why: F3 rotation is blocked on a product decision (landscape may end up tablet-only, and app.json
# still locks the phone to portrait). The journey stays in the sweep so its evidence stays fresh, but
# it is NOT a gate: its FAIL is reported and does not turn the run red. Remove it from this list the
# day the product decision lands and the journey passes.
BLOCKED_FLOWS=("rotate-position")
# Why (Sohail's decision): the 2 s open budget for a 200k-word book is a PRODUCT target, not a
# runner-health check. The emulator runner's load swings between runs (measured 0.34 s to 3.9 s for
# the same build), so a 2 s assertion on it says more about the box than about the reader. The
# journey keeps running on every sweep and its measured opening time is printed in the summary, but
# it is NEVER a gate — a FAIL here is reported and leaves the exit code alone. Speeding the open up
# (caching `parseBook` inside `readBookBundle`) is its own ticket. What is still required is
# EVIDENCE: a measure-only flow with no recorded result at all is treated as missing, not as a pass.
MEASURE_ONLY_FLOWS=("long-book-open")
# The assertion that carries the product number inside the journey (2 s = 2000 ms).
MEASURE_ONLY_ASSERT_TIMEOUT="2000"
is_blocked() {
  local f
  for f in "${BLOCKED_FLOWS[@]}"; do [ "$f" = "$1" ] && return 0; done
  return 1
}
is_measure_only() {
  local f
  for f in "${MEASURE_ONLY_FLOWS[@]}"; do [ "$f" = "$1" ] && return 0; done
  return 1
}

is_valid_target() {
  local target="$1"
  if [ "$target" = "all" ]; then
    return 0
  fi
  for f in "${VALID_FLOWS[@]}"; do
    if [ "$f" = "$target" ]; then
      return 0
    fi
  done
  return 1
}

if [ -z "$FLOW_TARGET" ] || ! is_valid_target "$FLOW_TARGET"; then
  echo "Usage: bash scripts/ci-flows.sh <flow-id|all>" >&2
  echo "Valid flow IDs: all ${VALID_FLOWS[*]}" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTERS_REPO="sohailcollege2032008-tech/rewiaty-agent-testers"
WORKFLOW_NAME="rewiaty-flows.yml"
cd "$ROOT_DIR"

# Why (Sohail's decision): the build AND the device tests run on the public repo's free GitHub Actions,
# never on the server. We push the committed source as a src/<sha12> branch there; the workflow builds the
# release APK from it and runs the journeys on that exact APK.
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: commit your changes first (the CI builds the committed HEAD)." >&2
  exit 1
fi
SRC_SHA="$(git rev-parse HEAD)"
SHA12="${SRC_SHA:0:12}"
SRC_REF="src/${SHA12}"
echo "==> Pushing source $SHA12 to $TESTERS_REPO as $SRC_REF"
git push -q -f "https://github.com/${TESTERS_REPO}.git" "HEAD:refs/heads/${SRC_REF}"

PREV_RUN_ID="$(gh run list -R "$TESTERS_REPO" --workflow "$WORKFLOW_NAME" -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"

echo "==> Dispatching $WORKFLOW_NAME on $TESTERS_REPO..."
# Why (tech): the testers workflow has its own journey list and keeps growing (9 at the time of writing),
# and its runner treats a flow file that is missing from the source snapshot as a failure (run 45622404149:
# footnote-popover/rotate-position/keep-awake/long-book-open live on another branch). The list that defines a
# green verdict is this script's VALID_FLOWS, so "all" dispatches exactly those ids.
if [ "$FLOW_TARGET" = "all" ]; then
  DISPATCH_FLOWS="$(IFS=,; echo "${VALID_FLOWS[*]}")"
else
  DISPATCH_FLOWS="$FLOW_TARGET"
fi
gh workflow run "$WORKFLOW_NAME" -R "$TESTERS_REPO" -f src_ref="$SRC_REF" -f flow="$DISPATCH_FLOWS"

RUN_ID=""
for _ in $(seq 1 30); do
  CANDIDATE="$(gh run list -R "$TESTERS_REPO" --workflow "$WORKFLOW_NAME" -L 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  if [ -n "$CANDIDATE" ] && [ "$CANDIDATE" != "$PREV_RUN_ID" ]; then
    RUN_ID="$CANDIDATE"
    break
  fi
  sleep 2
done

if [ -z "$RUN_ID" ]; then
  echo "ERROR: Could not locate triggered GitHub Actions run for $WORKFLOW_NAME." >&2
  exit 1
fi

RUN_URL="https://github.com/$TESTERS_REPO/actions/runs/$RUN_ID"
echo "==> Run started: $RUN_URL"

WATCH_RC=0
# Why (tech): `gh run watch` returned early once (run 45513367448) and the summary said MISSING for every flow.
# Poll the run's own status until it is completed, then read its conclusion.
# Bounded (90 min) so an API/auth outage cannot hang the factory; 5 consecutive read errors abort.
POLLS=0; READ_ERRS=0
while :; do
  if STATUS="$(gh run view "$RUN_ID" -R "$TESTERS_REPO" --json status -q .status)"; then
    READ_ERRS=0
    [ "$STATUS" = "completed" ] && break
  else
    READ_ERRS=$((READ_ERRS + 1))
    if [ "$READ_ERRS" -ge 5 ]; then echo "ERROR: cannot read run status for $RUN_URL" >&2; exit 1; fi
  fi
  POLLS=$((POLLS + 1))
  if [ "$POLLS" -ge 180 ]; then echo "ERROR: run $RUN_URL not completed after 90 min" >&2; exit 1; fi
  sleep 30
done
[ "$(gh run view "$RUN_ID" -R "$TESTERS_REPO" --json conclusion -q .conclusion)" = "success" ] || WATCH_RC=1

EVIDENCE_DIR="$ROOT_DIR/.factory/evidence/$SHA12"
rm -rf "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"

echo "==> Downloading artifacts to .factory/evidence/$SHA12/..."
gh run download "$RUN_ID" -R "$TESTERS_REPO" -n rewiaty-flows-results -D "$EVIDENCE_DIR" || true
gh run download "$RUN_ID" -R "$TESTERS_REPO" -n rewiaty-apk -D "$EVIDENCE_DIR/apk" || true
gh run download "$RUN_ID" -R "$TESTERS_REPO" -n rewiaty-apk-arm64 -D "$EVIDENCE_DIR/apk-arm64" || true
ln -sfn "$SHA12" "$ROOT_DIR/.factory/evidence/latest"
SHA256="$(cut -d' ' -f1 "$EVIDENCE_DIR/apk/apk.sha256" 2>/dev/null || echo unknown)"
ARM64_SIZE="$(stat -c%s "$EVIDENCE_DIR/apk-arm64/app.apk" 2>/dev/null || echo 0)"
ARM64_SHA256="$(cut -d' ' -f1 "$EVIDENCE_DIR/apk-arm64/apk.sha256" 2>/dev/null || echo unknown)"

SUMMARY_PATH="$EVIDENCE_DIR/summary.md"
TARGET_RC=0
BLOCKED_LIST="${BLOCKED_FLOWS[*]}"
MEASURE_LIST="${MEASURE_ONLY_FLOWS[*]}"
python3 - "$EVIDENCE_DIR" "$SUMMARY_PATH" "$RUN_ID" "$RUN_URL" "$SHA256" "$ARM64_SIZE" "$ARM64_SHA256" "$SHA12" "$FLOW_TARGET" "$WATCH_RC" "$BLOCKED_LIST" "$MEASURE_LIST" "$MEASURE_ONLY_ASSERT_TIMEOUT" <<'PY' || TARGET_RC=$?
import json
import os
import sys
import xml.etree.ElementTree as ET

(
    evidence_dir,
    summary_path,
    run_id,
    run_url,
    sha256,
    arm64_size_str,
    arm64_sha256,
    sha12,
    flow_target,
    watch_rc_str,
    blocked_list,
    measure_list,
    measure_assert_timeout,
) = sys.argv[1:14]
watch_rc = int(watch_rc_str)
blocked = {f for f in blocked_list.split() if f}
measure_only = {f for f in measure_list.split() if f}
arm64_size = int(arm64_size_str or 0)
arm64_mb = f"{arm64_size / (1024 * 1024):.2f} MB ({arm64_size} bytes)" if arm64_size > 0 else "missing"

flows = [
    "first-launch-sample",
    "import-md",
    "import-epub",
    "import-epub-broken",
    "resume-position",
    "settings-live",
    "open-with-telegram",
    "drag-page-direction",
    "scrubber-direction",
    "highlight-add",
    "footnote-popover",
    "rotate-position",
    "keep-awake",
    "long-book-open",
    "jump-back",
]

status_map = {}
status_file = os.path.join(evidence_dir, "status.tsv")
if os.path.isfile(status_file):
    with open(status_file, encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3:
                fid, result, detail = parts[0], parts[1], parts[2]
                status_map[fid] = (result, detail)

junit_dir = os.path.join(evidence_dir, "junit")
for fid in flows:
    junit_path = os.path.join(junit_dir, f"{fid}.xml")
    if fid not in status_map and os.path.isfile(junit_path):
        try:
            tree = ET.parse(junit_path)
            root = tree.getroot()
            failures = 0
            errors = 0
            for suite in ([root] if root.tag == "testsuite" else root.findall(".//testsuite")):
                failures += int(suite.attrib.get("failures", 0))
                errors += int(suite.attrib.get("errors", 0))
            res = "PASS" if (failures == 0 and errors == 0) else "FAIL"
            status_map[fid] = (res, f"junit failures={failures} errors={errors}")
        except Exception as exc:
            status_map[fid] = ("FAIL", f"junit parse error: {exc}")

csp_status = "UNKNOWN"
csp_file = os.path.join(evidence_dir, "logs", "csp-check.txt")
if os.path.isfile(csp_file):
    with open(csp_file, encoding="utf-8") as fh:
        csp_status = fh.read().strip() or "UNKNOWN"


def measured_open(fid):
    """The product number a measure-only flow recorded.

    Maestro writes one JSON per journey into `logs/<flow>-commands.json`; the opening budget is
    the `assertCondition` that carries the 2 s timeout. Its `duration` is the only honest
    measurement we have of "first page on screen", so it is what the summary quotes — even when
    the assertion failed, where the duration is how long the runner waited before giving up.
    """
    path = os.path.join(evidence_dir, "logs", f"{fid}-commands.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            commands = json.load(fh)
    except Exception:
        return None
    for entry in commands:
        if not isinstance(entry, dict):
            continue
        meta = entry.get("metadata") or {}
        evaluated = meta.get("evaluatedCommand") or entry.get("command") or {}
        if not isinstance(evaluated, dict):
            continue
        node = None
        for key, value in evaluated.items():
            if str(key).lower().startswith("assertcondition"):
                node = value
                break
        if not isinstance(node, dict):
            continue
        if str(node.get("timeout")) != measure_assert_timeout:
            continue
        duration = meta.get("duration")
        return {
            "status": meta.get("status"),
            "duration_ms": duration if isinstance(duration, (int, float)) else None,
        }
    return None


lines = [
    f"# Rewiaty Maestro Flows Summary (`{sha12}`)",
    "",
    f"- **Actions Run:** {run_url}",
    f"- **Run ID:** `{run_id}`",
    f"- **APK SHA256:** `{sha256}`",
    f"- **ARM64 APK Size:** {arm64_mb}",
    f"- **ARM64 APK SHA256:** `{arm64_sha256}`",
    f"- **Requested Target:** `{flow_target}`",
    f"- **Workflow Exit Code:** `{watch_rc}`",
    f"- **CSP / Amiri Font Check:** {csp_status}",
    "",
    "| Flow | Status | Details |",
    "|---|---|---|",
]

for fid in flows:
    recorded = status_map.get(fid)
    res, detail = recorded if recorded else ("MISSING", "no result recorded")
    if fid in measure_only:
        measurement = measured_open(fid)
        if measurement and measurement["duration_ms"] is not None:
            recorded_status = measurement["status"] or "UNKNOWN"
            detail = (
                f"opened in {measurement['duration_ms']} ms against a "
                f"{measure_assert_timeout} ms product target (assert {recorded_status}); "
                "measured, not a gate"
            )
        elif measurement:
            detail = f"{detail}; the {measure_assert_timeout} ms assert recorded no duration"
        else:
            detail = f"{detail}; no {measure_assert_timeout} ms assert in the command log"
        res = f"MEASURE-ONLY {res}"
    lines.append(f"| `{fid}` | **{res}** | {detail} |")

with open(summary_path, "w", encoding="utf-8") as out:
    out.write("\n".join(lines) + "\n")

notes = []
if blocked:
    notes.append(
        "- Blocked (reported, not a gate): "
        + ", ".join(f"`{b}`" for b in sorted(blocked))
        + " — F3 rotation waits on a product decision (landscape may become tablet-only; "
        "`apps/mobile/app.json` still locks the phone to portrait)."
    )
if measure_only:
    notes.append(
        "- Measure-only (reported, never a gate): "
        + ", ".join(f"`{m}`" for m in sorted(measure_only))
        + f" — the {measure_assert_timeout} ms open budget is a product target and the emulator "
        "runner's load moves it by seconds between runs, so the journey measures and prints the "
        "number instead of deciding red/green. Speeding the open up is its own ticket."
    )
if notes:
    lines.append("")
    lines.extend(notes)
    with open(summary_path, "w", encoding="utf-8") as out:
        out.write("\n".join(lines) + "\n")

# A green verdict needs every REQUESTED gating flow to have a recorded PASS (a missing artifact
# means MISSING, never PASS). Blocked and measure-only flows are reported in the table but never
# gate: their FAIL keeps the emulator step red, so a red workflow is only accepted when one of
# them is the reason. A measure-only flow must still have PRODUCED a result — no evidence at all
# is treated as missing, because "we did not measure" is not the same as "we measured and it was
# slow".
targets = flows if flow_target == "all" else [flow_target]
gated = [f for f in targets if f not in blocked and f not in measure_only]
all_gated_pass = all(status_map.get(f, ("MISSING", ""))[0] == "PASS" for f in gated)
missing_measure = [f for f in targets if f in measure_only and status_map.get(f, ("MISSING", ""))[0] == "MISSING"]
non_gating = blocked | measure_only
red_explained_by_non_gating = (watch_rc != 0) and any(
    status_map.get(f, ("MISSING", ""))[0] != "PASS" for f in targets if f in non_gating
)
ok = all_gated_pass and not missing_measure and (watch_rc == 0 or red_explained_by_non_gating)

sys.exit(0 if ok else 1)
PY

echo "==> Summary written to $SUMMARY_PATH"
cat "$SUMMARY_PATH"

if [ "$TARGET_RC" -ne 0 ]; then
  echo "ERROR: Flow verification failed for target '$FLOW_TARGET'." >&2
  exit 1
fi

if [ "$FLOW_TARGET" = "all" ] || is_blocked "$FLOW_TARGET"; then
  echo "==> NOTE: ${BLOCKED_FLOWS[*]} is blocked on a product decision and is not a gate."
fi
if [ "$FLOW_TARGET" = "all" ] || is_measure_only "$FLOW_TARGET"; then
  echo "==> NOTE: ${MEASURE_ONLY_FLOWS[*]} is measure-only (${MEASURE_ONLY_ASSERT_TIMEOUT} ms product target): its number is printed, it never gates."
fi
echo "==> Flow verification PASSED for target '$FLOW_TARGET'."
