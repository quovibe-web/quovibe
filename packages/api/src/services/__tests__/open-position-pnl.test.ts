// Service-level tests for the openPositionPnL field in getPortfolioCalc.
// Verifies broker-style PMC/FIFO unrealized PnL on currently-held shares.
// Does NOT test TTWROR, IRR, or period-relative capitalGains — those have separate coverage.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { CostMethod } from '@quovibe/shared';
import { getPortfolioCalc } from '../performance.service';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

// ─── Minimal schema ──────────────────────────────────────────────────────────

function createDb(): BetterSqlite3.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(`
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
      currency TEXT NOT NULL DEFAULT 'EUR',
      amount INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      security TEXT,
      account TEXT NOT NULL DEFAULT '',
      source TEXT,
      updatedAt TEXT NOT NULL DEFAULT '',
      fees INTEGER NOT NULL DEFAULT 0,
      taxes INTEGER NOT NULL DEFAULT 0,
      acctype TEXT NOT NULL DEFAULT 'account',
      _xmlid INTEGER NOT NULL DEFAULT 0,
      _order INTEGER NOT NULL DEFAULT 0
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
  db.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`).run('portfolio.currency', 'EUR');
  return db;
}

// ppxml2db unit conventions:
//   shares:  integer × 1e8   (10 shares  → 10 * 1e8 = 1_000_000_000)
//   amounts: integer × 100   (€1000      → 100_000)
//   prices:  integer × 1e8   (€10.05     → 10.05 * 1e8 = 1_005_000_000)
const shares = (n: number) => Math.round(n * 1e8);  // native-ok (test utility, not financial calc)
const euros  = (n: number) => Math.round(n * 100);  // native-ok
const price  = (n: number) => Math.round(n * 1e8);  // native-ok

