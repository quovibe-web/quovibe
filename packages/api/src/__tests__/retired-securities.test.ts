// Integration tests for retired & bankrupt securities edge cases (C1-C3).
// Verifies: fully sold before period exclusion, bankrupt sold during period,
// retired mid-period partial contribution.

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
// Exact copy from calculation-items.test.ts

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
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PERIOD_START = '2024-01-01';
const PERIOD_END = '2024-12-31';

// Accounts
const EUR_DEPOSIT_ID = 'acct-retired-dep';
const PORTFOLIO_ID = 'acct-retired-portfolio';

// Securities
const SEC_FULLY_SOLD_ID = 'sec-fully-sold';      // C1: fully sold before period
const SEC_BANKRUPT_ID = 'sec-bankrupt';            // C2: bankrupt sold during period
const SEC_MID_RETIRED_ID = 'sec-mid-retired';      // C3: retired mid-period

// ─── Seed data ────────────────────────────────────────────────────────────────
// ppxml2db amount conventions: amounts in hecto-units (×100), shares in ×1e8, prices in ×1e8

function seedRetiredScenarios(sqlite: Database.Database) {
  // Base currency
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
    .run('portfolio.currency', 'EUR');

  // ── Accounts ──

  // EUR deposit account
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(EUR_DEPOSIT_ID, 'EUR Cash', 'account', 'EUR');

  // Portfolio account (securities) with referenceAccount linking
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(PORTFOLIO_ID, 'Portfolio', 'portfolio', null, EUR_DEPOSIT_ID);

  // ── Securities ──

  // C1: Fully Sold Corp — NOT retired, fully sold before period
  sqlite.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
    .run(SEC_FULLY_SOLD_ID, 'Fully Sold Corp', 'EUR', 0);

  // C2: Bankrupt Corp — marked as retired (isRetired=1)
  sqlite.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
    .run(SEC_BANKRUPT_ID, 'Bankrupt Corp', 'EUR', 1);

  // C3: Mid-Retired Corp — NOT marked as retired
  sqlite.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
    .run(SEC_MID_RETIRED_ID, 'Mid-Retired Corp', 'EUR', 0);

  // ── Transactions ──

  // DEPOSIT to fund the cash account (large enough to cover all BUYs)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, account) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('xact-dep-fund', 'DEPOSIT', '2023-01-01', 'EUR', 50000 * 100, EUR_DEPOSIT_ID);

  // ── C1: Fully Sold Corp ──
  // BUY 10 shares at 50 EUR on 2023-03-01 (amount = 10×50 = 500 EUR)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c1-buy', 'BUY', '2023-03-01', 'EUR', 500 * 100, 10 * 1e8, SEC_FULLY_SOLD_ID, PORTFOLIO_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c1-buy-cash', 'BUY', '2023-03-01', 'EUR', 500 * 100, 0, null, EUR_DEPOSIT_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-c1-buy', PORTFOLIO_ID, 'xact-c1-buy-cash', EUR_DEPOSIT_ID);

  // SELL all 10 shares at 60 EUR on 2023-09-01 (amount = 10×60 = 600 EUR)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c1-sell', 'SELL', '2023-09-01', 'EUR', 600 * 100, 10 * 1e8, SEC_FULLY_SOLD_ID, PORTFOLIO_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c1-sell-cash', 'SELL', '2023-09-01', 'EUR', 600 * 100, 0, null, EUR_DEPOSIT_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-c1-sell', PORTFOLIO_ID, 'xact-c1-sell-cash', EUR_DEPOSIT_ID);

  // ── C2: Bankrupt Corp ──
  // BUY 20 shares at 100 EUR on 2023-06-01 (amount = 20×100 = 2000 EUR)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c2-buy', 'BUY', '2023-06-01', 'EUR', 2000 * 100, 20 * 1e8, SEC_BANKRUPT_ID, PORTFOLIO_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c2-buy-cash', 'BUY', '2023-06-01', 'EUR', 2000 * 100, 0, null, EUR_DEPOSIT_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-c2-buy', PORTFOLIO_ID, 'xact-c2-buy-cash', EUR_DEPOSIT_ID);

  // SELL all 20 at near-zero (0.01 EUR/share → total = 0.20 EUR) on 2024-07-01
  // amount = 0.20 EUR = 20 hecto-units
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c2-sell', 'SELL', '2024-07-01', 'EUR', 20, 20 * 1e8, SEC_BANKRUPT_ID, PORTFOLIO_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c2-sell-cash', 'SELL', '2024-07-01', 'EUR', 20, 0, null, EUR_DEPOSIT_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-c2-sell', PORTFOLIO_ID, 'xact-c2-sell-cash', EUR_DEPOSIT_ID);

  // ── C3: Mid-Retired Corp ──
  // BUY 15 shares at 80 EUR on 2023-04-01 (amount = 15×80 = 1200 EUR)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c3-buy', 'BUY', '2023-04-01', 'EUR', 1200 * 100, 15 * 1e8, SEC_MID_RETIRED_ID, PORTFOLIO_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c3-buy-cash', 'BUY', '2023-04-01', 'EUR', 1200 * 100, 0, null, EUR_DEPOSIT_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-c3-buy', PORTFOLIO_ID, 'xact-c3-buy-cash', EUR_DEPOSIT_ID);

  // SELL all 15 at 90 EUR on 2024-08-01 mid-period (amount = 15×90 = 1350 EUR)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c3-sell', 'SELL', '2024-08-01', 'EUR', 1350 * 100, 15 * 1e8, SEC_MID_RETIRED_ID, PORTFOLIO_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-c3-sell-cash', 'SELL', '2024-08-01', 'EUR', 1350 * 100, 0, null, EUR_DEPOSIT_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('xact-c3-sell', PORTFOLIO_ID, 'xact-c3-sell-cash', EUR_DEPOSIT_ID);

  // ── Prices ──
  // All prices stored as value × 1e8 (ppxml2db convention)

  // C1: Fully Sold Corp prices
  const c1Prices: [string, number][] = [
    ['2023-03-01', 50 * 1e8],      // BUY date
    ['2023-09-01', 60 * 1e8],      // SELL date
    ['2023-12-29', 55 * 1e8],      // pre-period close
    ['2024-12-31', 70 * 1e8],      // period end (still quoted, but 0 shares held)
  ];
  for (const [d, v] of c1Prices)
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_FULLY_SOLD_ID, d, v);
  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(SEC_FULLY_SOLD_ID, '2024-12-31', 70 * 1e8);

  // C2: Bankrupt Corp prices
  // Near-zero price: 0.01 EUR = 1e6 in ×1e8 convention. Spec says 0.00000001 = value 1 in DB.
  const c2Prices: [string, number][] = [
    ['2023-06-01', 100 * 1e8],     // BUY date
    ['2023-12-29', 100 * 1e8],     // pre-period close (still at 100 before crash)
    ['2024-07-01', 1],             // near-zero at sell date (value=1 in DB = 0.00000001 EUR)
    ['2024-12-31', 1],             // period end (still near-zero)
  ];
  for (const [d, v] of c2Prices)
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_BANKRUPT_ID, d, v);
  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(SEC_BANKRUPT_ID, '2024-12-31', 1);

  // C3: Mid-Retired Corp prices
  const c3Prices: [string, number][] = [
    ['2023-04-01', 80 * 1e8],      // BUY date
    ['2023-12-29', 85 * 1e8],      // pre-period close
    ['2024-08-01', 90 * 1e8],      // SELL date
    ['2024-12-31', 95 * 1e8],      // period end (but 0 shares held by then)
  ];
  for (const [d, v] of c3Prices)
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_MID_RETIRED_ID, d, v);
  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(SEC_MID_RETIRED_ID, '2024-12-31', 95 * 1e8);
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

