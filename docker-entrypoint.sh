#!/bin/sh
# Bootstrap: copy empty schema to portfolio.db if it doesn't exist or has no valid tables
DB_PATH="${DB_PATH:-/app/data/portfolio.db}"
SCHEMA_SRC="/app/bootstrap/schema.db"

needs_bootstrap() {
  [ ! -f "$DB_PATH" ] && return 0
  # Check if the DB has the account table (valid schema); uses python3 (already in image)
  COUNT=$(python3 -c "
import sqlite3, sys
try:
    c = sqlite3.connect('$DB_PATH')
    r = c.execute(\"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='account'\").fetchone()[0]
    print(r)
except:
    print(0)
" 2>/dev/null || echo "0")
  [ "$COUNT" = "0" ]
}

if needs_bootstrap && [ -f "$SCHEMA_SRC" ]; then
  echo "[quovibe] Initializing DB from schema..."
  mkdir -p "$(dirname "$DB_PATH")"
  cp "$SCHEMA_SRC" "$DB_PATH"
fi
exec node packages/api/index.js