const PERIOD = { start: '2023-01-01', end: '2025-12-31' };
const SEC   = 'sec-001';
const ACCT  = 'acct-001';

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = createDb();
  db.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`).run(SEC, 'TestCorp', 'EUR');
  db.prepare(`INSERT INTO account  (uuid, name, type, currency) VALUES (?, ?, ?, ?)`).run(ACCT, 'Deposit', 'account', 'EUR');
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function insertBuy(uuid: string, date: string, shareCount: number, priceEach: number, feeEur: number) {
  const gross = euros(shareCount * priceEach);
  const fee   = euros(feeEur);
  db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    uuid, 'BUY', date, 'EUR', gross + fee, shares(shareCount), SEC, ACCT, fee,
  );
  db.prepare(`INSERT INTO xact_unit (xact, type, amount) VALUES (?, ?, ?)`).run(uuid, 'FEE', fee);
}

function insertSell(uuid: string, date: string, shareCount: number, priceEach: number) {
  const gross = euros(shareCount * priceEach);
  db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    uuid, 'SELL', date, 'EUR', gross, shares(shareCount), SEC, ACCT,
  );
}

function setLatestPrice(priceEur: number) {
  db.prepare(`INSERT OR REPLACE INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`).run(
    SEC, '2025-01-15', price(priceEur),
  );
}

function setHistoricalPrice(date: string, priceEur: number) {
  db.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(
    SEC, date, price(priceEur),
  );
}

// ─── Scenario 1: buy-and-hold ─────────────────────────────────────────────────

describe('openPositionPnL — buy-and-hold', () => {
  it.skipIf(!hasSqliteBindings)('computes unrealized PnL using PMC (buy fee capitalized into cost basis)', () => {
    // Buy 100 shares @ €10 each, fee €5 → PMC = (1000 + 5) / 100 = €10.05
    // Current price → €12 per share
    // openPositionValue = 100 × 12 = €1200
    // openPositionCost  = 100 × 10.05 = €1005
    // openPositionPnL   = 1200 − 1005 = €195
    // openPositionPct   = 195 / 1005 ≈ 0.19402985...
    insertBuy('b1', '2024-01-10', 100, 10, 5);
    setHistoricalPrice('2023-01-01', 9);   // priceAtPeriodStart (before period open)
    setLatestPrice(12);

    const result = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const pnl = result.openPositionPnL;

    expect(parseFloat(pnl.value)).toBeCloseTo(195, 2);
    expect(parseFloat(pnl.cost)).toBeCloseTo(1005, 2);
    expect(parseFloat(pnl.marketValue)).toBeCloseTo(1200, 2);
    expect(parseFloat(pnl.percentage)).toBeCloseTo(195 / 1005, 6);

    // FIFO should equal MA when there are no partial sells
    expect(parseFloat(pnl.fifo.value)).toBeCloseTo(195, 2);
    expect(parseFloat(pnl.fifo.cost)).toBeCloseTo(1005, 2);
  });
});

// ─── Scenario 2: partial sell ────────────────────────────────────────────────

describe('openPositionPnL — partial sell', () => {
  it.skipIf(!hasSqliteBindings)('sold shares do not inflate the cost basis of remaining shares', () => {
    // Buy 100 shares @ €10, fee €5 → PMC = €10.05 for all 100 shares
    // Sell 40 shares @ €15 (realized gain on 40 lots)
    // After sell: 60 shares remain, PMC stays at €10.05 (MA convention)
    // Latest price: €14
    // openPositionCost  = 60 × 10.05 = €603
    // openPositionValue = 60 × 14    = €840
    // openPositionPnL   = 840 − 603  = €237
    insertBuy('b1',  '2024-01-10', 100, 10, 5);
    insertSell('s1', '2024-06-01',  40, 15);
    setHistoricalPrice('2023-01-01', 9);
    setLatestPrice(14);

    const result = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const pnl = result.openPositionPnL;

    expect(parseFloat(pnl.cost)).toBeCloseTo(603, 2);         // 60 × 10.05
    expect(parseFloat(pnl.marketValue)).toBeCloseTo(840, 2);  // 60 × 14
    expect(parseFloat(pnl.value)).toBeCloseTo(237, 2);
    expect(parseFloat(pnl.percentage)).toBeCloseTo(237 / 603, 6);
  });
});

// ─── Scenario 3: fully closed position ──────────────────────────────────────

describe('openPositionPnL — fully closed position', () => {
  it.skipIf(!hasSqliteBindings)('returns zero PnL and zero percentage when no shares are held', () => {
    // Buy 50 shares, sell all 50 — nothing held today
    insertBuy('b1',  '2024-01-10', 50, 10, 0);
    insertSell('s1', '2024-09-01', 50, 12);
    setHistoricalPrice('2023-01-01', 9);
    setLatestPrice(13);   // current price is irrelevant — nothing held

    const result = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const pnl = result.openPositionPnL;

    expect(parseFloat(pnl.value)).toBe(0);
    expect(parseFloat(pnl.cost)).toBe(0);
    expect(parseFloat(pnl.marketValue)).toBe(0);
    expect(parseFloat(pnl.percentage)).toBe(0);
    expect(parseFloat(pnl.fifo.value)).toBe(0);
  });
});

// ─── Scenario 4: PnL is independent of the reporting period ─────────────────

describe('openPositionPnL — period independence', () => {
  it.skipIf(!hasSqliteBindings)('same openPositionPnL regardless of periodStart', () => {
    // Bought before both periods — cost basis must not change with period window
    insertBuy('b1', '2020-03-15', 100, 8, 0);   // long before either period
    setHistoricalPrice('2023-01-01', 9);
    setHistoricalPrice('2024-01-01', 10);
    setLatestPrice(15);

    const ytd   = getPortfolioCalc(db, { start: '2025-01-01', end: '2025-12-31' }, CostMethod.MOVING_AVERAGE, true);
    const allTime = getPortfolioCalc(db, { start: '2020-01-01', end: '2025-12-31' }, CostMethod.MOVING_AVERAGE, true);

    // openPositionPnL must be the same in both periods — it is since-inception
    expect(ytd.openPositionPnL.value).toBe(allTime.openPositionPnL.value);
    expect(ytd.openPositionPnL.percentage).toBe(allTime.openPositionPnL.percentage);
  });
});

// ─── Scenario 5: FIFO vs MA differ after partial sell ───────────────────────

describe('openPositionPnL — FIFO vs MA after partial sell', () => {
  it.skipIf(!hasSqliteBindings)('FIFO and MA both expose unrealized PnL; sum matches', () => {
    // Buy lot A: 50 shares @ €10 (fee €0) → lot cost €500
    // Buy lot B: 50 shares @ €12 (fee €0) → lot cost €600
    // Sell 50 shares @ €14
    //   FIFO: sells lot A (50 × €10) — remaining 50 shares from lot B at €12 each
    //   MA:   avgCost = (500+600)/100 = €11 — remaining 50 shares at avg €11 each
    // Latest price: €16
    insertBuy('b1', '2023-06-01', 50, 10, 0);
    insertBuy('b2', '2023-09-01', 50, 12, 0);
    insertSell('s1', '2024-01-15', 50, 14);
    setHistoricalPrice('2023-01-01', 9);
    setLatestPrice(16);

    const result = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const pnl = result.openPositionPnL;

    // MA: remaining cost = 50 × 11 = 550, value = 50 × 16 = 800, pnl = 250
    expect(parseFloat(pnl.cost)).toBeCloseTo(550, 2);
    expect(parseFloat(pnl.value)).toBeCloseTo(250, 2);

    // FIFO: remaining cost = 50 × 12 = 600, value = 50 × 16 = 800, pnl = 200
    expect(parseFloat(pnl.fifo.cost)).toBeCloseTo(600, 2);
    expect(parseFloat(pnl.fifo.value)).toBeCloseTo(200, 2);
  });
});
