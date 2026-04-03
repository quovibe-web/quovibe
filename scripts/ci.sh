#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════
#   quovibe CI Pipeline
#   Steps 1-4: typecheck, governance, architecture, tests
#   Step 5 (optional): Playwright E2E (requires --e2e flag)
# ═══════════════════════════════════════

# Minimum test count — prevents silent test deletion.
# Update this number when adding new tests. See docs/audit/ci/CI-RUNBOOK.md.
MIN_TEST_COUNT=1429

SECONDS=0
STEP=0
FAILURES=0

step() {
  STEP=$((STEP + 1))
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  [$STEP] $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

fail() {
  echo "  FAILED: $1"
  FAILURES=$((FAILURES + 1))
  echo ""
  echo "CI FAILED at step $STEP ($1) after ${SECONDS}s"
  exit 1
}

echo "═══════════════════════════════════════"
echo "  quovibe CI Pipeline"
echo "═══════════════════════════════════════"

# ─── Step 1: Typecheck (pnpm build = tsc for all packages) ───
step "Typecheck (pnpm build)"
if pnpm build 2>&1 | tail -5; then
  echo "  OK"
else
  fail "typecheck"
fi

# ─── Step 2: Lint ───
step "Lint (pnpm lint)"
if pnpm lint 2>&1 | tail -5; then
  echo "  OK"
else
  fail "lint"
fi

# ─── Step 3: Governance checks ───
step "Governance checks"
if pnpm check:governance 2>&1 | tail -5; then
  echo "  OK"
else
  fail "governance"
fi

# ─── Step 4: Architecture checks ───
step "Architecture checks"
if pnpm check:arch 2>&1 | tail -5; then
  echo "  OK"
else
  fail "architecture"
fi

# ─── Step 5: Vitest (all packages including audit suites) ───
step "Vitest — all packages"

# Run with JSON reporter to capture test count, plus verbose for human output
TEST_OUTPUT=$(pnpm test --reporter=verbose 2>&1) || {
  echo "$TEST_OUTPUT" | tail -20
  fail "vitest"
}
echo "$TEST_OUTPUT" | tail -10

# Extract test count from Vitest output (e.g. "1323 passed")
ACTUAL_COUNT=$(echo "$TEST_OUTPUT" | grep -oP '\d+(?= passed)' | tail -1)

if [ -z "$ACTUAL_COUNT" ]; then
  echo "  WARNING: Could not parse test count from Vitest output"
  ACTUAL_COUNT=0
fi

echo ""
echo "  Test count: $ACTUAL_COUNT (minimum: $MIN_TEST_COUNT)"

if [ "$ACTUAL_COUNT" -lt "$MIN_TEST_COUNT" ]; then
  echo "  GUARD FAILED: expected >= $MIN_TEST_COUNT tests, got $ACTUAL_COUNT"
  echo "  This usually means tests were accidentally deleted."
  echo "  If tests were intentionally removed, update MIN_TEST_COUNT in scripts/ci.sh"
  fail "test-count-guard"
fi
echo "  Test count guard: OK"

# ─── Step 6: Playwright E2E (optional, requires --e2e flag) ───
if [[ "${1:-}" == "--e2e" ]]; then
  step "Playwright E2E"
  if pnpm test:e2e 2>&1 | tail -20; then
    echo "  OK"
  else
    fail "playwright-e2e"
  fi
else
  echo ""
  echo "  (Skipping Playwright E2E — pass --e2e to include)"
fi

# ─── Summary ───
echo ""
echo "═══════════════════════════════════════"
echo "  CI PASSED"
echo "  Steps: $STEP"
echo "  Tests: $ACTUAL_COUNT (guard: >= $MIN_TEST_COUNT)"
echo "  Time:  ${SECONDS}s"
echo "═══════════════════════════════════════"
