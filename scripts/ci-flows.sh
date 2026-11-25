#!/usr/bin/env bash
set -euo pipefail

FLOW_TARGET="${1:-}"
VALID_FLOWS=("first-launch-sample" "import-md" "resume-position" "settings-live" "open-with-telegram" "footnote-popover" "rotate-position" "keep-awake" "long-book-open")
# Why: F3 rotation is blocked on a product decision (landscape may end up tablet-only, and app.json
# still locks the phone to portrait). The journey stays in the sweep so its evidence stays fresh, but
# it is NOT a gate: its FAIL is reported and does not turn the run red. Remove it from this list the
# day the product decision lands and the journey passes.
BLOCKED_FLOWS=("rotate-position")
is_blocked() {
  local f
  for f in "${BLOCKED_FLOWS[@]}"; do [ "$f" = "$1" ] && return 0; done
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
gh workflow run "$WORKFLOW_NAME" -R "$TESTERS_REPO" -f src_ref="$SRC_REF" -f flow="$FLOW_TARGET"

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
ln -sfn "$SHA12" "$ROOT_DIR/.factory/evidence/latest"
SHA256="$(cut -d' ' -f1 "$EVIDENCE_DIR/apk/apk.sha256" 2>/dev/null || echo unknown)"

SUMMARY_PATH="$EVIDENCE_DIR/summary.md"
TARGET_RC=0
BLOCKED_LIST="${BLOCKED_FLOWS[*]}"
python3 - "$EVIDENCE_DIR" "$SUMMARY_PATH" "$RUN_ID" "$RUN_URL" "$SHA256" "$SHA12" "$FLOW_TARGET" "$WATCH_RC" "$BLOCKED_LIST" <<'PY' || TARGET_RC=$?
import os
import sys
import xml.etree.ElementTree as ET

evidence_dir, summary_path, run_id, run_url, sha256, sha12, flow_target, watch_rc_str, blocked_list = sys.argv[1:10]
watch_rc = int(watch_rc_str)
blocked = {f for f in blocked_list.split() if f}

flows = [
    "first-launch-sample",
    "import-md",
    "resume-position",
    "settings-live",
    "open-with-telegram",
    "footnote-popover",
    "rotate-position",
    "keep-awake",
    "long-book-open",
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

lines = [
    f"# Rewiaty Maestro Flows Summary (`{sha12}`)",
    "",
    f"- **Actions Run:** {run_url}",
    f"- **Run ID:** `{run_id}`",
    f"- **APK SHA256:** `{sha256}`",
    f"- **Requested Target:** `{flow_target}`",
    f"- **Workflow Exit Code:** `{watch_rc}`",
    f"- **CSP / Amiri Font Check:** {csp_status}",
    "",
    "| Flow | Status | Details |",
    "|---|---|---|",
]

for fid in flows:
    res, detail = status_map.get(fid, ("MISSING", "no result recorded"))
    lines.append(f"| `{fid}` | **{res}** | {detail} |")

with open(summary_path, "w", encoding="utf-8") as out:
    out.write("\n".join(lines) + "\n")

if blocked:
    lines.append("")
    lines.append(
        "Blocked (reported, not a gate): "
        + ", ".join(f"`{b}`" for b in sorted(blocked))
        + " — F3 rotation waits on a product decision (landscape may become tablet-only; "
        "`apps/mobile/app.json` still locks the phone to portrait)."
    )
    with open(summary_path, "w", encoding="utf-8") as out:
        out.write("\n".join(lines) + "\n")

# A green verdict needs every REQUESTED flow to have a recorded PASS (a missing artifact means
# MISSING, never PASS). Blocked flows are reported in the table but never gates: their FAIL keeps the
# emulator step red, so a red workflow is only accepted when a blocked flow is the reason.
targets = flows if flow_target == "all" else [flow_target]
gated = [f for f in targets if f not in blocked]
all_gated_pass = all(status_map.get(f, ("MISSING", ""))[0] == "PASS" for f in gated)
red_explained_by_blocked = (watch_rc != 0) and any(
    status_map.get(f, ("MISSING", ""))[0] != "PASS" for f in targets if f in blocked
)
ok = all_gated_pass and (watch_rc == 0 or red_explained_by_blocked)

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
echo "==> Flow verification PASSED for target '$FLOW_TARGET'."
