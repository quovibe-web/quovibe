import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import type { ManualPriceInput, TransactionWithUnits, TransactionUnit } from '@quovibe/shared';
import { TransactionType } from '@quovibe/shared';
import { getSecurityCurrencyGross } from '@quovibe/engine';
import { convertPriceToDb } from './unit-conversion';
import { syncLatestPriceFromGlobalMax } from './prices.service';

/** Upsert one price row, overwriting all columns on conflict. */
const UPSERT_PRICE_SQL = `
  INSERT INTO price (security, tstamp, value, open, high, low, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(security, tstamp) DO UPDATE SET
    value  = excluded.value,
    open   = excluded.open,
    high   = excluded.high,
    low    = excluded.low,
    volume = excluded.volume
`;

/** Convert a ManualPriceInput to DB-scaled integer fields. */
function toDbPrice(input: ManualPriceInput): {
  value: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
} {
  const conv = convertPriceToDb({
    close: new Decimal(input.value),
    open: input.open != null ? new Decimal(input.open) : undefined,
    high: input.high != null ? new Decimal(input.high) : undefined,
    low: input.low != null ? new Decimal(input.low) : undefined,
  });
  return {
    value: conv.close,
    open: conv.open ?? null,
    high: conv.high ?? null,
    low: conv.low ?? null,
    volume: input.volume ?? null,
  };
}

/**
 * Upsert one price row for the given security, then re-sync latest_price from
 * the global max-date row. An existing row on the same date is overwritten.
 * All writes run inside a single SQLite transaction.
 */
export function upsertPrice(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  input: ManualPriceInput,
): void {
  const scaled = toDbPrice(input);
  const insert = sqlite.prepare(UPSERT_PRICE_SQL);
  sqlite.transaction(() => {
    insert.run(securityId, input.date, scaled.value, scaled.open, scaled.high, scaled.low, scaled.volume);
    syncLatestPriceFromGlobalMax(sqlite, securityId);
  })();
}

/**
 * Edit an existing price row identified by (securityId, oldDate).
 *
 * - Same date: updates the row in place (value + OHLCV).
 * - Date change: deletes the old-date row, then upserts on the new date
 *   (overwriting any quote already on the new date — matches PP behaviour).
 *
 * latest_price is re-synced at the end of the transaction.
 */
export function editPrice(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  oldDate: string,
  input: ManualPriceInput,
): void {
  const scaled = toDbPrice(input);
  const del = sqlite.prepare(
    `DELETE FROM price WHERE security = ? AND tstamp = ?`,
  );
  const insert = sqlite.prepare(UPSERT_PRICE_SQL);
  sqlite.transaction(() => {
    if (oldDate !== input.date) del.run(securityId, oldDate);
    // Edit replaces the full row: open/high/low/volume default to null when omitted.
    // The edit form must pre-populate OHLCV from the existing row before submit.
    insert.run(securityId, input.date, scaled.value, scaled.open, scaled.high, scaled.low, scaled.volume);
    syncLatestPriceFromGlobalMax(sqlite, securityId);
  })();
}

/** Delete the given date rows (single or many), then re-sync latest_price. */
export function deletePrices(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  dates: string[],
): void {
  if (dates.length === 0) return;
  const del = sqlite.prepare(`DELETE FROM price WHERE security = ? AND tstamp = ?`);
  sqlite.transaction(() => {
    for (const d of dates) del.run(securityId, d);
    syncLatestPriceFromGlobalMax(sqlite, securityId);
  })();
}

/** Delete all price rows for the security and clear its latest_price. */
export function deleteAllPrices(
  sqlite: BetterSqlite3.Database,
  securityId: string,
): void {
  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM price WHERE security = ?`).run(securityId);
    syncLatestPriceFromGlobalMax(sqlite, securityId); // no rows => clears latest_price
  })();
}

// ─── Derive prices from transactions ────────────────────────────────────────

interface RawTradeRow {
  uuid: string;
  type: string;
  date: string;
  shares: number;
  amount: number;
  currency: string | null;
}

interface RawUnitRow {
  xact: string;
  type: string;
  amount: number;
  currency: string | null;
  forex_amount: number | null;
  forex_currency: string | null;
  exchangeRate: string | null;
}

export interface DeriveResult {
  written: number;
  skipped: number;
}

/**
 * Derive close-only price rows from the security's BUY/SELL transactions.
 * Price = security-currency gross-per-share (fees/taxes excluded — reconstructed
 * via the engine helper, NOT amount/shares). Overwrites any existing quote on a
 * trade date (PP precedence). Trades whose security-currency gross can't be
 * resolved (cross-currency, no FX unit/rate) are skipped and counted.
 */
export function derivePricesFromTransactions(
  sqlite: BetterSqlite3.Database,
  securityId: string,
): DeriveResult {
  const sec = sqlite
    .prepare(`SELECT currency FROM security WHERE uuid = ?`)
    .get(securityId) as { currency: string | null } | undefined;
  const securityCurrency = sec?.currency ?? 'EUR';

  const trades = sqlite
    .prepare(
      `SELECT uuid, type, date, shares, amount, currency
       FROM xact
       WHERE security = ? AND type IN ('BUY','SELL') AND shares > 0
       ORDER BY date ASC, _id ASC`,
    )
    .all(securityId) as RawTradeRow[];

  if (trades.length === 0) return { written: 0, skipped: 0 };

  const unitStmt = sqlite.prepare(
    `SELECT xact, type, amount, currency, forex_amount, forex_currency, exchangeRate
     FROM xact_unit WHERE xact = ?`,
  );
  const insertPrice = sqlite.prepare(`
    INSERT INTO price (security, tstamp, value, open, high, low, volume)
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL)
    ON CONFLICT(security, tstamp) DO UPDATE SET value = excluded.value
  `);

  let written = 0;
  let skipped = 0;

  sqlite.transaction(() => {
    for (const t of trades) {
      const rawUnits = unitStmt.all(t.uuid) as RawUnitRow[];
      const units: TransactionUnit[] = rawUnits.map((u) => ({
        id: '',
        transactionId: t.uuid,
        type: u.type as TransactionUnit['type'],
        amount: u.amount / 100,
        currencyCode: u.currency,
        fxAmount: u.forex_amount != null ? u.forex_amount / 100 : null,
        fxCurrencyCode: u.forex_currency,
        fxRate: u.exchangeRate != null ? parseFloat(u.exchangeRate) : null,
      }));

      const tx: TransactionWithUnits = {
        id: t.uuid,
        type: t.type === 'SELL' ? TransactionType.SELL : TransactionType.BUY,
        date: t.date.slice(0, 10),
        currencyCode: t.currency,
        amount: t.amount != null ? t.amount / 100 : null,
        shares: t.shares,
        note: null,
        securityId,
        source: null,
        updatedAt: null,
        units,
      };

      const secGross = getSecurityCurrencyGross(tx, securityCurrency);
      const sharesCount = new Decimal(t.shares).div(1e8); // native-ok
      if (secGross == null || sharesCount.isZero()) {
        skipped++;
        continue;
      }

      const price = secGross.div(sharesCount);
      const dbValue = convertPriceToDb({ close: price }).close;
      insertPrice.run(securityId, tx.date, dbValue);
      written++;
    }
    syncLatestPriceFromGlobalMax(sqlite, securityId);
  })();

  return { written, skipped };
}
