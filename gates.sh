#!/usr/bin/env bash
set -euo pipefail

echo "==> 1/4 Typecheck"
npm run typecheck

echo "==> 2/4 Unit tests (Vitest)"
npm test

echo "==> 3/4 Build reader-engine (esbuild)"
npm run build

echo "==> 4/4 E2E tests (Playwright Chromium)"
npm run test:e2e

echo "ALL GATES PASSED"