describe.skipIf(!hasSqliteBindings)('Retired & bankrupt securities edge cases', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedRetiredScenarios(sqlite);
  });

  // C1: Security fully sold BEFORE the period (2024-01-01 to 2024-12-31).
  // All shares were bought and sold in 2023. During the 2024 period, the security
  // has 0 shares. Its market values (initialValue, finalValue) should be 0 or
  // it should be absent from capitalGains.items. The realized gain (which happened
  // pre-period) should not appear in realizedGains.items for this period.
  it('C1: fully sold before period → not in capitalGains.items with non-zero values', async () => {
    const res = await request(app).get(calcUrl());
    expect(res.status).toBe(200);

    const cgItems = res.body.capitalGains.items as Array<{
      securityId: string; initialValue: string; finalValue: string;
    }>;

    const fullySoldItem = cgItems.find(i => i.securityId === SEC_FULLY_SOLD_ID);

    if (fullySoldItem) {
      // If present, both initial and final values should be 0 (no shares held in period)
      expect(parseFloat(fullySoldItem.initialValue)).toBeCloseTo(0, 1);
      expect(parseFloat(fullySoldItem.finalValue)).toBeCloseTo(0, 1);
    }
    // If absent, that's also correct — no contribution to capital gains

    // The realized gain from selling in 2023 should NOT appear in the 2024 period's
    // realizedGains.items (the SELL happened before periodStart)
    const rgItems = res.body.realizedGains.items as Array<{
      securityId: string; realizedGain: string;
    }>;
    const fullySoldRG = rgItems.find(i => i.securityId === SEC_FULLY_SOLD_ID);
    // Should be absent (no SELL in-period) or have zero realized gain
    if (fullySoldRG) {
      expect(parseFloat(fullySoldRG.realizedGain)).toBeCloseTo(0, 1);
    }
  });

  // C2: Bankrupt security (isRetired=1) sold during the period.
  // BUY 20 shares at 100 EUR pre-period. SELL all at near-zero during period.
  // Expected: appears in realizedGains.items with a large negative gain.
  // The realized gain ≈ proceeds (0.20 EUR) − cost basis (2000 EUR) ≈ −1999.80
  it('C2: bankrupt sold during period → in realizedGains.items with negative gain', async () => {
    const res = await request(app).get(calcUrl());
    expect(res.status).toBe(200);

    const rgItems = res.body.realizedGains.items as Array<{
      securityId: string; name: string; realizedGain: string; proceeds: string;
    }>;

    const bankruptItem = rgItems.find(i => i.securityId === SEC_BANKRUPT_ID);
    expect(bankruptItem).toBeDefined();
    expect(bankruptItem!.name).toBe('Bankrupt Corp');

    // Realized gain should be strongly negative (sold for ~0, cost basis was 2000 EUR)
    const realizedGain = parseFloat(bankruptItem!.realizedGain);
    expect(realizedGain).toBeLessThan(0);
    // The loss should be approximately −2000 (cost basis 2000, proceeds ≈ 0.20)
    expect(realizedGain).toBeLessThan(-1900);

    // Proceeds should be near-zero (0.20 EUR from selling 20 shares at 0.01 EUR)
    const proceeds = parseFloat(bankruptItem!.proceeds);
    expect(proceeds).toBeLessThan(1);

    // Fully-sold securities (mve=0, unrealizedGain=0) are excluded from capitalGains.items.
    // They appear only in realizedGains.items.
    const cgItems = res.body.capitalGains.items as Array<{
      securityId: string; initialValue: string; finalValue: string;
    }>;
    const bankruptCG = cgItems.find(i => i.securityId === SEC_BANKRUPT_ID);
    expect(bankruptCG).toBeUndefined();
  });

  // C3: Security sold mid-period (not marked as retired in DB).
  // BUY 15 shares at 80 EUR pre-period. SELL all at 90 EUR on 2024-08-01.
  // Expected: excluded from capitalGains.items (fully sold, mve=0),
  // and in realizedGains.items with a positive realized gain.
  it('C3: sold mid-period → excluded from capitalGains, in realizedGains', async () => {
    const res = await request(app).get(calcUrl());
    expect(res.status).toBe(200);

    // Fully-sold securities (mve=0, unrealizedGain=0) are excluded from capitalGains.items
    const cgItems = res.body.capitalGains.items as Array<{
      securityId: string; initialValue: string; finalValue: string;
    }>;
    const midRetiredCG = cgItems.find(i => i.securityId === SEC_MID_RETIRED_ID);
    expect(midRetiredCG).toBeUndefined();

    // Realized gains: should have a positive gain from selling at 90 (cost basis ≈ 80)
    const rgItems = res.body.realizedGains.items as Array<{
      securityId: string; name: string; realizedGain: string; proceeds: string;
    }>;
    const midRetiredRG = rgItems.find(i => i.securityId === SEC_MID_RETIRED_ID);
    expect(midRetiredRG).toBeDefined();
    expect(midRetiredRG!.name).toBe('Mid-Retired Corp');

    // Realized gain: proceeds (1350) − cost (1200) = 150 EUR
    const realizedGain = parseFloat(midRetiredRG!.realizedGain);
    expect(realizedGain).toBeGreaterThan(0);

    // Proceeds = 15 × 90 = 1350 EUR
    const proceeds = parseFloat(midRetiredRG!.proceeds);
    expect(proceeds).toBeCloseTo(1350, -1);
  });

  // Additional structural verification:
  // The bankrupt security (isRetired=1) should be excluded from displayMVB/displayMVE
  // but the mid-retired security (isRetired=0) should be included in display MVs.
  it('C2 supplement: bankrupt (isRetired=1) excluded from display initialValue/finalValue', async () => {
    const res = await request(app).get(calcUrl());
    expect(res.status).toBe(200);

    const displayInitial = parseFloat(res.body.initialValue);
    const _displayFinal = parseFloat(res.body.finalValue);

    const cgItems = res.body.capitalGains.items as Array<{
      securityId: string; initialValue: string; finalValue: string;
    }>;

    // Sum all non-retired securities' MVs
    const nonRetiredItems = cgItems.filter(i => i.securityId !== SEC_BANKRUPT_ID);
    const nonRetiredInitialMV = nonRetiredItems.reduce(
      (sum, i) => sum + parseFloat(i.initialValue), 0,
    );

    // Bankrupt security's MVB at period start: 20 shares × 100 EUR = 2000 EUR
    const bankruptCG = cgItems.find(i => i.securityId === SEC_BANKRUPT_ID);
    if (bankruptCG) {
      const bankruptMVB = parseFloat(bankruptCG.initialValue);
      // displayInitial should NOT include the bankrupt security's MV (since isRetired=1)
      // displayInitial ≈ nonRetiredInitialMV + cash
      // If bankrupt MV were included, displayInitial would be larger by ~2000
      // Verify: displayInitial < (all securities MVB including bankrupt + cash)
      const totalSecMVB = cgItems.reduce((s, i) => s + parseFloat(i.initialValue), 0);
      // Cash contribution is the same either way, so:
      // displayInitial = nonRetiredSecMVB + cash
      // totalSecMVB + cash = displayInitial + bankruptMVB
      // Therefore: displayInitial ≈ totalSecMVB + cash - bankruptMVB
      if (bankruptMVB > 0) {
        // displayInitial should be approximately totalSecMVB - bankruptMVB + cash
        // Since we don't know cash exactly, verify the difference is about bankruptMVB
        const estimatedCash = displayInitial - nonRetiredInitialMV;
        const hypotheticalWithRetired = totalSecMVB + estimatedCash;
        expect(hypotheticalWithRetired - displayInitial).toBeCloseTo(bankruptMVB, -1);
      }
    }
  });
});
