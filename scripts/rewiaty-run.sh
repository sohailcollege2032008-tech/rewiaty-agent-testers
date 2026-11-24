#!/usr/bin/env bash
# One command to put an APK through the AI testers of this repo.
# Usage: bash scripts/rewiaty-run.sh <apk url | local .apk path> [personas] [extra gh -f inputs...]
#   bash scripts/rewiaty-run.sh https://.../app.apk layla
#   bash scripts/rewiaty-run.sh ~/builds/rewiaty.apk layla,grace -f brief=briefs/improve.md
# The APK is never committed: a local file goes to the "rewiaty-apk" release of this repo.
set -euo pipefail
REPO=sohailcollege2032008-tech/rewiaty-agent-testers
SOURCE=${1:?usage: rewiaty-run.sh <apk url | local .apk> [personas] [extra inputs]}
PERSONAS=${2:-layla}
shift "$(( $# > 2 ? 2 : $# ))"
TAG=rewiaty-apk

case "$SOURCE" in
  http://* | https://*) URL=$SOURCE ;;
  *)
    [ -f "$SOURCE" ] || { echo "Not a file and not a URL: $SOURCE" >&2; exit 1; }
    NAME=$(basename "$SOURCE")
    gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 ||
      gh release create "$TAG" -R "$REPO" --title "Rewiaty APK" --notes "APK built outside this repo, tested by the AI testers" >/dev/null
    gh release upload "$TAG" "$SOURCE" -R "$REPO" --clobber >/dev/null
    URL="https://github.com/$REPO/releases/download/$TAG/$NAME"
    echo "APK uploaded: $URL" ;;
esac

gh workflow run agent-testers.yml -R "$REPO" \
  -f android_personas="$PERSONAS" \
  -f ios_personas=none \
  -f app_dir=. \
  -f app_id="${REWIATY_APP_ID:-com.sohailcollege.rewiaty}" \
  -f android_build="curl -fsSL -o rewiaty.apk '$URL'" \
  -f apk_path=rewiaty.apk \
  -f model=deepseek-v4.1-flash \
  -f llm_base_url=https://opencode.ai/zen/go \
  "$@"

sleep 5
RUN=$(gh run list -R "$REPO" --workflow agent-testers.yml -L 1 --json databaseId -q '.[0].databaseId')
echo "Run $RUN: https://github.com/$REPO/actions/runs/$RUN"
echo "Follow it:   gh run watch $RUN -R $REPO"
echo "Get results: bash scripts/collect.sh $RUN"
