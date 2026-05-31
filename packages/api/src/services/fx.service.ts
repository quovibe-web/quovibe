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
 *
 * Lookup order:
 *   1. Direct pair
 *   2. Inverse pair
 *   3. EUR triangulation: from→to = (EUR→to) / (EUR→from)
 */
export function getRate(
  sqlite: BetterSqlite3.Database,
  from: string,
  to: string,
  date: string,
): Decimal | null {
  if (from === to) return new Decimal(1);

  const direct = querySingleRate(sqlite, from, to, date);
  if (direct) return direct;

  const inverse = querySingleRate(sqlite, to, from, date);
  if (inverse) return invertRate(inverse);

  // EUR triangulation: from→to = (EUR→to) / (EUR→from)
  if (from !== 'EUR' && to !== 'EUR') {
    const fromEur = querySingleRate(sqlite, 'EUR', from, date);
    const toEur = querySingleRate(sqlite, 'EUR', to, date);
    if (fromEur && toEur) return toEur.div(fromEur);
  }

  return null;
}

function querySingleRate(
  sqlite: BetterSqlite3.Database,
  from: string,
  to: string,
  date: string,
): Decimal | null {
  const row = sqlite
    .prepare(
      `SELECT rate FROM vf_exchange_rate
       WHERE from_currency = ? AND to_currency = ? AND date <= ?
       ORDER BY date DESC LIMIT 1`,
    )
    .get(from, to, date) as { rate: string } | undefined;
  return row ? new Decimal(row.rate) : null;
}

// ─── Public: build dense RateMap ──────────────────────────────────────────────

/**
 * Builds a dense RateMap (foreign→base, multiply convention) for a date range.
 * Merges direct + inverse + EUR triangulation paths into a single sparse map
 * before forward-filling, so that user-added MANUAL rows in one direction
 * never orphan the fuller ECB cache in the other.
 *
 * Per-date precedence: direct wins over inverse, inverse wins over
 * triangulation. This keeps the user's most-recent MANUAL entry authoritative
 * on its declared date while letting the ECB cache backfill prior dates that
 * the user did not touch.
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

  const sparseMap = new Map<string, Decimal>();

  // Triangulation via EUR (lowest precedence — overwritten by inverse and direct)
  if (fromCurrency !== 'EUR' && toCurrency !== 'EUR') {
    const fromEur = querySparseRates(sqlite, 'EUR', fromCurrency, startDate, endDate);
    const toEur = querySparseRates(sqlite, 'EUR', toCurrency, startDate, endDate);
    if (fromEur.size > 0 && toEur.size > 0) {
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

  // Inverse (medium precedence — overwrites triangulation, overwritten by direct)
  const inverseMap = querySparseRates(sqlite, toCurrency, fromCurrency, startDate, endDate);
  for (const [date, rate] of inverseMap) {
    sparseMap.set(date, invertRate(rate));
  }

  // Direct (highest precedence — wins on every date it covers)
  const directMap = querySparseRates(sqlite, fromCurrency, toCurrency, startDate, endDate);
  for (const [date, rate] of directMap) {
    sparseMap.set(date, rate);
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
