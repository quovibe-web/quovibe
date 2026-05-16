// packages/api/src/db/apply-bootstrap.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import { cleanupCsvDuplicates } from './csv-dedupe-cleanup';

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
 * Two sources need columns the vendor SQL doesn't list:
 *  - `ppxml2db.py > handle_latest` extracts high/low/volume from each
 *    <latest> XML node (latest_price.{high,low,volume}).
 *  - The quovibe CSV price wizard (`executePriceImport`) writes Open + OHLCV
 *    onto both `price` and `latest_price` so user-supplied historical bars
 *    can drive candlestick charts for securities that have no live ticker
 *    (crowdlending, private equity). `handle_price` does not populate these
 *    today — they stay NULL on PP-XML imports until the upstream parser is
 *    extended.
 *
 * Stored as price-scaled integers (× 10^8) to match `price.value`. Existing
 * rows on contaminated DBs are left NULL (ALTER TABLE ADD COLUMN default).
 */
interface VendorColumnPatch {
  table: string;
  column: string;
  type: string;
}

const VENDOR_COLUMN_PATCHES: readonly VendorColumnPatch[] = [
  { table: 'price',        column: 'open',   type: 'BIGINT' },
  { table: 'price',        column: 'high',   type: 'BIGINT' },
  { table: 'price',        column: 'low',    type: 'BIGINT' },
  { table: 'price',        column: 'volume', type: 'BIGINT' },
  { table: 'latest_price', column: 'open',   type: 'BIGINT' },
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
 * Installs the partial unique index that backs CSV re-import dedupe.
 *
 * Why runtime DDL rather than a CREATE INDEX in bootstrap.sql §4: the SQL
 * file is applied via a single `db.exec(BOOTSTRAP_SQL)` call. If the index
 * creation raises (a contaminated DB still holds divergent CSV duplicates
 * that cleanupCsvDuplicates left alone), the entire exec aborts mid-script
 * and bootstrap leaves the DB in a half-applied state. Runtime DDL lets us
 * try/catch the index step independently and keep the app usable.
 *
 * The index itself is a partial unique constraint scoped to
 * source='CSV_IMPORT' so that legitimate manual or PP-XML duplicates are
 * unaffected.
 */
function ensureCsvDedupeIndex(db: BetterSqlite3.Database): void {
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_xact_csv_natural_key
        ON xact (date, type, security, account, shares, amount)
        WHERE source = 'CSV_IMPORT';
    `);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bootstrap] idx_xact_csv_natural_key install deferred — divergent CSV duplicates remain, manual cleanup required: ${(err as Error).message}`,
    );
  }
}

/**
 * Strips the legacy `crossAccount` key from any saved CSV-import config's
 * nested `columnMapping` JSON.
 *
 * Background: the original CSV importer let the user map a single column
 * containing a raw account UUID to `crossAccount`. That mechanism was
 * effectively unusable for normal users (UUIDs in spreadsheets) and is
 * superseded by the per-row NAME-resolved 4-column system. Any pre-existing
 * saved config still carrying `crossAccount` in its `columnMapping` blob
 * is dropped here so the CSV wizard doesn't render a UI control for a
 * key the new mapper ignores.
 *
 * Schema reminder (bootstrap.sql §3): vf_csv_import_config holds
 * `id, name, type, config, createdAt, updatedAt` — `columnMapping` lives
 * INSIDE the JSON `config` blob, not as a top-level column. We parse the
 * blob, mutate `columnMapping`, and re-serialize.
 *
 * Idempotent: re-running on a clean DB is a no-op (no rows have
 * `crossAccount` in their mapping). Defensive against malformed JSON
 * (skip + continue rather than throwing — a corrupt row shouldn't
 * brick app start).
 */
function cleanupCsvConfigsCrossAccount(db: BetterSqlite3.Database): void {
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vf_csv_import_config'",
  ).get();
  if (!tableExists) return;

  const rows = db.prepare(
    'SELECT id, config FROM vf_csv_import_config',
  ).all() as Array<{ id: string; config: string }>;

  const update = db.prepare(
    'UPDATE vf_csv_import_config SET config=? WHERE id=?',
  );
  let touched = 0; // native-ok
  for (const row of rows) {
    let parsed: { columnMapping?: Record<string, number> } & Record<string, unknown>;
    try {
      parsed = JSON.parse(row.config);
    } catch {
      continue;
    }
    const mapping = parsed.columnMapping;
    if (!mapping || typeof mapping !== 'object') continue;
    if (!('crossAccount' in mapping)) continue;
    delete mapping.crossAccount;
    update.run(JSON.stringify(parsed), row.id);
    touched++; // native-ok
  }
  if (touched > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[csv-config-cleanup] stripped legacy 'crossAccount' key from ${touched} CSV config(s)`,
    );
  }
}

/**
 * Apply the quovibe bootstrap DDL to an open SQLite handle.
 * Idempotent. Safe to call on an empty DB, a populated ppxml2db DB,
 * or a DB that already has this script's output.
 *
 * Order matters:
 *   1. bootstrap.sql — base schema (creates xact, xact_unit, etc.)
 *   2. addMissingColumns — vendor patches (latest_price OHLC)
 *   3. cleanupCsvDuplicates — collapses byte-identical CSV duplicates
 *   4. ensureCsvDedupeIndex — installs the partial unique index
 *   5. cleanupCsvConfigsCrossAccount — drops legacy CSV-config key
 *
 * Steps 3, 4, and 5 are all no-ops on a fresh DB.
 */
export function applyBootstrap(db: BetterSqlite3.Database): void {
  db.exec(BOOTSTRAP_SQL);
  addMissingColumns(db);
  cleanupCsvDuplicates(db);
  ensureCsvDedupeIndex(db);
  cleanupCsvConfigsCrossAccount(db);
}
