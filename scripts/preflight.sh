#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════"
echo "  quovibe Preflight — Governance 2.0"
echo "═══════════════════════════════════════"
echo ""

echo "▶ [1/5] Build all packages..."
if pnpm build 2>&1 | tail -5; then
  echo "  ✅ Build OK"
else
  echo "  ❌ BUILD FAILED — fix before starting"
  exit 1
fi
echo ""

echo "▶ [2/5] Test suite..."
if pnpm test --reporter=dot 2>&1 | tail -5; then
  echo "  ✅ Test suite OK"
else
  echo "  ❌ TESTS FAILED — fix before starting"
  exit 1
fi
echo ""

echo "▶ [3/5] Lint engine..."
if pnpm lint:engine 2>&1 | tail -10; then
  echo "  ✅ Lint engine OK"
else
  echo "  ❌ ENGINE LINT FAILED — fix before starting"
  exit 1
fi
echo ""

echo "▶ [4/5] Governance checks..."
if [ -f scripts/check-governance.ts ]; then
  pnpm check:governance 2>&1 | tail -30
else
  echo "  ⚠️  scripts/check-governance.ts not found — skipping (local-only dev script)"
fi
echo ""

echo "▶ [5/5] Architecture checks..."
if [ -f scripts/check-architecture.ts ]; then
  pnpm check:arch 2>&1 | tail -30
else
  echo "  ⚠️  scripts/check-architecture.ts not found — skipping (local-only dev script)"
fi
echo ""

# Save session start marker
mkdir -p .claude
git rev-parse HEAD > .claude/.session-start
echo "  📌 Session marker saved at $(cat .claude/.session-start)"
echo ""

echo "═══════════════════════════════════════"
echo "  Preflight complete — ready to work"
echo "═══════════════════════════════════════"
