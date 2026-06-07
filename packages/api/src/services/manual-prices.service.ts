import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import type { ManualPriceInput } from '@quovibe/shared';
import { convertPriceToDb } from './unit-conversion';
import { syncLatestPriceFromGlobalMax } from './prices.service';

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
  const db = toDbPrice(input);
  const insert = sqlite.prepare(`
    INSERT INTO price (security, tstamp, value, open, high, low, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(security, tstamp) DO UPDATE SET
      value  = excluded.value,
      open   = excluded.open,
      high   = excluded.high,
      low    = excluded.low,
      volume = excluded.volume
  `);
  sqlite.transaction(() => {
    insert.run(securityId, input.date, db.value, db.open, db.high, db.low, db.volume);
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
  const db = toDbPrice(input);
  const del = sqlite.prepare(
    `DELETE FROM price WHERE security = ? AND tstamp = ?`,
  );
  const insert = sqlite.prepare(`
    INSERT INTO price (security, tstamp, value, open, high, low, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(security, tstamp) DO UPDATE SET
      value  = excluded.value,
      open   = excluded.open,
      high   = excluded.high,
      low    = excluded.low,
      volume = excluded.volume
  `);
  sqlite.transaction(() => {
    if (oldDate !== input.date) del.run(securityId, oldDate);
    insert.run(securityId, input.date, db.value, db.open, db.high, db.low, db.volume);
    syncLatestPriceFromGlobalMax(sqlite, securityId);
  })();
}
