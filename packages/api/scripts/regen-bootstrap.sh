#!/usr/bin/env bash
# packages/api/scripts/regen-bootstrap.sh
# Regenerates the §1+§2 sections of bootstrap.sql from ppxml2db_init.py.
# Preserves the §3+§4 quovibe section below the marker.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BOOTSTRAP="$ROOT/packages/api/src/db/bootstrap.sql"
VENDOR="$ROOT/packages/api/vendor"
SCRIPTS="$ROOT/packages/api/scripts"
MARKER='-- ═══ QUOVIBE SECTION BEGIN ═══'

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

# 1. Extract the quovibe section (everything from the marker line onward).
#    Guard: awk range addresses produce zero output with exit 0 when the
#    start pattern never matches. Without this check, a renamed/corrupted
#    marker would silently drop the entire quovibe §3+§4 section.
if ! grep -qF -- "$MARKER" "$BOOTSTRAP"; then
  echo "ERROR: marker not found in $BOOTSTRAP: $MARKER" >&2
  echo "Refusing to regenerate — would destroy the quovibe §3+§4 section." >&2
  exit 3
fi
awk "/^$MARKER\$/,0" "$BOOTSTRAP" > "$TMP/quovibe.sql"

# 2. Regenerate ppxml2db baseline
# ppxml2db_init.py reads its per-table .sql files (and imports `version`/`dbhelper`)
# via relative paths, so it must be invoked with the vendor dir as cwd.
(cd "$VENDOR" && "$PYTHON_CMD" ppxml2db_init.py "$TMP/regen.db")
node "$SCRIPTS/dump-schema.mjs" "$TMP/regen.db" > "$TMP/regen.sql"

# 3. Post-process: add IF NOT EXISTS to every CREATE TABLE / CREATE INDEX
sed -E '
  s/^CREATE TABLE /CREATE TABLE IF NOT EXISTS /
  s/^CREATE UNIQUE INDEX /CREATE UNIQUE INDEX IF NOT EXISTS /
  s/^CREATE INDEX /CREATE INDEX IF NOT EXISTS /
' "$TMP/regen.sql" > "$TMP/regen-guarded.sql"

# 4. Rebuild bootstrap.sql with header + regenerated §1+§2 + original quovibe section.
#    NOTE: this HEREDOC is the canonical header for bootstrap.sql. If the committed
#    bootstrap.sql's header is ever edited for documentation purposes, this HEREDOC
#    must be updated to match or the next regen will silently drop the change.
cat > "$BOOTSTRAP" <<'HEADER'
-- ═══════════════════════════════════════════════════════════════════════
-- quovibe bootstrap DDL
--
-- Applied on every openDatabase() call. Idempotent.
-- Used as the schema source for tests, demo generation, AND the import-pp-xml
--   pipeline: this script is the functional equivalent of upstream
--   `ppxml2db_init.py`, so we run it against the empty temp DB BEFORE spawning
--   `ppxml2db.py`. The converter only INSERTs — skipping this step makes the
--   first INSERT crash with `no such table: price`.
--
-- Deviations from raw ppxml2db_init.py output:
--   - IF NOT EXISTS added to every CREATE TABLE / CREATE INDEX.
--     Purpose: allow idempotent re-runs on already-populated DBs.
--   - Conditional column additions to vendor tables live in apply-bootstrap.ts
--     (SQLite does not support `ALTER TABLE ADD COLUMN IF NOT EXISTS` — the
--     check happens at the TS layer via PRAGMA table_info).
-- ═══════════════════════════════════════════════════════════════════════

-- §1+§2 ppxml2db tables and indexes (verbatim from ppxml2db_init.py + IF NOT EXISTS)
HEADER

cat "$TMP/regen-guarded.sql" >> "$BOOTSTRAP"
echo "" >> "$BOOTSTRAP"
cat "$TMP/quovibe.sql" >> "$BOOTSTRAP"

echo "Regenerated $BOOTSTRAP. Review the diff before committing."
