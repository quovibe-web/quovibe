// packages/api/src/db/apply-bootstrap.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import { cleanupCsvDuplicates } from './csv-dedupe-cleanup';
import { getRate } from '../services/fx.service';
import { isValidIso4217 } from '../services/portfolio-base.service';

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
  { table: 'price',            column: 'open',   type: 'BIGINT' },
  { table: 'price',            column: 'high',   type: 'BIGINT' },
  { table: 'price',            column: 'low',    type: 'BIGINT' },
  { table: 'price',            column: 'volume', type: 'BIGINT' },
  { table: 'latest_price',     column: 'open',   type: 'BIGINT' },
  { table: 'latest_price',     column: 'high',   type: 'BIGINT' },
  { table: 'latest_price',     column: 'low',    type: 'BIGINT' },
  { table: 'latest_price',     column: 'volume', type: 'BIGINT' },
  // Source tagging for FX rates: distinguishes user-entered MANUAL rates from
  // ECB/Yahoo-fetched rates so the ECB writer can skip MANUAL rows on conflict.
  // Existing rows on pre-patch DBs receive the default 'ECB' via ALTER TABLE.
  { table: 'vf_exchange_rate', column: 'source', type: "TEXT NOT NULL DEFAULT 'ECB'" },
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
 * Backfills synthetic `xact_unit` GROSS_VALUE rows for cross-currency
 * BUY/SELL/DIVIDENDS/DELIVERY_INBOUND/DELIVERY_OUTBOUND trades that lack
 * any FX-decorated unit (older PP-XML imports, pre-fix manual entries).
 * Looks up the historical rate from `vf_exchange_rate` at the trade
 * date and synthesises a unit with the security-currency gross stored
 * in `forex_amount` and the deposit→security rate in `exchangeRate`.
 * See docs/architecture/multi-currency.md for the full resolution
 * priority.
 *
 * Idempotent + dual-writer safe: the existence check matches ANY unit
 * carrying `forex_currency = security.currency AND forex_amount IS NOT NULL`,
 * regardless of `type`. ppxml2db emits PP's `type='GROSS_VALUE'` from
 * the XML attribute; quovibe-native writes via `transaction.service.ts`
 * emit `type='FOREX'`. Same payload — discriminating by label would
 * cause duplicate synthetic rows (doubled cost basis) when bootstrap
 * runs on a DB containing quovibe-native FOREX-decorated trades.
 *
 * Trades for which `vf_exchange_rate` has no rate at the trade date
 * are skipped (logged once per pair per run) — the per-security perf
 * path will continue to consume those rows in deposit currency
 * (mathematically wrong but no crash; UI follow-up will surface them
 * for manual rate entry).
 *
 * Steady-state cost is O(0): the SELECT walks only the small set of
 * cross-currency trades and the WHERE clause filters out the ones that
 * already have any FX-decorated unit.
 */
