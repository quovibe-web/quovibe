import type Database from 'better-sqlite3';
import Decimal from 'decimal.js';
import { convertPriceToDb } from './unit-conversion';

interface PriceInput {
  date: string;
  close: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: number;
}

type PriceDbRow = { tstamp: string; value: number; open: number | null; high: number | null; low: number | null; volume: number | null };

export function importSecurityPrices(
  sqlite: Database.Database,
  securityId: string,
  prices: PriceInput[],
): { ok: true; count: number } {
  const insertPrice = sqlite.prepare(`
    INSERT OR REPLACE INTO price (security, tstamp, value, open, high, low, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLatest = sqlite.prepare(`
    INSERT OR REPLACE INTO latest_price (security, tstamp, value, open, high, low, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const selectGlobalMax = sqlite.prepare(
    `SELECT tstamp, value, open, high, low, volume FROM price WHERE security = ? ORDER BY tstamp DESC LIMIT 1`,
  );

  sqlite.transaction(() => {
    for (const p of prices) {
      const dbPrice = convertPriceToDb({
        close: new Decimal(p.close),
        open: p.open != null ? new Decimal(p.open) : undefined,
        high: p.high != null ? new Decimal(p.high) : undefined,
        low: p.low != null ? new Decimal(p.low) : undefined,
      });
      insertPrice.run(securityId, p.date, dbPrice.close, dbPrice.open ?? null, dbPrice.high ?? null, dbPrice.low ?? null, p.volume ?? null);
    }

    // Sync latest_price from global max
    const globalMax = selectGlobalMax.get(securityId) as PriceDbRow | undefined;
    if (globalMax) {
      insertLatest.run(securityId, globalMax.tstamp, globalMax.value, globalMax.open ?? null, globalMax.high ?? null, globalMax.low ?? null, globalMax.volume ?? null);
    }
  })();

  return { ok: true, count: prices.length };
}
