// Integration tests for the accounting equation (G1), empty portfolio (G2),
// and mid-period portfolio start (G3). Verifies that:
//   absoluteChange = capitalGains + earnings - fees - taxes + cashCurrencyGains + PNT

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Decimal from 'decimal.js';
import * as schema from '../db/schema';
import { createApp } from '../create-app';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

// ─── Test DB setup ─────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');

  sqlite.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT,
      currency TEXT DEFAULT 'EUR',
      isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT,
      updatedAt TEXT,
      note TEXT,
      _xmlid INTEGER,
      _order INTEGER
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      isin TEXT,
      tickerSymbol TEXT,
      wkn TEXT,
      currency TEXT DEFAULT 'EUR',
      note TEXT,
      isRetired INTEGER DEFAULT 0,
      feedURL TEXT,
      feed TEXT,
      latestFeedURL TEXT,
      latestFeed TEXT,
      feedTickerSymbol TEXT,
      calendar TEXT,
      updatedAt TEXT,
      onlineId TEXT,
      targetCurrency TEXT
    );
    CREATE TABLE xact (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      currency TEXT,
      amount INTEGER,
      shares INTEGER,
      note TEXT,
      security TEXT,
      account TEXT,
      source TEXT,
      updatedAt TEXT,
      fees INTEGER,
      taxes INTEGER,
      acctype TEXT,
      _xmlid INTEGER,
      _order INTEGER
    );
    CREATE TABLE xact_cross_entry (
      from_xact TEXT,
      from_acc TEXT,
      to_xact TEXT,
      to_acc TEXT,
      type TEXT
    );
    CREATE TABLE xact_unit (
      xact TEXT,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT,
      forex_amount INTEGER,
      forex_currency TEXT,
      exchangeRate TEXT
    );
    CREATE TABLE config_entry (
      uuid TEXT,
      config_set INTEGER,
      name TEXT NOT NULL,
      data TEXT
    );
    CREATE TABLE property (
      name TEXT PRIMARY KEY,
      special INTEGER NOT NULL DEFAULT 0,
      value TEXT
    );
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY,
      tstamp TEXT,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER
    );
    CREATE TABLE price (
      security TEXT,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER,
      PRIMARY KEY (security, tstamp)
    );
    CREATE TABLE taxonomy (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      root TEXT NOT NULL
    );
    CREATE TABLE taxonomy_category (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      taxonomy TEXT NOT NULL,
      parent TEXT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      weight INTEGER NOT NULL,
      rank INTEGER NOT NULL
    );
    CREATE TABLE taxonomy_assignment (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy TEXT NOT NULL,
      category TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      rank INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE taxonomy_data (
      taxonomy TEXT NOT NULL,
      category TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL
    );
    CREATE TABLE taxonomy_assignment_data (
      assignment INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── URL helper ────────────────────────────────────────────────────────────────

function calcUrl(periodStart: string, periodEnd: string, overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    periodStart,
    periodEnd,
    ...overrides,
  });
  return `/api/performance/calculation?${params}`;
}

// ─── Helper: verify no NaN in any numeric field ──────────────────────────────
// Known non-numeric string fields that should NOT be checked for NaN.
const NON_NUMERIC_KEYS = new Set([
  'securityId', 'accountId', 'name', 'isin', 'currency', 'irrError',
  'type', 'date', 'note', 'tickerSymbol', 'wkn',
]);

function assertNoNaN(obj: unknown, path = '', key = ''): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'boolean') return;
  if (typeof obj === 'string') {
    // Skip fields that are identifiers, not numeric values
    if (NON_NUMERIC_KEYS.has(key)) return;
    // Only flag strings that are literally 'NaN' (what Decimal(NaN).toString() produces)
    expect(obj === 'NaN' ? `NaN at ${path}` : 'ok').toBe('ok');
    return;
  }
  if (typeof obj === 'number') {
    expect(Number.isNaN(obj) ? `NaN at ${path}` : 'ok').toBe('ok');
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoNaN(item, `${path}[${i}]`, ''));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, value] of Object.entries(obj as Record<string, unknown>)) {
      assertNoNaN(value, path ? `${path}.${k}` : k, k);
    }
  }
}

// ─── Helper: accounting equation assertion ─────────────────────────────────────

