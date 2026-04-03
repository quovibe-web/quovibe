import type Database from 'better-sqlite3';
import Decimal from 'decimal.js';
import { convertPriceToDb } from './unit-conversion';

interface PriceInput {
  date: string;
  close: string;
  high?: string;
  low?: string;
  volume?: number;
}

export function importSecurityPrices(
  sqlite: Database.Database,
  securityId: string,
  prices: PriceInput[],
): { ok: true; count: number } {
  const insertPrice = sqlite.prepare(`
    INSERT OR REPLACE INTO price (security, tstamp, value, high, low, volume)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertLatest = sqlite.prepare(`
    INSERT OR REPLACE INTO latest_price (security, tstamp, value)
    VALUES (?, ?, ?)
  `);
  const selectGlobalMax = sqlite.prepare(
    `SELECT tstamp, value FROM price WHERE security = ? ORDER BY tstamp DESC LIMIT 1`,
  );

  sqlite.transaction(() => {
    for (const p of prices) {
      const dbPrice = convertPriceToDb({
        close: new Decimal(p.close),
        ...(p.high != null ? { high: new Decimal(p.high) } : {}),
        ...(p.low != null ? { low: new Decimal(p.low) } : {}),
      });
      insertPrice.run(securityId, p.date, dbPrice.close, dbPrice.high ?? null, dbPrice.low ?? null, p.volume ?? null);
    }

    // Sync latest_price from global max
    const globalMax = selectGlobalMax.get(securityId) as { tstamp: string; value: number } | undefined;
    if (globalMax) {
      insertLatest.run(securityId, globalMax.tstamp, globalMax.value);
    }
  })();

  return { ok: true, count: prices.length };
}
