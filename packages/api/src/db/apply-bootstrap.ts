// packages/api/src/db/apply-bootstrap.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type BetterSqlite3 from 'better-sqlite3';

const BOOTSTRAP_SQL = readFileSync(
  join(__dirname, 'bootstrap.sql'),
  'utf-8',
);

/**
 * Additive column patches applied to vendor tables after bootstrap.sql runs.
 *
 * Keeps `packages/api/vendor/*.sql` untouched so the vendored ppxml2db init
 * schema drift-checks (Gate 1) stay clean. SQLite does not support
 * `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so we check `PRAGMA table_info` and
 * add missing columns per-run — cheap and idempotent.
 *
 * Context: `ppxml2db.py` is more expressive than its paired init `.sql` files.
 * `handle_latest` in particular extracts high/low/volume from each <latest>
 * XML node but `vendor/latest_price.sql` never listed those columns. We fill
 * the gap here so INSERTs succeed without modifying the vendored file.
 */
interface VendorColumnPatch {
  table: string;
  column: string;
  type: string;
}

const VENDOR_COLUMN_PATCHES: readonly VendorColumnPatch[] = [
  { table: 'latest_price', column: 'high',   type: 'BIGINT' },
  { table: 'latest_price', column: 'low',    type: 'BIGINT' },
  { table: 'latest_price', column: 'volume', type: 'BIGINT' },
];

function addMissingColumns(db: BetterSqlite3.Database): void {
  for (const patch of VENDOR_COLUMN_PATCHES) {
    const rows = db.prepare(`PRAGMA table_info(${patch.table})`).all() as
      Array<{ name: string }>;
    if (rows.some(r => r.name === patch.column)) continue;
    db.exec(`ALTER TABLE ${patch.table} ADD COLUMN ${patch.column} ${patch.type}`);
  }
}

/**
 * Apply the quovibe bootstrap DDL to an open SQLite handle.
 * Idempotent. Safe to call on an empty DB, a populated ppxml2db DB,
 * or a DB that already has this script's output.
 */
export function applyBootstrap(db: BetterSqlite3.Database): void {
  db.exec(BOOTSTRAP_SQL);
  addMissingColumns(db);
}
