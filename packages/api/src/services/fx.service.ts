import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import { buildForwardFilledMap, invertRate, type RateMap } from '@quovibe/engine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RateRow {
  date: string;
  rate: string;
}

// ─── Public: single-date rate lookup ──────────────────────────────────────────

/**
 * Single-date rate lookup with forward-fill (closest previous date).
 * Uses forward-fill, not interpolation. ECB publishes only on business days;
 * the last known rate is carried forward.
 */
export function getRate(
  sqlite: BetterSqlite3.Database,
  from: string,
  to: string,
  date: string,
): Decimal | null {
  if (from === to) return new Decimal(1);

  // Exact or closest previous (forward-fill)
  const direct = sqlite.prepare(`
    SELECT rate FROM vf_exchange_rate
    WHERE from_currency = ? AND to_currency = ? AND date <= ?
    ORDER BY date DESC LIMIT 1
  `).get(from, to, date) as { rate: string } | undefined;

  if (direct) return new Decimal(direct.rate);

  // Try inverse
  const inverse = sqlite.prepare(`
    SELECT rate FROM vf_exchange_rate
    WHERE from_currency = ? AND to_currency = ? AND date <= ?
    ORDER BY date DESC LIMIT 1
  `).get(to, from, date) as { rate: string } | undefined;

  if (inverse) return invertRate(new Decimal(inverse.rate));

  return null;
}

// ─── Public: build dense RateMap ──────────────────────────────────────────────

/**
 * Builds a dense RateMap (foreign→base, multiply convention) for a date range.
 * Handles: direct lookup, inverse, and cross-rate triangulation via EUR.
 */
export function buildRateMap(
  sqlite: BetterSqlite3.Database,
  fromCurrency: string,
  toCurrency: string,
  startDate: string,
  endDate: string,
): RateMap {
  if (fromCurrency === toCurrency) {
    // Identity map — not needed, but safe fallback
    return new Map();
  }

  // Try direct pair
  let sparseMap = querySparseRates(sqlite, fromCurrency, toCurrency, startDate, endDate);

  // Try inverse
  if (sparseMap.size === 0) {
    const inverseMap = querySparseRates(sqlite, toCurrency, fromCurrency, startDate, endDate);
    if (inverseMap.size > 0) {
      sparseMap = new Map<string, Decimal>();
      for (const [date, rate] of inverseMap) {
        sparseMap.set(date, invertRate(rate));
      }
    }
  }

  // Try cross-rate via EUR
  if (sparseMap.size === 0 && fromCurrency !== 'EUR' && toCurrency !== 'EUR') {
    const fromEur = querySparseRates(sqlite, 'EUR', fromCurrency, startDate, endDate);
    const toEur = querySparseRates(sqlite, 'EUR', toCurrency, startDate, endDate);
    if (fromEur.size > 0 && toEur.size > 0) {
      sparseMap = new Map<string, Decimal>();
      for (const [date, fromRate] of fromEur) {
        const toRate = toEur.get(date);
        if (toRate) {
          // Cross-rate: from→to = (EUR→to) / (EUR→from)
          // Example: USD→GBP = (EUR→GBP) / (EUR→USD) = 0.86 / 1.08 = 0.7963
          sparseMap.set(date, toRate.div(fromRate));
        }
      }
    }
  }

  return buildForwardFilledMap(sparseMap, startDate, endDate);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function querySparseRates(
  sqlite: BetterSqlite3.Database,
  from: string,
  to: string,
  startDate: string,
  endDate: string,
): Map<string, Decimal> {
  // Include some days before startDate for forward-fill seeding
  const rows = sqlite.prepare(`
    SELECT date, rate FROM vf_exchange_rate
    WHERE from_currency = ? AND to_currency = ?
      AND date >= date(?, '-30 days') AND date <= ?
    ORDER BY date
  `).all(from, to, startDate, endDate) as RateRow[];

  const map = new Map<string, Decimal>();
  for (const row of rows) {
    map.set(row.date, new Decimal(row.rate));
  }
  return map;
}
