// Service-level tests for the openPositionPnL field in getPortfolioCalc.
// Verifies broker-style PMC/FIFO unrealized PnL on currently-held shares.
// Does NOT test TTWROR, IRR, or period-relative capitalGains — those have separate coverage.

import { describe, it, expect, beforeEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { CostMethod } from '@quovibe/shared';
import { getPortfolioCalc } from '../performance.service';
import { createTestDb, hasSqliteBindings, shares, euros, price } from './test-fixtures';

const PERIOD = { start: '2023-01-01', end: '2025-12-31' };
const SEC   = 'sec-001';
const ACCT  = 'acct-001';

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = createTestDb();
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
