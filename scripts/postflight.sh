#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════"
echo "  quovibe Postflight — Governance 2.0"
echo "═══════════════════════════════════════"
echo ""

echo "▶ [1/5] Build all packages..."
if pnpm build 2>&1 | tail -5; then
  echo "  ✅ Build OK"
else
  echo "  ❌ BUILD FAILED — fix before closing session"
  exit 1
fi
echo ""

echo "▶ [2/5] Test suite..."
if pnpm test --reporter=dot 2>&1 | tail -5; then
  echo "  ✅ Test suite OK"
else
  echo "  ❌ TESTS FAILED — fix before closing session"
  exit 1
fi
echo ""

echo "▶ [3/5] Lint engine..."
if pnpm lint:engine 2>&1 | tail -10; then
  echo "  ✅ Lint engine OK"
else
  echo "  ❌ ENGINE LINT FAILED — fix before closing session"
  exit 1
fi
echo ""

echo "▶ [4/5] Governance + architecture checks..."
if [ -f scripts/check-governance.ts ]; then
  pnpm check:governance 2>&1 | tail -30
else
  echo "  ⚠️  scripts/check-governance.ts not found — skipping"
fi
echo ""
if [ -f scripts/check-architecture.ts ]; then
  pnpm check:arch 2>&1 | tail -30
else
  echo "  ⚠️  scripts/check-architecture.ts not found — skipping"
fi
echo ""

echo "▶ [5/5] CHANGELOG draft..."
echo ""
bash scripts/generate-changelog-entry.sh
echo ""

echo "═══════════════════════════════════════"
echo "  Postflight complete"
echo ""
echo "  Next steps:"
echo "  1. Fill in [TITLE] and [fill in] fields in the CHANGELOG draft above"
echo "  2. Insert the entry into docs/CHANGELOG-SESSIONS.md (most recent first)"
echo "  3. If engine was touched: update docs/pp-verified/implementation-verified.md"
echo "  4. If architecture decision was made: create docs/adr/ADR-NNN-*.md"
echo "═══════════════════════════════════════"