function assertAccountingEquation(body: Record<string, unknown>): void {
  const absoluteChange = new Decimal(body.absoluteChange as string);
  const sum = new Decimal((body.capitalGains as { total: string }).total)
    .plus((body.earnings as { total: string }).total)
    .minus((body.fees as { total: string }).total)
    .minus((body.taxes as { total: string }).total)
    .plus((body.cashCurrencyGains as { total: string }).total)
    .plus((body.performanceNeutralTransfers as { total: string }).total);

  expect(absoluteChange.toDecimalPlaces(2).toString()).toBe(
    sum.toDecimalPlaces(2).toString(),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// G1: Accounting equation on simple portfolio
// ═══════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('G1: Accounting equation on simple portfolio', () => {
  const PERIOD_START = '2024-01-01';
  const PERIOD_END = '2024-12-31';

  const EUR_DEPOSIT_ID = 'g1-eur-dep';
  const PORTFOLIO_ID = 'g1-portfolio';
  const SEC_ID = 'g1-sec-1';

  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    // Base currency
    sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
      .run('portfolio.currency', 'EUR');

    // Accounts
    sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
      .run(EUR_DEPOSIT_ID, 'EUR Cash', 'account', 'EUR');
    sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
      .run(PORTFOLIO_ID, 'Portfolio', 'portfolio', null, EUR_DEPOSIT_ID);

    // Security
    sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
      .run(SEC_ID, 'Simple Corp', 'EUR');

    // DEPOSIT 10000 EUR
    sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, account) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('g1-dep-001', 'DEPOSIT', '2024-01-05', 'EUR', 10000 * 100, EUR_DEPOSIT_ID);

    // BUY 50 shares at 100 EUR + 10 EUR fee (dual-entry)
    // Securities-side: amount = 50*100 + 10 = 5010 EUR → 501000 hecto-units
    sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('g1-buy-001', 'BUY', '2024-02-01', 'EUR', 5010 * 100, 50 * 1e8, SEC_ID, PORTFOLIO_ID);
    sqlite.prepare(`INSERT INTO xact_unit (xact, type, amount) VALUES (?, ?, ?)`)
      .run('g1-buy-001', 'FEE', 10 * 100);
    // Cash-side row
    sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('g1-buy-001-cash', 'BUY', '2024-02-01', 'EUR', 5010 * 100, 0, null, EUR_DEPOSIT_ID);
    sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
      .run('g1-buy-001', PORTFOLIO_ID, 'g1-buy-001-cash', EUR_DEPOSIT_ID);

    // Prices (×1e8)
    const prices: [string, number][] = [
      ['2023-12-29', 100 * 1e8],   // pre-period close
      ['2024-02-01', 100 * 1e8],   // BUY date
      ['2024-12-31', 120 * 1e8],   // period end
    ];
    for (const [d, v] of prices)
      sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_ID, d, v);
    sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(SEC_ID, '2024-12-31', 120 * 1e8);
  });

  it('accounting equation: absoluteChange = sum of breakdown components', async () => {
    const res = await request(app).get(calcUrl(PERIOD_START, PERIOD_END));
    expect(res.status).toBe(200);

    assertAccountingEquation(res.body);
  });

  it('breakdown totals have expected signs and magnitudes', async () => {
    const res = await request(app).get(calcUrl(PERIOD_START, PERIOD_END));
    expect(res.status).toBe(200);
    const b = res.body;

    // Capital gains should be positive: 50 shares × (120 - 100) = 1000 EUR unrealized
    const capitalGainsTotal = parseFloat(b.capitalGains.total);
    expect(capitalGainsTotal).toBeGreaterThan(0);

    // Fees should be 10 EUR
    const feesTotal = parseFloat(b.fees.total);
    expect(feesTotal).toBeCloseTo(10, 0);

    // No dividends/interest in this simple scenario
    const earningsTotal = parseFloat(b.earnings.total);
    expect(earningsTotal).toBe(0);

    // No foreign currency in this scenario
    const cashFxTotal = parseFloat(b.cashCurrencyGains.total);
    expect(cashFxTotal).toBe(0);

    // No NaN anywhere
    assertNoNaN(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G2: Empty portfolio (no transactions)
// ═══════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('G2: Empty portfolio — no transactions', () => {
  const PERIOD_START = '2024-01-01';
  const PERIOD_END = '2024-12-31';

  const EUR_DEPOSIT_ID = 'g2-eur-dep';
  const PORTFOLIO_ID = 'g2-portfolio';

  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    // Base currency
    sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
      .run('portfolio.currency', 'EUR');

    // Accounts only — no securities, no transactions
    sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
      .run(EUR_DEPOSIT_ID, 'EUR Cash', 'account', 'EUR');
    sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
      .run(PORTFOLIO_ID, 'Portfolio', 'portfolio', null, EUR_DEPOSIT_ID);
  });

  it('empty portfolio: all zeros, empty items, no NaN', async () => {
    const res = await request(app).get(calcUrl(PERIOD_START, PERIOD_END));
    expect(res.status).toBe(200);
    const b = res.body;

    // All top-level values should be zero
    expect(b.initialValue).toBe('0');
    expect(b.finalValue).toBe('0');
    expect(b.ttwror).toBe('0');
    expect(b.absoluteChange).toBe('0');

    // All items arrays should be empty
    expect(b.capitalGains.items).toEqual([]);
    expect(b.realizedGains.items).toEqual([]);
    expect(b.earnings.dividendItems).toEqual([]);
    expect(b.fees.items).toEqual([]);
    expect(b.taxes.items).toEqual([]);
    expect(b.cashCurrencyGains.items).toEqual([]);
    expect(b.performanceNeutralTransfers.items).toEqual([]);

    // All totals should be zero
    expect(b.capitalGains.total).toBe('0');
    expect(b.realizedGains.total).toBe('0');
    expect(b.earnings.total).toBe('0');
    expect(b.fees.total).toBe('0');
    expect(b.taxes.total).toBe('0');
    expect(b.cashCurrencyGains.total).toBe('0');
    expect(b.performanceNeutralTransfers.total).toBe('0');

    // No NaN in any field
    assertNoNaN(b);

    // Accounting equation holds (trivially: 0 = 0)
    assertAccountingEquation(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G3: Portfolio started mid-period (initialValue=0)
// ═══════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('G3: Portfolio started mid-period — initialValue=0', () => {
  const PERIOD_START = '2024-01-01';
  const PERIOD_END = '2024-12-31';

  const EUR_DEPOSIT_ID = 'g3-eur-dep';
  const PORTFOLIO_ID = 'g3-portfolio';
  const SEC_ID = 'g3-sec-1';

  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    // Base currency
    sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
      .run('portfolio.currency', 'EUR');

    // Accounts
    sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
      .run(EUR_DEPOSIT_ID, 'EUR Cash', 'account', 'EUR');
    sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
      .run(PORTFOLIO_ID, 'Portfolio', 'portfolio', null, EUR_DEPOSIT_ID);

    // Security
    sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
      .run(SEC_ID, 'MidPeriod Corp', 'EUR');

    // All transactions happen AFTER period start (2024-01-01)

    // DEPOSIT 5000 EUR on 2024-06-01
    sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, account) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('g3-dep-001', 'DEPOSIT', '2024-06-01', 'EUR', 5000 * 100, EUR_DEPOSIT_ID);

    // BUY 25 shares at 80 EUR on 2024-06-15 (dual-entry)
    // amount = 25 * 80 = 2000 EUR → 200000 hecto-units
    sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('g3-buy-001', 'BUY', '2024-06-15', 'EUR', 2000 * 100, 25 * 1e8, SEC_ID, PORTFOLIO_ID);
    // Cash-side row
    sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('g3-buy-001-cash', 'BUY', '2024-06-15', 'EUR', 2000 * 100, 0, null, EUR_DEPOSIT_ID);
    sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
      .run('g3-buy-001', PORTFOLIO_ID, 'g3-buy-001-cash', EUR_DEPOSIT_ID);

    // Prices only for dates after activity starts (×1e8)
    const prices: [string, number][] = [
      ['2024-06-15', 80 * 1e8],    // BUY date
      ['2024-12-31', 100 * 1e8],   // period end
    ];
    for (const [d, v] of prices)
      sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_ID, d, v);
    sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(SEC_ID, '2024-12-31', 100 * 1e8);
  });

  it('mid-period start: initialValue=0, valid results, no NaN', async () => {
    const res = await request(app).get(calcUrl(PERIOD_START, PERIOD_END));
    expect(res.status).toBe(200);
    const b = res.body;

    // initialValue should be 0 (nothing existed at period start)
    expect(b.initialValue).toBe('0');

    // finalValue should be > 0 (securities + cash at period end)
    // Cash at end: 5000 - 2000 = 3000 EUR
    // Securities at end: 25 × 100 = 2500 EUR
    // Total: 5500 EUR
    const finalValue = parseFloat(b.finalValue);
    expect(finalValue).toBeGreaterThan(0);

    // No NaN in any field
    assertNoNaN(b);

    // Accounting equation holds even when starting from zero
    assertAccountingEquation(b);
  });

  it('mid-period start: capital gains reflect price increase from BUY to period end', async () => {
    const res = await request(app).get(calcUrl(PERIOD_START, PERIOD_END));
    expect(res.status).toBe(200);
    const b = res.body;

    // Unrealized gain: 25 shares × (100 - 80) = 500 EUR
    const capitalGainsTotal = parseFloat(b.capitalGains.total);
    expect(capitalGainsTotal).toBeCloseTo(500, 0);
  });
});
