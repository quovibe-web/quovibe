#!/usr/bin/env bash
# check-docs-alignment.sh
# Checks that source files in key directories are mentioned in monorepo-structure.md.
# Direction: filesystem → doc (complements check-governance.ts which goes doc → filesystem).
# Always exits 0 — non-blocking, warnings only.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
DOC="$REPO_ROOT/docs/architecture/monorepo-structure.md"
WARNINGS=0

check() {
  local file="$1"
  local basename
  basename=$(basename "$file")
  if ! grep -q "$basename" "$DOC"; then
    echo "  ⚠️  $basename not documented in $DOC"
    WARNINGS=$((WARNINGS + 1))
  fi
}

# ── API routes ────────────────────────────────────────────────
for f in "$REPO_ROOT"/packages/api/src/routes/*.ts; do
  [ -e "$f" ] || continue
  check "$f"
done

# ── API services ──────────────────────────────────────────────
for f in "$REPO_ROOT"/packages/api/src/services/*.ts; do
  [ -e "$f" ] || continue
  check "$f"
done

# ── Web API hooks ─────────────────────────────────────────────
for f in "$REPO_ROOT"/packages/web/src/api/*.ts; do
  [ -e "$f" ] || continue
  check "$f"
done

# ── Web hooks (including PascalCase: useColumnVisibility, useInvestmentsColumns, etc.) ──
for f in "$REPO_ROOT"/packages/web/src/hooks/*.ts "$REPO_ROOT"/packages/web/src/hooks/*.tsx; do
  [ -e "$f" ] || continue
  check "$f"
done

# ── Summary ───────────────────────────────────────────────────
echo ""
if [ "$WARNINGS" -gt 0 ]; then
  echo "  ⚠️  $WARNINGS undocumented file(s) found."
  echo "     Update docs/architecture/monorepo-structure.md before merging."
else
  echo "  ✅ Docs alignment OK"
fi

exit 0
