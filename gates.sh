#!/usr/bin/env bash
set -euo pipefail

echo "==> 0/7 Script tests (device-flow list + push release preflight)"
bash scripts/__tests__/ci-flows-list.sh
bash scripts/__tests__/push-preflight.sh

echo "==> 1/7 Typecheck"
npm run typecheck

echo "==> 2/7 Unit tests (Vitest)"
npm test

echo "==> 3/7 Build reader-engine (esbuild)"
npm run build

echo "==> 4/7 E2E tests (Playwright Chromium)"
npm run test:e2e

echo "==> 5/7 Mobile assets & typecheck"
npm --workspace=@rewiaty/mobile run prebuild:assets
npm --workspace=@rewiaty/mobile run typecheck

echo "==> 6/7 Mobile unit/component tests (Jest)"
npm --workspace=@rewiaty/mobile test

echo "==> 7/7 Mobile export (Android)"
(cd apps/mobile && CI=1 npx expo export --platform android --output-dir dist)

echo "ALL GATES PASSED"