function backfillCrossCurrencyGrossUnits(db: BetterSqlite3.Database): void {
  // Pre-condition: xact + xact_unit + security all exist on the schema.
  // Skip silently if not (the bootstrap step would have errored first
  // anyway, but a tablecheck keeps the helper independently safe).
  const sentinel = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('xact','xact_unit','security')",
    )
    .all() as unknown[];
  if (sentinel.length < 3) return;

  // Eligible types: only the ones whose per-security perf needs the
  // security-currency gross for FIFO/cashflow inputs. Cash-only types
  // (DEPOSIT/REMOVAL/INTEREST/FEES/TAXES) are excluded — they stay on
  // the deposit-currency cash-balance path.
  const ELIGIBLE_TYPES = [
    'BUY',
    'SELL',
    'DIVIDEND',
    'DIVIDENDS',
    'DELIVERY_INBOUND',
    'DELIVERY_OUTBOUND',
    'TRANSFER_IN',
    'TRANSFER_OUT',
  ];
  const placeholders = ELIGIBLE_TYPES.map(() => '?').join(',');

  const candidates = db
    .prepare(
      `SELECT x.uuid AS xact, x.date, x.currency AS deposit_currency,
              x.amount AS amount_hecto,
              s.currency AS security_currency
         FROM xact x
         JOIN security s ON s.uuid = x.security
        WHERE x.security IS NOT NULL
          AND x.type IN (${placeholders})
          AND x.currency IS NOT NULL
          AND s.currency IS NOT NULL
          AND x.currency != s.currency
          AND x.amount IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM xact_unit u
             WHERE u.xact = x.uuid
               AND u.type IN ('GROSS_VALUE', 'FOREX')
               AND u.forex_currency = s.currency
               AND u.forex_amount IS NOT NULL
          )`,
    )
    .all(...ELIGIBLE_TYPES) as Array<{
    xact: string;
    date: string;
    deposit_currency: string;
    amount_hecto: number;
    security_currency: string;
  }>;

  if (candidates.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
     VALUES (?, 'GROSS_VALUE', ?, ?, ?, ?, ?)`,
  );

  let inserted = 0; // native-ok
  const unresolvedPairs = new Map<string, { count: number; firstDate: string; lastDate: string }>();
  const tx = db.transaction(() => {
    for (const c of candidates) {
      const tradeDate = c.date.slice(0, 10);
      const rate = getRate(db, c.deposit_currency, c.security_currency, tradeDate);
      if (rate == null || rate.isZero()) {
        const key = `${c.deposit_currency}->${c.security_currency}`;
        const entry = unresolvedPairs.get(key);
        if (entry) {
          entry.count++; // native-ok
          if (tradeDate < entry.firstDate) entry.firstDate = tradeDate;
          if (tradeDate > entry.lastDate) entry.lastDate = tradeDate;
        } else {
          unresolvedPairs.set(key, { count: 1, firstDate: tradeDate, lastDate: tradeDate });
        }
        continue;
      }
      const forexAmountHecto = Math.round(
        rate.times(c.amount_hecto).toNumber(),
      );
      insert.run(
        c.xact,
        c.amount_hecto,
        c.deposit_currency,
        forexAmountHecto,
        c.security_currency,
        rate.toString(),
      );
      inserted++; // native-ok
    }
  });
  tx();

  const totalUnresolved = [...unresolvedPairs.values()].reduce((s, e) => s + e.count, 0); // native-ok
  if (inserted > 0 || totalUnresolved > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[multi-currency-backfill] inserted ${inserted} GROSS_VALUE FOREX unit(s); ${totalUnresolved} unresolved`,
    );
    if (totalUnresolved > 0) {
      for (const [pair, info] of unresolvedPairs) {
        // eslint-disable-next-line no-console
        console.warn(
          `[multi-currency-backfill]   ${pair}: ${info.count} trade(s) between ${info.firstDate} and ${info.lastDate} — vf_exchange_rate missing this pair for the period`,
        );
      }
    }
  }
}

/**
 * Seeds `vf_portfolio_meta.baseCurrency` on first bootstrap.
 *
 * Priority chain (mirrors portfolio-base.service.ts getBaseCurrency):
 *   1. Already set — idempotent, returns immediately without clobbering.
 *   2. Primary deposit account currency (lowest _order, then lowest _id),
 *      gated through isValidIso4217.
 *   3. First security currency (lowest _id), gated through isValidIso4217.
 *   4. Literal 'EUR' fallback.
 *
 * Each candidate is validated against the ISO-4217 regex before being
 * written to meta — defense in depth so a malformed legacy
 * account.currency / security.currency value (lowercase, empty string,
 * non-standard code) doesn't pollute the meta row. Without the gate
 * the runtime get-path in portfolio-base.service.ts would silently
 * bypass the garbage on reads but it would persist on disk.
 *
 * This ensures every portfolio has a baseCurrency in meta immediately
 * after bootstrap, so the runtime get-path always finds a stored value
 * rather than recomputing from scratch.
 *
 * Priority for the canonical value:
 *   1. property.baseCurrency  — written by ppxml2db for PP-XML imports; most
 *      authoritative source for imported portfolios.
 *   2. First deposit account currency (lowest _order).
 *   3. First security currency (lowest _id).
 *   4. Literal 'EUR' fallback.
 *
 * If a valid meta row already exists AND property either agrees or is absent,
 * we return early (idempotent). If property.baseCurrency disagrees with the
 * existing meta value, we overwrite meta — this migrates portfolios that were
 * seeded from account.currency before this priority was introduced.
 */
