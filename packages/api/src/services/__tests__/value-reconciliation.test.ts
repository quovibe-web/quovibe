// BUG-33 / BUG-34 regression coverage.
//
// BUG-33: Dashboard hero ("Portfolio Value") disagreed with Investments /
//         Allocation ("Total Market Value"). Dashboard used `displayMVE`
//         (excludes retired items) while reports used `statement.totals.marketValue`
//         (includes everything held).
//
// BUG-34: The Analytics Calculation breakdown did not sum to MVE because the
//         displayed MVB/MVE excluded retired items while the component rows
//         (capital gains, realized, etc.) were summed over ALL securities.
//         Identity `displayMVE - displayMVB == Σ components` was violated whenever
//         a retired security had non-zero shares or its MV changed during the
//         period.
//
// The single fix — swap `display*` → `total*` in the calculation summary —
// closes both gaps: MV displayed everywhere matches statement-of-assets, and
// the breakdown balances arithmetically.

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { getPortfolioCalc, getStatementOfAssets } from '../performance.service';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

// ─── Schema (minimal ppxml2db-compatible) ───────────────────────────────────

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
    CREATE TABLE config_entry (
      uuid TEXT,
      config_set INTEGER,
      name TEXT NOT NULL,
      data TEXT
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
//   shares:  integer × 1e8
//   amounts: integer × 100
//   prices:  integer × 1e8
const shares = (n: number) => Math.round(n * 1e8);  // native-ok
const euros  = (n: number) => Math.round(n * 100);  // native-ok
const price  = (n: number) => Math.round(n * 1e8);  // native-ok

const PERIOD = { start: '2024-01-01', end: '2024-12-31' };
const ACTIVE_SEC = 'sec-active';
const RETIRED_SEC = 'sec-retired';
const DEPOSIT = 'acct-cash';

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = createDb();
  db.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
    .run(ACTIVE_SEC, 'Active Corp', 'EUR', 0);
  db.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
    .run(RETIRED_SEC, 'Retired Corp', 'EUR', 1);
  db.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(DEPOSIT, 'Cash', 'account', 'EUR');
});

