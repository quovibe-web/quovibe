#!/usr/bin/env bash
# packages/api/scripts/check-bootstrap-fresh.sh
# Gate 1: bootstrap.sql §1+§2 must match current ppxml2db_init.py output.
# Fails CI if ppxml2db was upgraded and bootstrap.sql wasn't regenerated.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
VENDOR="$ROOT/packages/api/vendor"
SCRIPTS="$ROOT/packages/api/scripts"
BOOTSTRAP="$ROOT/packages/api/src/db/bootstrap.sql"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Python launcher: prefer env override, then `py` (Windows), then `python3` (Linux/macOS).
PYTHON_CMD="${PYTHON_CMD:-}"
if [[ -z "$PYTHON_CMD" ]]; then
  if command -v py >/dev/null 2>&1; then PYTHON_CMD=py
  elif command -v python3 >/dev/null 2>&1; then PYTHON_CMD=python3
  else echo "ERROR: neither 'py' nor 'python3' found on PATH" >&2; exit 127
  fi
fi

# ppxml2db_init.py reads its per-table .sql files (and imports `version`/`dbhelper`)
# via relative paths, so it must be invoked with the vendor dir as cwd.
(cd "$VENDOR" && "$PYTHON_CMD" ppxml2db_init.py "$TMP/regen.db")
node "$SCRIPTS/dump-schema.mjs" "$TMP/regen.db" > "$TMP/regen.sql"

node "$SCRIPTS/normalize-bootstrap.mjs" "$TMP/regen.sql" > "$TMP/regen-normalized.sql"
node "$SCRIPTS/normalize-bootstrap.mjs" "$BOOTSTRAP" --strip-quovibe-section > "$TMP/committed-normalized.sql"

if ! diff -u "$TMP/regen-normalized.sql" "$TMP/committed-normalized.sql"; then
  echo ""
  echo "ERROR: bootstrap.sql §1+§2 is out of sync with ppxml2db_init.py."
  echo "Run 'pnpm regen-bootstrap' to regenerate, or re-run this script after inspecting the diff above."
  exit 1
fi

echo "OK: bootstrap.sql §1+§2 matches ppxml2db_init.py output."
