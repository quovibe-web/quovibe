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
-- Used as the schema source for tests and demo generation.
-- Applied AFTER ppxml2db.py during import-pp-xml (see ADR-015 §3.4) so
--   the vendor DDL runs on an empty DB without "table already exists" errors.
--
-- ⚠️ LOAD-BEARING ORDERING INVARIANT ⚠️
--   The import-pp-xml pipeline is ORDER-SENSITIVE: ppxml2db.py must run
--   FIRST against an empty file, THEN this script runs against the populated
--   file. Running this script first would pre-create ppxml2db's tables, and
--   ppxml2db.py's own CREATE TABLE statements (which LACK "IF NOT EXISTS")
--   would then fail with "table already exists".
--   If vendored ppxml2db is ever upgraded from a new upstream, re-verify
--   this invariant manually — see the spec §3.4 for the test command.
--
-- Deviations from raw ppxml2db_init.py output:
--   - IF NOT EXISTS added to every CREATE TABLE / CREATE INDEX.
--     Purpose: allow idempotent re-runs on already-populated DBs.
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS is allowed for future column
--     additions (SQLite 3.35+; better-sqlite3 12.8 is well past that).
-- ═══════════════════════════════════════════════════════════════════════

-- §1+§2 ppxml2db tables and indexes (verbatim from ppxml2db_init.py + IF NOT EXISTS)
HEADER

cat "$TMP/regen-guarded.sql" >> "$BOOTSTRAP"
echo "" >> "$BOOTSTRAP"
cat "$TMP/quovibe.sql" >> "$BOOTSTRAP"

echo "Regenerated $BOOTSTRAP. Review the diff before committing."