function insertDeposit(uuid: string, date: string, amountEur: number) {
  db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype)
    VALUES (?, 'DEPOSIT', ?, 'EUR', ?, 0, ?, 'account')`).run(uuid, date, euros(amountEur), DEPOSIT);
}
function insertBuy(uuid: string, date: string, sec: string, shareCount: number, priceEach: number) {
  const gross = euros(shareCount * priceEach);
  db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
    VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'account')`).run(
    uuid, date, gross, shares(shareCount), sec, DEPOSIT,
  );
}
function insertSell(uuid: string, date: string, sec: string, shareCount: number, priceEach: number) {
  const gross = euros(shareCount * priceEach);
  db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
    VALUES (?, 'SELL', ?, 'EUR', ?, ?, ?, ?, 'account')`).run(
    uuid, date, gross, shares(shareCount), sec, DEPOSIT,
  );
}
function setPrice(sec: string, date: string, priceEur: number) {
  db.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(sec, date, price(priceEur));
}

// ─── Scenario: retired holding with MV change during period ──────────────────
//
// Setup (all EUR, single deposit account):
//   Pre-period: deposit €10,000, buy 10 shares of RETIRED @ €200 (cost €2000)
//   2024-01-01 (period start): retired priced €210 → retired MVB = €2100
//   2024-03-01: buy 10 shares of ACTIVE @ €100 (cost €1000)
//   2024-06-01: sell 5 shares of RETIRED @ €220 (proceeds €1100)
//   2024-12-31 (period end): active priced €120, retired priced €200
//     → active MVE = €1200, retired MVE = 5 × €200 = €1000
//     → cash end = 10,000 − 2000 − 1000 + 1100 = €8100
//
// Expected aggregates:
//   totalMVE  = 1200 (active) + 1000 (retired) + 8100 (cash) = 10,300
//   displayMVE = 1200 + 8100 = 9300   (retired excluded from "display")
//   statement.totals.marketValue = totalMVE = 10,300 (reports side includes retired)
//   absoluteChange (full) = totalMVE − totalMVB; identity Σ components = absoluteChange must hold.
//
// After the fix (swap `display*` → `total*` in the summary):
//   finalValue === statement.totals.marketValue       ← BUG-33
//   initialValue + Σ components === finalValue         ← BUG-34

describe('value reconciliation (BUG-33 / BUG-34)', () => {
  beforeEach(() => {
    // Pre-period seed
    insertDeposit('d1', '2023-01-01', 10_000);
    insertBuy('b-r', '2023-06-01', RETIRED_SEC, 10, 200);
    setPrice(RETIRED_SEC, '2023-06-01', 200);
    setPrice(RETIRED_SEC, '2024-01-01', 210);
    setPrice(RETIRED_SEC, '2024-06-01', 220);
    setPrice(RETIRED_SEC, '2024-12-31', 200);

    // In-period activity
    insertBuy('b-a', '2024-03-01', ACTIVE_SEC, 10, 100);
    setPrice(ACTIVE_SEC, '2024-01-01', 100);
    setPrice(ACTIVE_SEC, '2024-03-01', 100);
    setPrice(ACTIVE_SEC, '2024-12-31', 120);

    insertSell('s-r', '2024-06-01', RETIRED_SEC, 5, 220);
  });

  it.skipIf(!hasSqliteBindings)('finalValue matches statement-of-assets total at period end (BUG-33)', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const statement = getStatementOfAssets(db, PERIOD.end);

    const calcMV = new Decimal(calc.finalValue);
    const statementMV = new Decimal(statement.totals.marketValue);

    // The two surfaces must agree — there is one canonical "current portfolio value".
    expect(calcMV.toFixed(2)).toBe(statementMV.toFixed(2));
  });

  it.skipIf(!hasSqliteBindings)('breakdown components sum to finalValue − initialValue (BUG-34)', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);

    const mvb = new Decimal(calc.initialValue);
    const mve = new Decimal(calc.finalValue);
    const capitalGains = new Decimal(calc.capitalGains.total);
    const realized = new Decimal(calc.realizedGains.total);
    const earnings = new Decimal(calc.earnings.total);
    const fees = new Decimal(calc.fees.total);
    const taxes = new Decimal(calc.taxes.total);
    const cashFx = new Decimal(calc.cashCurrencyGains.total);
    const pnt = new Decimal(calc.performanceNeutralTransfers.total);

    const componentSum = capitalGains
      .plus(realized)
      .plus(earnings)
      .minus(fees)
      .minus(taxes)
      .plus(cashFx)
      .plus(pnt);

    const mvbPlusComponents = mvb.plus(componentSum);

    // Identity: MVB + Σ components must equal MVE (< €0.01 tolerance for rounding).
    expect(mvbPlusComponents.minus(mve).abs().lte(new Decimal('0.01'))).toBe(true);
  });

  it.skipIf(!hasSqliteBindings)('absoluteChange equals finalValue − initialValue', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);

    const mvb = new Decimal(calc.initialValue);
    const mve = new Decimal(calc.finalValue);
    const absoluteChange = new Decimal(calc.absoluteChange);

    expect(absoluteChange.minus(mve.minus(mvb)).abs().lte(new Decimal('0.01'))).toBe(true);
  });
});

// ─── Symmetric coverage: retired *account* with lingering balance ──────────
//
// The BUG-33 fix removed the retired-account filter from the cash-balance
// aggregation path too (the `scopedActiveDepositAccIds` codepath). A retired
// deposit account that still holds cash must show up in Dashboard / Calculation
// NAV exactly like statement-of-assets does, otherwise the same display ↔ report
// drift returns in a second place.

describe('value reconciliation — retired deposit account with lingering balance', () => {
  const RETIRED_DEPOSIT = 'acct-retired';

  beforeEach(() => {
    // Add a second deposit account and mark it retired AFTER it receives funds.
    db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired) VALUES (?, ?, ?, ?, ?)`)
      .run(RETIRED_DEPOSIT, 'Old broker cash', 'account', 'EUR', 1);
    // Pre-period deposit into the retired account, never moved — classic "account
    // closed but a few euros stuck" case users actually hit.
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype)
      VALUES (?, 'DEPOSIT', ?, 'EUR', ?, 0, ?, 'account')`).run(
      'd-retired', '2023-02-01', euros(500), RETIRED_DEPOSIT,
    );
    // Also seed a tiny active-side so calc has something to report.
    insertDeposit('d-active', '2023-02-01', 1000);
    setPrice(ACTIVE_SEC, '2024-01-01', 100);
    setPrice(ACTIVE_SEC, '2024-12-31', 100);
  });

  it.skipIf(!hasSqliteBindings)('retired account balance is included in finalValue (BUG-33 symmetric)', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const statement = getStatementOfAssets(db, PERIOD.end);

    // Both surfaces must see the €500 stranded in the retired account.
    expect(new Decimal(calc.finalValue).toFixed(2)).toBe(
      new Decimal(statement.totals.marketValue).toFixed(2),
    );
    // And the €500 must actually be there — guard against both sides silently
    // converging to "€1000 cash, retired ignored" (that would still match but be
    // wrong).
    expect(new Decimal(calc.finalValue).gte(new Decimal('1500'))).toBe(true);
  });
});
