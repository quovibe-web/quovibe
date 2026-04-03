// Integration tests for:
//   D1 — fee pipeline reads xact_unit only, ignores xact.fees column
//   D3 — standalone FEES transaction with null securityId
//   E2 — SELL cash-side row excluded from all items
//   E3 — per-account transaction list has no duplicates from cross-entry

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
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
// Copied EXACTLY from calculation-items.test.ts + account_attr for E3

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
      high INTEGER,
      low INTEGER,
      volume INTEGER
    );
    CREATE TABLE price (
      security TEXT,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
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
    CREATE TABLE IF NOT EXISTS account_attr (
      account TEXT,
      attr_uuid TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'string',
      value TEXT,
      seq INTEGER DEFAULT 0,
      PRIMARY KEY (account, attr_uuid)
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_START = '2024-01-01';
const PERIOD_END = '2024-12-31';

// Accounts
const EUR_DEPOSIT_ID = 'acct-eur-dep';
const PORTFOLIO_ID = 'acct-portfolio';

// Securities
const SEC_ID = 'sec-test-corp';

// ─── Seed data ──────────────────────────────────────────────────────────────────
// ppxml2db amount conventions: amounts in hecto-units (×100), shares in ×1e8, prices in ×1e8

function seedData(sqlite: Database.Database) {
  // Base currency
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
    .run('portfolio.currency', 'EUR');

  // ── Accounts ──

  // EUR deposit account
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(EUR_DEPOSIT_ID, 'EUR Cash', 'account', 'EUR');

  // Portfolio account (securities)
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(PORTFOLIO_ID, 'Portfolio', 'portfolio', null, EUR_DEPOSIT_ID);

  // ── Securities ──

  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
    .run(SEC_ID, 'Test Corp', 'EUR');

  // ── Transactions ──

  // 1. DEPOSIT 20000 EUR into EUR account
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, account) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('xact-dep-001', 'DEPOSIT', '2024-01-05', 'EUR', 20000 * 100, EUR_DEPOSIT_ID);

  // 2. D1 scenario: BUY 10 shares at 105 EUR = 1050 EUR total amount
  //    xact.fees column = 5000 (= 50 EUR in hecto-units) — THIS IS THE TRAP
  //    xact_unit FEE row = 5000 (= 50 EUR in hecto-units) — this is the correct source
  //    If both are counted: 100 EUR fees (DOUBLE). Correct: 50 EUR from xact_unit only.
  //
  //    Securities-side row (shares > 0)
  sqlite.prepare(
    `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('xact-buy-d1', 'BUY', '2024-02-01', 'EUR', 1050 * 100, 10 * 1e8, SEC_ID, PORTFOLIO_ID, 50 * 100);
  sqlite.prepare(`INSERT INTO xact_unit (xact, type, amount) VALUES (?, ?, ?)`)
    .run('xact-buy-d1', 'FEE', 50 * 100);
  //    Cash-side row (shares = 0)
  sqlite.prepare(
    `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('xact-buy-d1-cash', 'BUY', '2024-02-01', 'EUR', 1050 * 100, 0, null, EUR_DEPOSIT_ID, 50 * 100);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-buy-d1', PORTFOLIO_ID, 'xact-buy-d1-cash', EUR_DEPOSIT_ID);

  // 3. D3 scenario: Standalone FEES transaction on deposit account, no securityId
  //    amount = 30 EUR (3000 in hecto-units)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-fee-standalone', 'FEES', '2024-04-01', 'EUR', 30 * 100, 0, null, EUR_DEPOSIT_ID);

  // 4. E2 scenario: SELL 5 shares at 120 EUR (dual-entry)
  //    Securities-side row (shares > 0)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-sell-e2', 'SELL', '2024-06-15', 'EUR', 600 * 100, 5 * 1e8, SEC_ID, PORTFOLIO_ID);
  //    Cash-side row (shares = 0)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-sell-e2-cash', 'SELL', '2024-06-15', 'EUR', 600 * 100, 0, null, EUR_DEPOSIT_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-sell-e2', PORTFOLIO_ID, 'xact-sell-e2-cash', EUR_DEPOSIT_ID);

  // ── Prices ──
  // All prices stored as value × 1e8 (ppxml2db convention)
  const prices: [string, number][] = [
    ['2023-12-29', 100 * 1e8],   // pre-period close
    ['2024-02-01', 105 * 1e8],   // BUY date
    ['2024-06-15', 120 * 1e8],   // SELL date
    ['2024-12-31', 130 * 1e8],   // period end
  ];
  for (const [d, v] of prices) {
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_ID, d, v);
  }
  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(SEC_ID, '2024-12-31', 130 * 1e8);
}

// ─── URL helper ────────────────────────────────────────────────────────────────

function calcUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    ...overrides,
  });
  return `/api/performance/calculation?${params}`;
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('Fee pipeline & double-entry guards (D1-D3, E2-E3)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedData(sqlite);
  });

  // ── D1: fees.total reflects xact_unit FEE only, not xact.fees column ──
  //
  // Seed: BUY with xact.fees=5000 AND xact_unit FEE=5000 (both = 50 EUR)
  //        + standalone FEES = 30 EUR
  // If xact.fees were ALSO counted: 50 + 50 + 30 = 130 — WRONG
  // Correct: 50 (xact_unit) + 30 (standalone FEES) = 80
  it('D1: fees.total reflects xact_unit FEE only, not xact.fees column', async () => {
    const res = await request(app).get(calcUrl());
    expect(res.status).toBe(200);

    const feesTotal = parseFloat(res.body.fees.total);

    // Correct total: security fee (50) + standalone FEES (30) = 80
    // If xact.fees column were also counted it would be 130
    expect(feesTotal).toBeCloseTo(80, 0);
    expect(feesTotal).toBeLessThan(100); // Must NOT be >= 100 (double-counting)
  });

  // ── D3: Standalone FEES in items with null securityId ──
  // Standalone FEES appear in fees breakdown with securityId = null/undefined
  it('D3: standalone FEES in items with securityId=null', async () => {
    const res = await request(app).get(calcUrl());
    expect(res.status).toBe(200);

    const feeItems = res.body.fees.items as Array<{
      securityId?: string | null;
      name: string;
      fees: string;
    }>;

    // Must have at least one fee item without a securityId (the standalone FEES)
    const standaloneFees = feeItems.filter(
      (i) => i.securityId === undefined || i.securityId === null,
    );
    expect(standaloneFees.length).toBeGreaterThanOrEqual(1);

    // The standalone fee should be ~30 EUR
    const standaloneTotal = standaloneFees.reduce(
      (sum, i) => sum + parseFloat(i.fees),
      0,
    );
    expect(standaloneTotal).toBeCloseTo(30, 0);
  });

  // ── E2: SELL cash-side row excluded from all items ──
  // Cash-side rows (BUY/SELL with shares=0) are excluded from items
  it('E2: SELL cash-side excluded from all items', async () => {
    const res = await request(app).get(calcUrl());
    expect(res.status).toBe(200);

    // capitalGains.items: only SEC_ID entries, no cash-side artifacts
    const cgItems = res.body.capitalGains.items as Array<{ securityId: string }>;
    for (const item of cgItems) {
      expect(item.securityId).toBe(SEC_ID);
    }

    // realizedGains.items: only SEC_ID entries
    const rgItems = res.body.realizedGains.items as Array<{ securityId: string }>;
    for (const item of rgItems) {
      expect(item.securityId).toBe(SEC_ID);
    }

    // fees.items: security-level fee items should only reference SEC_ID
    const feeItems = res.body.fees.items as Array<{
      securityId?: string | null;
      fees: string;
    }>;
    for (const item of feeItems) {
      if (item.securityId !== undefined && item.securityId !== null) {
        expect(item.securityId).toBe(SEC_ID);
      }
    }

    // Verify no cash-side xact UUID appears anywhere in the response body
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('xact-buy-d1-cash');
    expect(bodyStr).not.toContain('xact-sell-e2-cash');
  });

  // ── E3: Per-account transaction list has no duplicates from cross-entry ──
  // Per-account query must not use cross-entry in WHERE clause.
  // NEVER adds OR ce.from_acc = ? OR ce.to_acc = ? which would cause duplicates
  it('E3: per-account transaction list has no duplicates from cross-entry', async () => {
    // Query deposit account transactions
    const res = await request(app).get(
      `/api/accounts/${EUR_DEPOSIT_ID}/transactions?limit=100`,
    );
    expect(res.status).toBe(200);

    const data = res.body.data as Array<{ uuid: string }>;
    const uuids = data.map((tx) => tx.uuid);
    const uniqueUuids = new Set(uuids);

    // Every UUID must be unique — no duplicates from cross-entry JOIN leaking
    expect(uuids.length).toBe(uniqueUuids.size);

    // Also verify the total count matches
    expect(res.body.total).toBe(uniqueUuids.size);

    // Query portfolio account transactions
    const resPortfolio = await request(app).get(
      `/api/accounts/${PORTFOLIO_ID}/transactions?limit=100`,
    );
    expect(resPortfolio.status).toBe(200);

    const portfolioData = resPortfolio.body.data as Array<{ uuid: string }>;
    const portfolioUuids = portfolioData.map((tx) => tx.uuid);
    const uniquePortfolioUuids = new Set(portfolioUuids);

    // No duplicates in portfolio account either
    expect(portfolioUuids.length).toBe(uniquePortfolioUuids.size);
    expect(resPortfolio.body.total).toBe(uniquePortfolioUuids.size);
  });
});