function seedPortfolioBaseCurrency(db: BetterSqlite3.Database): void {
  // Step 0 — read PP-declared baseCurrency from the property table (ppxml2db writes this).
  const prop = db
    .prepare(`SELECT value FROM property WHERE name='baseCurrency'`)
    .get() as { value: string } | undefined;
  const propCurrency = prop?.value && isValidIso4217(prop.value) ? prop.value : undefined;

  // Step 1 — check existing meta row.
  const existing = db
    .prepare(`SELECT value FROM vf_portfolio_meta WHERE key='baseCurrency'`)
    .get() as { value: string } | undefined;

  if (existing !== undefined && isValidIso4217(existing.value ?? '')) {
    // Valid meta already present. If property agrees (or doesn't exist), done.
    if (!propCurrency || propCurrency === existing.value) return;
    // property.baseCurrency differs — overwrite meta with the authoritative PP value.
    db.prepare(`UPDATE vf_portfolio_meta SET value = ? WHERE key = 'baseCurrency'`).run(propCurrency);
    console.log(`[multi-currency] corrected baseCurrency=${propCurrency} (was ${existing.value})`);
    return;
  }

  // Step 2-4 — no valid meta row; seed from best available source.
  let baseCurrency: string | undefined = propCurrency;

  if (!baseCurrency) {
    const acct = db
      .prepare(
        `SELECT currency FROM account
         WHERE type='account' AND currency IS NOT NULL
         ORDER BY _order ASC, _id ASC LIMIT 1`,
      )
      .get() as { currency: string } | undefined;
    baseCurrency = acct?.currency && isValidIso4217(acct.currency) ? acct.currency : undefined;
  }

  if (!baseCurrency) {
    const sec = db
      .prepare(
        `SELECT currency FROM security
         WHERE currency IS NOT NULL
         ORDER BY _id ASC LIMIT 1`,
      )
      .get() as { currency: string } | undefined;
    baseCurrency = sec?.currency && isValidIso4217(sec.currency) ? sec.currency : undefined;
  }

  if (!baseCurrency) baseCurrency = 'EUR';

  // INSERT OR IGNORE: defense-in-depth against a concurrent open or a row with
  // an invalid value that slipped past the guard above.
  db.prepare(
    `INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', ?)`,
  ).run(baseCurrency);
  console.log(`[multi-currency] seeded baseCurrency=${baseCurrency}`);
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
 *   6. backfillCrossCurrencyGrossUnits — synthesises GROSS_VALUE FOREX
 *      units for pre-existing cross-currency trades that lack them
 *   7. seedPortfolioBaseCurrency — writes/corrects vf_portfolio_meta.baseCurrency.
 *      Priority: property.baseCurrency (PP-declared) > account > security > EUR.
 *      Migrates portfolios whose meta was seeded from account.currency before
 *      property.baseCurrency was consulted. Uses INSERT OR IGNORE + UPDATE so
 *      it is safe on any DB state.
 *
 * Steps 3–7 are all no-ops on a fresh DB after first run (property, meta, and
 * account agree, so the currency step returns early).
 */
export function applyBootstrap(db: BetterSqlite3.Database): void {
  db.exec(BOOTSTRAP_SQL);
  addMissingColumns(db);
  cleanupCsvDuplicates(db);
  ensureCsvDedupeIndex(db);
  cleanupCsvConfigsCrossAccount(db);
  backfillCrossCurrencyGrossUnits(db);
  seedPortfolioBaseCurrency(db);
}
