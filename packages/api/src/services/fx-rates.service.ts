// fx-rates.service.ts — CRUD for user-entered MANUAL FX rates and ECB CSV bulk import.
// All vf_exchange_rate writes go through this service (G14).
import type BetterSqlite3 from 'better-sqlite3';
import { parseEcbCsv, EcbCsvError } from '@quovibe/shared';

// Re-export EcbCsvError so the route layer can reference it for error discrimination
// without importing from @quovibe/shared directly (avoids vite CJS lazy-getter interop issues
// in the test environment where barrel re-exports via Object.defineProperty getters may not
// resolve correctly under vite's SSR transform).
export { EcbCsvError };

export class FxRatesError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'FxRatesError';
  }
}

// ISO-4217: exactly 3 uppercase ASCII letters.
const ISO_4217 = /^[A-Z]{3}$/;

function assertCcyValid(from: string, to: string): void {
  if (!ISO_4217.test(from) || !ISO_4217.test(to)) {
    throw new FxRatesError('INVALID_CURRENCY_CODE');
  }
  if (from === to) throw new FxRatesError('SAME_CURRENCY');
}

function assertRateValid(rate: string): void {
  // Native arithmetic is intentional here — validation only, not financial math.
  const n = Number(rate); // native-ok
  if (!Number.isFinite(n) || n <= 0) throw new FxRatesError('INVALID_RATE');
}

// ─── Pair summary ─────────────────────────────────────────────────────────────

export interface FxPairSummary {
  from: string;
  to: string;
  count: number;
  minDate: string;
  maxDate: string;
}

export function listFxPairs(sqlite: BetterSqlite3.Database): FxPairSummary[] {
  // `from` is an SQL reserved word; quoted aliases are valid SQLite and round-trip
  // cleanly through JSON — the alias name is intentional for API clarity.
  return sqlite.prepare(`
    SELECT from_currency as "from", to_currency as "to",
           COUNT(*) as count, MIN(date) as minDate, MAX(date) as maxDate
    FROM vf_exchange_rate
    GROUP BY from_currency, to_currency
    ORDER BY from_currency, to_currency
  `).all() as FxPairSummary[];
}

// ─── Pair detail ──────────────────────────────────────────────────────────────

export interface FxRateRow {
  date: string;
  rate: string;
  source: 'ECB' | 'MANUAL' | 'IMPORT';
}

export function listFxRatesForPair(
  sqlite: BetterSqlite3.Database,
  from: string,
  to: string,
): FxRateRow[] {
  assertCcyValid(from, to);
  return sqlite.prepare(`
    SELECT date, rate, source FROM vf_exchange_rate
    WHERE from_currency = ? AND to_currency = ?
    ORDER BY date DESC
  `).all(from, to) as FxRateRow[];
}

// ─── MANUAL CRUD ──────────────────────────────────────────────────────────────

export interface CreateFxRateInput {
  from: string;
  to: string;
  date: string;
  rate: string;
}

export function createFxRate(
  sqlite: BetterSqlite3.Database,
  input: CreateFxRateInput,
): FxRateRow {
  assertCcyValid(input.from, input.to);
  assertRateValid(input.rate);
  try {
    sqlite.prepare(`
      INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
      VALUES (?, ?, ?, ?, 'MANUAL')
    `).run(input.date, input.from, input.to, input.rate);
  } catch (err) {
    // better-sqlite3 throws with err.code = 'SQLITE_CONSTRAINT_PRIMARYKEY' or
    // 'SQLITE_CONSTRAINT_UNIQUE' on PK / unique violations.
    if (
      err instanceof Error &&
      'code' in err &&
      typeof (err as { code: unknown }).code === 'string' &&
      (err as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
    ) {
      throw new FxRatesError('DUPLICATE_RATE');
    }
    throw err;
  }
  return { date: input.date, rate: input.rate, source: 'MANUAL' };
}

export function updateFxRate(
  sqlite: BetterSqlite3.Database,
  input: CreateFxRateInput,
): FxRateRow {
  assertCcyValid(input.from, input.to);
  assertRateValid(input.rate);
  const result = sqlite.prepare(`
    UPDATE vf_exchange_rate SET rate = ?
    WHERE date = ? AND from_currency = ? AND to_currency = ? AND source = 'MANUAL'
  `).run(input.rate, input.date, input.from, input.to);
  if (result.changes === 0) {
    throw new FxRatesError('RATE_NOT_FOUND_OR_NOT_MANUAL');
  }
  return { date: input.date, rate: input.rate, source: 'MANUAL' };
}

export function deleteFxRate(
  sqlite: BetterSqlite3.Database,
  input: { from: string; to: string; date: string },
): void {
  assertCcyValid(input.from, input.to);
  const result = sqlite.prepare(`
    DELETE FROM vf_exchange_rate
    WHERE date = ? AND from_currency = ? AND to_currency = ? AND source = 'MANUAL'
  `).run(input.date, input.from, input.to);
  if (result.changes === 0) {
    throw new FxRatesError('RATE_NOT_FOUND_OR_NOT_MANUAL');
  }
}

// ─── Bulk import (ECB CSV) ────────────────────────────────────────────────────

export interface EcbRateInput {
  date: string;
  from: string;
  to: string;
  rate: string;
}

export interface ImportEcbResult {
  inserted: number;
  skipped: number;
}

/**
 * Bulk-inserts ECB CSV rates tagged with source='IMPORT'.
 * Uses INSERT OR IGNORE so existing rows (MANUAL or ECB) are never overwritten.
 * Returns counts of rows actually inserted vs skipped due to PK conflict.
 */
export function importEcbRates(
  sqlite: BetterSqlite3.Database,
  rates: EcbRateInput[],
): ImportEcbResult {
  let inserted = 0; // native-ok — row counter
  let skipped = 0;  // native-ok — row counter
  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
    VALUES (?, ?, ?, ?, 'IMPORT')
  `);
  const tx = sqlite.transaction((rows: EcbRateInput[]) => {
    for (const r of rows) {
      const result = stmt.run(r.date, r.from, r.to, r.rate);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });
  tx(rates);
  return { inserted, skipped };
}

/**
 * Parse an ECB eurofxref CSV string and bulk-insert the resulting rates.
 * Combines `parseEcbCsv` (shared) + `importEcbRates` into a single service call
 * so the route layer does not need to import from @quovibe/shared directly.
 */
export function importFromEcbCsv(
  sqlite: BetterSqlite3.Database,
  csvText: string,
): ImportEcbResult {
  const rates = parseEcbCsv(csvText);
  return importEcbRates(sqlite, rates);
}
