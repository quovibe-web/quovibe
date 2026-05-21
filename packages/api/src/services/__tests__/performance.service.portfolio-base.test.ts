import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import Decimal from 'decimal.js';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { buildRateMap } from '../fx.service';
import {
  projectTransactionsToBaseCurrency,
  getPortfolioCalc,
  getSecurityPerformanceList,
  getStatementOfAssets,
  getChartData,
  getReturnsHeatmap,
  type PerfTransaction,
  type CalcScope,
} from '../performance.service';
import { CostMethod } from '@quovibe/shared';
import type { TransactionUnit } from '@quovibe/shared';

let db: Database.Database;

function makeTx(opts: {
  uuid: string;
  date: string;
  type: string;
  amount: number;
  currency: string;
  shares?: number | null;
  securityId?: string | null;
  units?: TransactionUnit[];
}): PerfTransaction {
  return {
    id: opts.uuid,
    type: opts.type as PerfTransaction['type'],
    date: opts.date,
    currencyCode: opts.currency,
    amount: opts.amount,
    shares: opts.shares ?? 0,
    securityId: opts.securityId ?? null,
    accountId: 'a1',
    units: opts.units ?? [],
    note: null,
    source: null,
    updatedAt: null,
  };
}

beforeEach(() => {
  db = new Database(':memory:');
  applyBootstrap(db);
});

describe('projectTransactionsToBaseCurrency', () => {
  it('passes through same-currency txs unchanged', () => {
    const tx = makeTx({ uuid: 't1', date: '2025-01-15', type: 'DEPOSIT', amount: 1000, currency: 'EUR' });
    const { projectedTxs, unresolvedSecurityIds } =
      projectTransactionsToBaseCurrency([tx], 'EUR', new Map());
    expect(projectedTxs).toHaveLength(1);
    expect(projectedTxs[0].amount).toBe(1000);
    expect(projectedTxs[0].currencyCode).toBe('EUR');
    expect(unresolvedSecurityIds.size).toBe(0);
  });

  it('uses GROSS_VALUE FOREX leg when forex_currency matches base', () => {
    const unit: TransactionUnit = {
      id: '',
      transactionId: 't1',
      type: 'GROSS_VALUE',
      amount: 1000,
      currencyCode: 'USD',
      fxAmount: 830,
      fxCurrencyCode: 'EUR',
      fxRate: 0.83,
    };
    const tx = makeTx({
      uuid: 't1', date: '2025-01-15', type: 'BUY', amount: 1000, currency: 'USD',
      shares: 5, securityId: 's1', units: [unit],
    });
    const { projectedTxs } = projectTransactionsToBaseCurrency([tx], 'EUR', new Map());
    expect(projectedTxs[0].amount).toBeCloseTo(830, 2);
    expect(projectedTxs[0].currencyCode).toBe('EUR');
  });

  it('falls back to vf_exchange_rate when no GROSS_VALUE unit', () => {
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
       VALUES ('2025-01-15','USD','EUR','0.85')`,
    ).run();
    const rateMap = buildRateMap(db, 'USD', 'EUR', '2025-01-15', '2025-01-15');
    const rateMaps = new Map([['USD', rateMap]]);
    const tx = makeTx({
      uuid: 't1', date: '2025-01-15', type: 'BUY', amount: 1000, currency: 'USD',
      shares: 5, securityId: 's1',
    });
    const { projectedTxs } = projectTransactionsToBaseCurrency([tx], 'EUR', rateMaps);
    expect(projectedTxs[0].amount).toBeCloseTo(850, 2);
    expect(projectedTxs[0].currencyCode).toBe('EUR');
  });

  it('tags security unresolved and drops tx when no rate available', () => {
    const tx = makeTx({
      uuid: 't1', date: '2025-01-15', type: 'BUY', amount: 1000, currency: 'USD',
      shares: 5, securityId: 's1',
    });
    const { projectedTxs, unresolvedSecurityIds } =
      projectTransactionsToBaseCurrency([tx], 'EUR', new Map());
    expect(projectedTxs).toHaveLength(0);
    expect(unresolvedSecurityIds.has('s1')).toBe(true);
  });

  it('does NOT drop cash-only txs (no securityId) when ccy mismatch and no rate', () => {
    const tx = makeTx({
      uuid: 't1', date: '2025-01-15', type: 'DEPOSIT', amount: 1000, currency: 'USD',
    });
    const { projectedTxs, unresolvedSecurityIds } =
      projectTransactionsToBaseCurrency([tx], 'EUR', new Map());
    expect(projectedTxs).toHaveLength(1);
    expect(unresolvedSecurityIds.size).toBe(0);
  });
});

describe('getPortfolioCalc — BRK-B (USD) in EUR base aggregation', () => {
  // Fixture: 2 BUYs of BRK-B (USD) in a EUR-base portfolio, plus 1 DEPOSIT.
  // Mirrors the user-reported €1153.93 dashboard mixed-unit bug.
  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);

    // Seed base currency
    db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();

    // Accounts: EUR deposit + securities account
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
       VALUES ('valores','Cash EUR','account','EUR',0,'2026-01-01',1,0)`,
    ).run();
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
       VALUES ('test','Broker','portfolio',NULL,0,'valores','2026-01-01',2,1)`,
    ).run();

    // BRK-B security (USD)
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
       VALUES ('brkb','Berkshire Hathaway Inc.','USD',0,'2026-01-01')`,
    ).run();

    // BUY 1 on 2026-05-01: 1 share, 406.79 EUR / 473.01 USD (rate 1.1628)
    // Securities-side xact (account = portfolio)
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b1s','BUY','2026-05-01','EUR',40679,100000000,'brkb','test','portfolio','2026-05-01',1,1)`,
    ).run();
    // Cash-side xact (account = deposit, shares = 0)
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b1c','BUY','2026-05-01','EUR',40679,0,'brkb','valores','account','2026-05-01',2,2)`,
    ).run();
    db.prepare(
      `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
       VALUES ('b1s','test','b1c','valores','buysell')`,
    ).run();
    // FOREX unit on securities-side xact so cost-basis resolver picks up USD amount
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES ('b1s','FOREX',40679,'EUR',47301,'USD','1.1628')`,
    ).run();

    // BUY 2 on 2026-05-08: 1 share, 404.68 EUR / 475.94 USD (rate 1.1761)
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b2s','BUY','2026-05-08','EUR',40468,100000000,'brkb','test','portfolio','2026-05-08',3,3)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b2c','BUY','2026-05-08','EUR',40468,0,'brkb','valores','account','2026-05-08',4,4)`,
    ).run();
    db.prepare(
      `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
       VALUES ('b2s','test','b2c','valores','buysell')`,
    ).run();
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES ('b2s','FOREX',40468,'EUR',47594,'USD','1.1761')`,
    ).run();

    // DEPOSIT 1000 EUR on 2025-12-30 (before period start 2025-12-31, so it becomes
    // the opening MVB rather than a period cashflow).  This gives the IRR engine a
    // well-formed problem: MVB≈1000, no mid-period inflows, MVE≈1018.77 → ~5% ann.
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('dep','DEPOSIT','2025-12-30','EUR',100000,0,'valores','account','2025-12-30',5,5)`,
    ).run();

    // Latest price for BRK-B: USD 482.70 on 2026-05-17
    // value = 482.70 × 1e8 = 48270000000
    db.prepare(
      `INSERT INTO latest_price (security, value, tstamp) VALUES ('brkb',48270000000,'2026-05-17')`,
    ).run();

    // FX rates: USD → EUR (multiply convention: amount_usd × rate = amount_eur)
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
        ('2025-12-31','USD','EUR','0.85'),
        ('2026-05-01','USD','EUR','0.860'),
        ('2026-05-08','USD','EUR','0.850'),
        ('2026-05-16','USD','EUR','0.860'),
        ('2026-05-17','USD','EUR','0.860')`,
    ).run();
  });

  it('totalMVE (finalValue) is base-ccy correct: cash(EUR) + sec(USD × rate)', () => {
    // Cash at period end: 1000 EUR deposited on 2025-12-30, minus 406.79 + 404.68 EUR spent on BUYs
    // = 1000 - 811.47 = 188.53 EUR
    // BRK-B MVE: 2 × 482.70 USD × 0.860 EUR/USD = 830.24 EUR
    // Expected totalMVE ≈ 188.53 + 830.24 = 1018.77 EUR
    const result = getPortfolioCalc(
      db,
      { start: '2025-12-31', end: '2026-05-17' },
      CostMethod.FIFO,
      true,
    );
    expect(new Decimal(result.finalValue).toNumber()).toBeCloseTo(1018.77, 0);
  });

  it('TTWROR is in sane band (NOT 401%)', () => {
    const result = getPortfolioCalc(
      db,
      { start: '2025-12-31', end: '2026-05-17' },
      CostMethod.FIFO,
      true,
    );
    const ttwror = new Decimal(result.ttwror ?? '0');
    expect(ttwror.abs().lte(new Decimal('0.5'))).toBe(true);
  });

  it('IRR is finite (NOT 4.96e24%)', () => {
    const result = getPortfolioCalc(
      db,
      { start: '2025-12-31', end: '2026-05-17' },
      CostMethod.FIFO,
      true,
    );
    const irr = new Decimal(result.irr ?? '0');
    expect(irr.abs().lte(new Decimal('0.5'))).toBe(true);
  });
});

describe('getChartData — base ccy rollup matches getPortfolioCalc', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);

    db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();

    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
       VALUES ('valores','Cash EUR','account','EUR',0,'2026-01-01',1,0)`,
    ).run();
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
       VALUES ('test','Broker','portfolio',NULL,0,'valores','2026-01-01',2,1)`,
    ).run();

    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
       VALUES ('brkb','Berkshire Hathaway Inc.','USD',0,'2026-01-01')`,
    ).run();

    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b1s','BUY','2026-05-01','EUR',40679,100000000,'brkb','test','portfolio','2026-05-01',1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b1c','BUY','2026-05-01','EUR',40679,0,'brkb','valores','account','2026-05-01',2,2)`,
    ).run();
    db.prepare(
      `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
       VALUES ('b1s','test','b1c','valores','buysell')`,
    ).run();
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES ('b1s','FOREX',40679,'EUR',47301,'USD','1.1628')`,
    ).run();

    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b2s','BUY','2026-05-08','EUR',40468,100000000,'brkb','test','portfolio','2026-05-08',3,3)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b2c','BUY','2026-05-08','EUR',40468,0,'brkb','valores','account','2026-05-08',4,4)`,
    ).run();
    db.prepare(
      `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
       VALUES ('b2s','test','b2c','valores','buysell')`,
    ).run();
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES ('b2s','FOREX',40468,'EUR',47594,'USD','1.1761')`,
    ).run();

    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('dep','DEPOSIT','2025-12-30','EUR',100000,0,'valores','account','2025-12-30',5,5)`,
    ).run();

    db.prepare(
      `INSERT INTO latest_price (security, value, tstamp) VALUES ('brkb',48270000000,'2026-05-17')`,
    ).run();

    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
        ('2025-12-31','USD','EUR','0.85'),
        ('2026-05-01','USD','EUR','0.860'),
        ('2026-05-08','USD','EUR','0.850'),
        ('2026-05-16','USD','EUR','0.860'),
        ('2026-05-17','USD','EUR','0.860')`,
    ).run();
  });

  it('last chart point marketValue is base-ccy correct (matches getPortfolioCalc finalValue)', () => {
    const period = { start: '2025-12-31', end: '2026-05-17' };
    const calc = getPortfolioCalc(db, period, CostMethod.FIFO, true);
    const points = getChartData(db, period, 'daily');
    const lastMV = points[points.length - 1]?.marketValue ?? '0';
    expect(new Decimal(lastMV).toNumber()).toBeCloseTo(
      new Decimal(calc.finalValue).toNumber(),
      1,
    );
  });
});

describe('getReturnsHeatmap — base ccy rollup', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);

    db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();

    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
       VALUES ('valores','Cash EUR','account','EUR',0,'2026-01-01',1,0)`,
    ).run();
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
       VALUES ('test','Broker','portfolio',NULL,0,'valores','2026-01-01',2,1)`,
    ).run();

    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
       VALUES ('brkb','Berkshire Hathaway Inc.','USD',0,'2026-01-01')`,
    ).run();

    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b1s','BUY','2026-05-01','EUR',40679,100000000,'brkb','test','portfolio','2026-05-01',1,1)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b1c','BUY','2026-05-01','EUR',40679,0,'brkb','valores','account','2026-05-01',2,2)`,
    ).run();
    db.prepare(
      `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
       VALUES ('b1s','test','b1c','valores','buysell')`,
    ).run();
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES ('b1s','FOREX',40679,'EUR',47301,'USD','1.1628')`,
    ).run();

    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b2s','BUY','2026-05-08','EUR',40468,100000000,'brkb','test','portfolio','2026-05-08',3,3)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('b2c','BUY','2026-05-08','EUR',40468,0,'brkb','valores','account','2026-05-08',4,4)`,
    ).run();
    db.prepare(
      `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
       VALUES ('b2s','test','b2c','valores','buysell')`,
    ).run();
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES ('b2s','FOREX',40468,'EUR',47594,'USD','1.1761')`,
    ).run();

    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
       VALUES ('dep','DEPOSIT','2025-12-30','EUR',100000,0,'valores','account','2025-12-30',5,5)`,
    ).run();

    db.prepare(
      `INSERT INTO latest_price (security, value, tstamp) VALUES ('brkb',48270000000,'2026-05-17')`,
    ).run();

    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
        ('2025-12-31','USD','EUR','0.85'),
        ('2026-05-01','USD','EUR','0.860'),
        ('2026-05-08','USD','EUR','0.850'),
        ('2026-05-16','USD','EUR','0.860'),
        ('2026-05-17','USD','EUR','0.860')`,
    ).run();
  });

  it('monthly returns are finite (NOT 1e24)', () => {
    const period = { start: '2025-12-31', end: '2026-05-17' };
    const heatmap = getReturnsHeatmap(db, undefined, period);
    for (const month of heatmap.monthly) {
      const v = new Decimal(month.value);
      expect(v.isFinite()).toBe(true);
      // Generous ±1000% bound to catch absurd mixed-unit values
      expect(v.abs().lte(new Decimal('10'))).toBe(true);
      // Tighter ±50% bound — BRK-B fixture is near-zero monthly, so a
      // double-projection (which would inflate cashflows by FX twice)
      // would blow past this even though it stays under the catastrophic guard.
      expect(v.abs().lte(new Decimal('0.5'))).toBe(true);
    }
  });
});

// ─── getStatementOfAssets — unresolved FX ─────────────────────────────────────

describe('getStatementOfAssets — unresolved FX', () => {
  // Seeds two securities (s1=USD needs FX, s2=EUR same as base) plus accounts
  // and transactions. Caller may optionally seed vf_exchange_rate rows first.
  function seedTwoSec(d: Database.Database): void {
    d.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
    d.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order) VALUES
       ('acct1','Cash','account','EUR',0,'2026-05-17',1,0),
       ('port1','P','portfolio',NULL,0,'2026-05-17',2,1)`,
    ).run();
    d.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt) VALUES
       ('s1','Bad','USD',0,'2026-05-17'),
       ('s2','Good','EUR',0,'2026-05-17')`,
    ).run();
    d.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order) VALUES
       ('t1','BUY','2026-05-01','USD',10000,100000000,'s1','port1','portfolio','2026-05-01',1,1),
       ('t2','BUY','2026-05-01','EUR',10000,100000000,'s2','port1','portfolio','2026-05-01',2,2)`,
    ).run();
    d.prepare(
      `INSERT INTO latest_price (security, value, tstamp) VALUES
       ('s1',10000000000,'2026-05-17'),
       ('s2',10000000000,'2026-05-17')`,
    ).run();
  }

  it('excludes securities with unresolvable FX from totals + reports count', () => {
    // No vf_exchange_rate row for USD→EUR at 2026-05-17 → s1 is unresolved
    seedTwoSec(db);
    const result = getStatementOfAssets(db, '2026-05-17');
    expect(result.totals.unresolvedCount).toBe(1);
    expect(result.totals.unresolvedSecurityIds).toContain('s1');
    // Exact pin: s2 (EUR 100) only — s1 (USD 100, native) MUST NOT leak into total.
    // If a regression removes the `continue` after pushing s1 to
    // unresolvedSecurityIds, totalSecValue would be 200 and this fails.
    expect(new Decimal(result.totals.securityValue).eq(100)).toBe(true);
  });

  it('reports zero unresolved when FX is fully covered', () => {
    seedTwoSec(db);
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
       ('2026-05-17','USD','EUR','0.85')`,
    ).run();
    const result = getStatementOfAssets(db, '2026-05-17');
    expect(result.totals.unresolvedCount).toBe(0);
    expect(result.totals.unresolvedSecurityIds).toHaveLength(0);
  });
});

// ─── getPortfolioCalc — multi-deposit-ccy cash conversion ────────────────────

describe('getPortfolioCalc — multi-deposit-ccy cash conversion', () => {
  it('USD deposit balance converted to EUR base before summing with EUR deposit', () => {
    db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order) VALUES
       ('eur-acct','EUR Cash','account','EUR',0,'2025-12-31',1,0),
       ('usd-acct','USD Cash','account','USD',0,'2025-12-31',2,1),
       ('port1','P','portfolio',NULL,0,'2025-12-31',3,2)`,
    ).run();
    // DEPOSIT 1000 EUR on 2025-12-31 (hecto = 100000)
    // DEPOSIT 1000 USD on 2025-12-31 (hecto = 100000)
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order) VALUES
       ('d1','DEPOSIT','2025-12-31','EUR',100000,0,NULL,'eur-acct','account','2025-12-31',1,1),
       ('d2','DEPOSIT','2025-12-31','USD',100000,0,NULL,'usd-acct','account','2025-12-31',2,2)`,
    ).run();
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
       ('2025-12-31','USD','EUR','0.85'),
       ('2026-05-17','USD','EUR','0.85')`,
    ).run();

    const result = getPortfolioCalc(db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true);
    // Expected finalValue: 1000 EUR + (1000 USD × 0.85) = 1850 EUR
    expect(new Decimal(result.finalValue).toNumber()).toBeCloseTo(1850, 0);
  });

  it('taxonomy scope: per-account FX conversion applied before weight (USD@0.5 weight)', () => {
    // Same seed as the previous test: 1 EUR + 1 USD deposit, both 1000, USD→EUR=0.85.
    // The taxonomy branch (if-true at the cash-loop) applies weight AFTER FX conversion.
    db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
    db.prepare(
      `INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order) VALUES
       ('eur-acct','EUR Cash','account','EUR',0,'2025-12-31',1,0),
       ('usd-acct','USD Cash','account','USD',0,'2025-12-31',2,1),
       ('port1','P','portfolio',NULL,0,'2025-12-31',3,2)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order) VALUES
       ('d1','DEPOSIT','2025-12-31','EUR',100000,0,NULL,'eur-acct','account','2025-12-31',1,1),
       ('d2','DEPOSIT','2025-12-31','USD',100000,0,NULL,'usd-acct','account','2025-12-31',2,2)`,
    ).run();
    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
       ('2025-12-31','USD','EUR','0.85'),
       ('2026-05-17','USD','EUR','0.85')`,
    ).run();

    const scope: CalcScope = {
      securityIds: new Set<string>(),
      depositAccIds: new Set<string>(['eur-acct', 'usd-acct']),
      txFilter: () => true,
      isTaxonomyScope: true,
      securityWeights: new Map<string, Decimal>(),
      accountWeights: new Map<string, Decimal>([
        ['eur-acct', new Decimal(1)],
        ['usd-acct', new Decimal('0.5')],
      ]),
    };
    const result = getPortfolioCalc(
      db,
      { start: '2025-12-31', end: '2026-05-17' },
      CostMethod.FIFO,
      true,
      false,
      scope,
    );
    // Correct (weight-AFTER-FX): 1000 EUR × 1 + (1000 USD × 0.85) × 0.5 = 1000 + 425 = 1425 EUR
    // Regression (weight-BEFORE-FX, native sum then convert): would treat
    //   (1000 EUR × 1 + 1000 USD × 0.5) = 1500 native-mix → divergent from 1425.
    expect(new Decimal(result.finalValue).toNumber()).toBeCloseTo(1425, 0);
  });
});

// ─── computeSecurityFifoInBase — per-lot FIFO (Phase 3 partial-sells) ────────

describe('costBase via per-lot FIFO (Phase 3 — partial sells)', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);
    db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
    db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                VALUES ('valores','Cash EUR','account','EUR',0,'2026-01-01',1,0)`).run();
    db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                VALUES ('test','Broker','portfolio',NULL,0,'valores','2026-01-01',2,1)`).run();
    db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                VALUES ('brkb','BRK','USD',0,'2026-01-01')`).run();
    db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                ('2026-05-01','USD','EUR','0.860'),
                ('2026-05-08','USD','EUR','0.850'),
                ('2026-05-15','USD','EUR','0.880'),
                ('2026-05-17','USD','EUR','0.870')`).run();
    db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('brkb',50000000000,'2026-05-17')`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('dep','DEPOSIT','2025-12-30','EUR',500000,0,'valores','account','2025-12-30',1,1)`).run();

    // BUY1 2026-05-01: 1 share, USD 500 gross, EUR-side 500/0.860 ≈ 581.40 EUR.
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b1s','BUY','2026-05-01','EUR',58140,100000000,'brkb','test','portfolio','2026-05-01',2,2)`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b1c','BUY','2026-05-01','EUR',58140,0,'brkb','valores','account','2026-05-01',3,3)`).run();
    db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b1s','test','b1c','valores','buysell')`).run();
    db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate) VALUES ('b1s','FOREX',58140,'EUR',50000,'USD','1.1628')`).run();

    // BUY2 2026-05-08: 1 share, USD 510 gross, EUR-side 510/0.850 = 600 EUR
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b2s','BUY','2026-05-08','EUR',60000,100000000,'brkb','test','portfolio','2026-05-08',4,4)`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b2c','BUY','2026-05-08','EUR',60000,0,'brkb','valores','account','2026-05-08',5,5)`).run();
    db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b2s','test','b2c','valores','buysell')`).run();
    db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate) VALUES ('b2s','FOREX',60000,'EUR',51000,'USD','1.1765')`).run();

    // SELL1 2026-05-15: 1 share @ USD 530 gross, EUR-side 530/0.880 ≈ 602.27 EUR.
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('s1s','SELL','2026-05-15','EUR',60227,100000000,'brkb','test','portfolio','2026-05-15',6,6)`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('s1c','SELL','2026-05-15','EUR',60227,0,'brkb','valores','account','2026-05-15',7,7)`).run();
    db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('s1s','test','s1c','valores','buysell')`).run();
    db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate) VALUES ('s1s','FOREX',60227,'EUR',53000,'USD','1.1364')`).run();
  });

  it('costBase reflects ONLY surviving lots, not consumed cost', () => {
    // After SELL of 1 share (FIFO): BUY1 (USD 500) fully consumed, BUY2 (USD 510) survives.
    // Surviving lot cost in base: gross-USD × USD→EUR(buy-date) = 510 × 0.850 = 433.50 EUR.
    // OLD (broken) helper summed cash-side EUR amounts: 58140/100 + 60000/100 = 1181.40 EUR.
    const perRow = getSecurityPerformanceList(
      db,
      { start: '2025-12-31', end: '2026-05-17' },
      CostMethod.FIFO,
      true,
    ).find((r) => r.securityId === 'brkb');
    expect(perRow).toBeDefined();
    const cost = parseFloat(perRow!.costBase);
    expect(cost).toBeCloseTo(433.5, 0);
    // Old broken value would be ~1181, so anything < 600 proves the surviving-lot fix.
    expect(cost).toBeLessThan(600);
  });
});

describe('costBase via per-lot FIFO — same-ccy partial sell (no FX path)', () => {
  // Locks the same-ccy partial-sell fix (Option B in the refactor). Without
  // this, a future contributor could re-introduce a "sum every BUY cash-side
  // row" short-circuit for the secCcy === baseCcy path and reintroduce the
  // overstatement only on EUR-in-EUR portfolios — invisible to cross-ccy
  // fixtures but very visible to single-currency users.
  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);
    db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
    db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                VALUES ('eur-acct','Cash EUR','account','EUR',0,'2026-01-01',1,0)`).run();
    db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                VALUES ('port','Broker','portfolio',NULL,0,'eur-acct','2026-01-01',2,1)`).run();
    db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                VALUES ('eur-sec','Acme EUR','EUR',0,'2026-01-01')`).run();
    db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('eur-sec',12000000000,'2026-05-17')`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('dep','DEPOSIT','2025-12-30','EUR',500000,0,'eur-acct','account','2025-12-30',1,1)`).run();

    // BUY1 2026-05-01: 1 share @ 100 EUR (10000 hecto)
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b1s','BUY','2026-05-01','EUR',10000,100000000,'eur-sec','port','portfolio','2026-05-01',2,2)`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b1c','BUY','2026-05-01','EUR',10000,0,'eur-sec','eur-acct','account','2026-05-01',3,3)`).run();
    db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b1s','port','b1c','eur-acct','buysell')`).run();

    // BUY2 2026-05-08: 1 share @ 110 EUR (11000 hecto)
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b2s','BUY','2026-05-08','EUR',11000,100000000,'eur-sec','port','portfolio','2026-05-08',4,4)`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('b2c','BUY','2026-05-08','EUR',11000,0,'eur-sec','eur-acct','account','2026-05-08',5,5)`).run();
    db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b2s','port','b2c','eur-acct','buysell')`).run();

    // SELL1 2026-05-15: 1 share @ 115 EUR (consumes BUY1 via FIFO)
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('s1s','SELL','2026-05-15','EUR',11500,100000000,'eur-sec','port','portfolio','2026-05-15',6,6)`).run();
    db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                VALUES ('s1c','SELL','2026-05-15','EUR',11500,0,'eur-sec','eur-acct','account','2026-05-15',7,7)`).run();
    db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('s1s','port','s1c','eur-acct','buysell')`).run();
  });

  it('same-ccy: costBase = surviving lot only (110 EUR), not sum of both BUYs (210 EUR)', () => {
    // FIFO consumes BUY1 (100 EUR). BUY2 (110 EUR) survives. costBase = 110.
    // A regression that re-introduced the OLD "sum every BUY cash-side row"
    // short-circuit for same-ccy would return 100+110 = 210.
    const perRow = getSecurityPerformanceList(
      db,
      { start: '2025-12-31', end: '2026-05-17' },
      CostMethod.FIFO,
      true,
    ).find((r) => r.securityId === 'eur-sec');
    expect(perRow).toBeDefined();
    const cost = parseFloat(perRow!.costBase);
    expect(cost).toBeCloseTo(110, 1);
    expect(cost).toBeLessThan(200);
  });
});

// ─── Phase 3 Task 7 — SecurityPerfResponse decomposition + dual perf ────────

describe('SecurityPerfResponse decomposition + dual perf (Phase 3 Task 7)', () => {
  // Cross-ccy fixture: BRK-B (USD) in EUR base, 2 BUYs no SELL.
  // Same shape as the BRK-B fixture above but lifted to its own block so we
  // can pin the decomposition identity without coupling to the existing
  // rollup tests.
  describe('BRK-B (USD) in EUR base — unrealized decomposition', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('valores','Cash EUR','account','EUR',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('test','Broker','portfolio',NULL,0,'valores','2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                  VALUES ('brkb','BRK','USD',0,'2026-01-01')`).run();
      // BUY1 2026-05-01: USD 473.01, EUR-side 406.79 EUR (rate 0.860 ≈ 1/1.1628)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','EUR',40679,100000000,'brkb','test','portfolio','2026-05-01',1,1)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','EUR',40679,0,'brkb','valores','account','2026-05-01',2,2)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b1s','test','b1c','valores','buysell')`).run();
      db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
                  VALUES ('b1s','FOREX',40679,'EUR',47301,'USD','1.1628')`).run();

      // BUY2 2026-05-08: USD 475.94, EUR-side 404.55 EUR (rate 0.850)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b2s','BUY','2026-05-08','EUR',40455,100000000,'brkb','test','portfolio','2026-05-08',3,3)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b2c','BUY','2026-05-08','EUR',40455,0,'brkb','valores','account','2026-05-08',4,4)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b2s','test','b2c','valores','buysell')`).run();
      db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
                  VALUES ('b2s','FOREX',40455,'EUR',47594,'USD','1.1765')`).run();

      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('dep','DEPOSIT','2025-12-30','EUR',100000,0,'valores','account','2025-12-30',5,5)`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('brkb',48270000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                  ('2025-12-31','USD','EUR','0.85'),
                  ('2026-05-01','USD','EUR','0.860'),
                  ('2026-05-08','USD','EUR','0.850'),
                  ('2026-05-17','USD','EUR','0.860')`).run();
    });

    it('emits unrealizedCapitalBase + unrealizedFxBase summing to (mvBase − costBase)', () => {
      const perRow = getSecurityPerformanceList(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      ).find((r) => r.securityId === 'brkb');
      expect(perRow).toBeDefined();

      // Surviving lots' cost in base: 473.01×0.860 + 475.94×0.850 = 406.79 + 404.55 = 811.34
      // MVE in base: 2 × 482.70 × 0.860 = 830.244
      // Sum: 830.244 − 811.34 = 18.904 EUR
      const cap = parseFloat(perRow!.unrealizedCapitalBase);
      const fx = parseFloat(perRow!.unrealizedFxBase);
      const mvBase = parseFloat(perRow!.marketValueBase);
      const costBase = parseFloat(perRow!.costBase);

      // Identity: capital + forex = mvBase − costBase (tolerance: 1e-2 covers 8-dec store + 2-dec rounding)
      expect(cap + fx).toBeCloseTo(mvBase - costBase, 2);

      // Sanity: both components nonzero on this fixture (different lotRates AND price move).
      expect(cap).toBeGreaterThan(0); // both BUYs at lower price than current
      expect(fx).toBeGreaterThan(0);  // BUY2 lotRate 0.850 < current 0.860
    });

    it('emits realizedCapitalBase + realizedFxBase = 0 when no SELL', () => {
      const perRow = getSecurityPerformanceList(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      ).find((r) => r.securityId === 'brkb');
      expect(perRow).toBeDefined();
      expect(parseFloat(perRow!.realizedCapitalBase)).toBe(0);
      expect(parseFloat(perRow!.realizedFxBase)).toBe(0);
    });

    it('emits ttwrorBase differing from ttwror when secCcy ≠ baseCcy', () => {
      // USD-native return diverges from EUR-investor return because the USD/EUR
      // rate moved during the holding period (0.860 → 0.850 → 0.860). Even
      // though the rates start and end at 0.860, the day-by-day path differs
      // and TTWROR is path-dependent.
      const perRow = getSecurityPerformanceList(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      ).find((r) => r.securityId === 'brkb');
      expect(perRow).toBeDefined();
      // The base pass MUST produce a different number from the native pass.
      // Use string-inequality first (cheapest, exact); the magnitudes are
      // tiny but distinguishable at the 4-decimal level.
      expect(perRow!.ttwrorBase).not.toBe(perRow!.ttwror);
    });
  });

  // Same-ccy fixture: EUR security in EUR base. Decomposition fields stay '0';
  // dual-perf fields equal native pass.
  describe('EUR security in EUR base — short-circuit', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('eur-acct','Cash EUR','account','EUR',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('port','Broker','portfolio',NULL,0,'eur-acct','2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                  VALUES ('eur-sec','Acme EUR','EUR',0,'2026-01-01')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('eur-sec',12000000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('dep','DEPOSIT','2025-12-30','EUR',500000,0,'eur-acct','account','2025-12-30',1,1)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','EUR',10000,100000000,'eur-sec','port','portfolio','2026-05-01',2,2)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','EUR',10000,0,'eur-sec','eur-acct','account','2026-05-01',3,3)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b1s','port','b1c','eur-acct','buysell')`).run();
    });

    it('decomposition fields all "0"; dual-perf equals native', () => {
      const perRow = getSecurityPerformanceList(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      ).find((r) => r.securityId === 'eur-sec');
      expect(perRow).toBeDefined();
      expect(perRow!.realizedCapitalBase).toBe('0');
      expect(perRow!.realizedFxBase).toBe('0');
      expect(perRow!.unrealizedCapitalBase).toBe('0');
      expect(perRow!.unrealizedFxBase).toBe('0');
      expect(perRow!.dividendFxBase).toBe('0');
      // Dual-perf passes through verbatim (same string serialization).
      expect(perRow!.ttwrorBase).toBe(perRow!.ttwror);
      expect(perRow!.ttwrorPaBase).toBe(perRow!.ttwrorPa);
      expect(perRow!.irrBase).toBe(perRow!.irr);
      expect(perRow!.irrBaseConverged).toBe(perRow!.irrConverged);
    });
  });

  // Realized decomposition fixture: USD security with 1 BUY + 1 SELL across
  // two FX eras. Sum identity: capital + fx = sellValueInBase − costInBase.
  describe('USD security in EUR base — realized decomposition with SELL', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('valores','Cash EUR','account','EUR',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('test','Broker','portfolio',NULL,0,'valores','2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                  VALUES ('usd-sec','USD Co','USD',0,'2026-01-01')`).run();
      db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                  ('2025-12-31','USD','EUR','0.850'),
                  ('2026-05-01','USD','EUR','0.860'),
                  ('2026-05-15','USD','EUR','0.900'),
                  ('2026-05-17','USD','EUR','0.870')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('usd-sec',55000000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('dep','DEPOSIT','2025-12-30','EUR',500000,0,'valores','account','2025-12-30',1,1)`).run();
      // BUY: 1 share, USD 500 gross, EUR-side 500×0.860 = 430 EUR (43000 hecto)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','EUR',43000,100000000,'usd-sec','test','portfolio','2026-05-01',2,2)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','EUR',43000,0,'usd-sec','valores','account','2026-05-01',3,3)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b1s','test','b1c','valores','buysell')`).run();
      db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
                  VALUES ('b1s','FOREX',43000,'EUR',50000,'USD','1.1628')`).run();

      // SELL: 1 share, USD 530 gross, EUR-side 530×0.900 = 477 EUR (47700 hecto)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('s1s','SELL','2026-05-15','EUR',47700,100000000,'usd-sec','test','portfolio','2026-05-15',4,4)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('s1c','SELL','2026-05-15','EUR',47700,0,'usd-sec','valores','account','2026-05-15',5,5)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('s1s','test','s1c','valores','buysell')`).run();
      db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
                  VALUES ('s1s','FOREX',47700,'EUR',53000,'USD','1.1111')`).run();
    });

    it('emits realizedCapitalBase + realizedFxBase summing to (sellValueInBase − costInBase)', () => {
      const perRow = getSecurityPerformanceList(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      ).find((r) => r.securityId === 'usd-sec');
      expect(perRow).toBeDefined();

      // sellSlices: [{shares=1, lotPrice=500 USD, lotRate=0.860}]
      // sellPrice = 530 USD, sellRate = 0.900
      // capital = 1 × (530 − 500) × 0.900 = 30 × 0.900 = 27.00
      // forex   = 1 × 500 × (0.900 − 0.860) = 500 × 0.040 = 20.00
      // sum = 47 EUR; sellValueInBase − costInBase = 530×0.900 − 500×0.860 = 477 − 430 = 47.
      const cap = parseFloat(perRow!.realizedCapitalBase);
      const fx = parseFloat(perRow!.realizedFxBase);
      expect(cap).toBeCloseTo(27, 1);
      expect(fx).toBeCloseTo(20, 1);
      expect(cap + fx).toBeCloseTo(47, 1);
    });
  });

  // Dividend FX gain fixture: USD security pays USD dividend to USD deposit
  // account in a EUR base portfolio. Receipt-date and end-date rates differ →
  // dividendFxBase nonzero.
  describe('USD dividend in EUR base — dividendFxBase nonzero on rate move', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      // USD deposit account (so DIVIDEND tx has currencyCode='USD')
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('usd-acct','Cash USD','account','USD',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('test','Broker','portfolio',NULL,0,'usd-acct','2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                  VALUES ('usd-sec','USD Co','USD',0,'2026-01-01')`).run();
      db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                  ('2025-12-31','USD','EUR','0.85'),
                  ('2026-05-01','USD','EUR','0.860'),
                  ('2026-05-10','USD','EUR','0.870'),
                  ('2026-05-17','USD','EUR','0.900')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('usd-sec',50000000000,'2026-05-17')`).run();
      // BUY 1 share USD 500 on 2026-05-01
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','USD',50000,100000000,'usd-sec','test','portfolio','2026-05-01',1,1)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','USD',50000,0,'usd-sec','usd-acct','account','2026-05-01',2,2)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b1s','test','b1c','usd-acct','buysell')`).run();
      // DIVIDEND USD 10 received on 2026-05-10 (currencyCode='USD' — matches USD deposit)
      // amount = 10 USD × 100 hecto/USD = 1000
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('div','DIVIDENDS','2026-05-10','USD',1000,0,'usd-sec','usd-acct','account','2026-05-10',3,3)`).run();
    });

    it('dividendFxBase ≈ divAmount × (endRate − receiptRate) when deposit ccy ≠ base', () => {
      const perRow = getSecurityPerformanceList(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      ).find((r) => r.securityId === 'usd-sec');
      expect(perRow).toBeDefined();
      // 10 USD × (0.900 − 0.870) = 10 × 0.030 = 0.300 EUR
      const fxGain = parseFloat(perRow!.dividendFxBase);
      expect(fxGain).toBeCloseTo(0.30, 2);
    });
  });

  // Companion: same dividend amount but received in EUR (deposit-ccy === base)
  // → dividendFxBase MUST be 0 even though the security is USD-native.
  describe('USD security with EUR-deposit dividend — dividendFxBase = 0', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('eur-acct','Cash EUR','account','EUR',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('test','Broker','portfolio',NULL,0,'eur-acct','2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                  VALUES ('usd-sec','USD Co','USD',0,'2026-01-01')`).run();
      db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                  ('2025-12-31','USD','EUR','0.85'),
                  ('2026-05-01','USD','EUR','0.860'),
                  ('2026-05-10','USD','EUR','0.870'),
                  ('2026-05-17','USD','EUR','0.900')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('usd-sec',50000000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','EUR',43000,100000000,'usd-sec','test','portfolio','2026-05-01',1,1)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','EUR',43000,0,'usd-sec','eur-acct','account','2026-05-01',2,2)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES ('b1s','test','b1c','eur-acct','buysell')`).run();
      db.prepare(`INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
                  VALUES ('b1s','FOREX',43000,'EUR',50000,'USD','1.1628')`).run();
      // EUR-denominated dividend (e.g. broker auto-converted at receipt time)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('div','DIVIDENDS','2026-05-10','EUR',870,0,'usd-sec','eur-acct','account','2026-05-10',3,3)`).run();
    });

    it('dividendFxBase = 0 when DIVIDEND currencyCode === baseCurrency', () => {
      const perRow = getSecurityPerformanceList(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      ).find((r) => r.securityId === 'usd-sec');
      expect(perRow).toBeDefined();
      expect(perRow!.dividendFxBase).toBe('0');
    });
  });
});

// ─── Phase 3 Task 8 — Portfolio rollup decomposition accumulators ───────────

describe('Portfolio rollup decomposition accumulators (Phase 3 Task 8)', () => {
  // Reuse the USD-security-with-SELL fixture shape (one BUY across FX era,
  // one SELL across a later FX era; latest_price at period end) so the
  // per-security realizedCapitalBase + realizedFxBase + unrealizedCapitalBase
  // + unrealizedFxBase + dividendFxBase fields are all exercised at the
  // portfolio totals layer.
  describe('USD security in EUR base — totals expose all 5 fields', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('usd-acct','Cash USD','account','USD',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('test','Broker','portfolio',NULL,0,'usd-acct','2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                  VALUES ('usd-sec','USD Co','USD',0,'2026-01-01')`).run();
      db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                  ('2025-12-31','USD','EUR','0.850'),
                  ('2026-05-01','USD','EUR','0.860'),
                  ('2026-05-10','USD','EUR','0.870'),
                  ('2026-05-15','USD','EUR','0.900'),
                  ('2026-05-17','USD','EUR','0.900')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('usd-sec',55000000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('dep','DEPOSIT','2025-12-30','USD',500000,0,'usd-acct','account','2025-12-30',1,1)`).run();
      // BUY 2 shares @ USD 500/share = USD 1000 on 2026-05-01, rate 0.860 → 860 EUR
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','USD',100000,200000000,'usd-sec','test','portfolio','2026-05-01',2,2)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','USD',100000,0,'usd-sec','usd-acct','account','2026-05-01',3,3)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
                  VALUES ('b1s','test','b1c','usd-acct','buysell')`).run();
      // SELL 1 share @ USD 530 on 2026-05-15, rate 0.900 → 477 EUR
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('s1s','SELL','2026-05-15','USD',53000,100000000,'usd-sec','test','portfolio','2026-05-15',4,4)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('s1c','SELL','2026-05-15','USD',53000,0,'usd-sec','usd-acct','account','2026-05-15',5,5)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
                  VALUES ('s1s','test','s1c','usd-acct','buysell')`).run();
      // DIVIDEND USD 10 on 2026-05-10 (deposit-ccy USD ≠ base EUR; rate moved 0.870 → 0.900)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('div','DIVIDENDS','2026-05-10','USD',1000,0,'usd-sec','usd-acct','account','2026-05-10',6,6)`).run();
    });

    it('totals expose realizedCapitalBase + realizedFxBase + unrealizedCapitalBase + unrealizedFxBase + dividendFxBase', () => {
      const result = getPortfolioCalc(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      );
      expect(result.realizedCapitalBase).toBeDefined();
      expect(result.realizedFxBase).toBeDefined();
      expect(result.unrealizedCapitalBase).toBeDefined();
      expect(result.unrealizedFxBase).toBeDefined();
      expect(result.dividendFxBase).toBeDefined();
      // All five are signed; the SELL is profitable on capital AND FX, the
      // unrealized lot is profitable on capital (lotPrice 500 → mid 550) and
      // FX (lotRate 0.860 → endRate 0.900), and the dividend FX is nonzero
      // (10 USD × (0.900 − 0.870) = 0.30 EUR).
      expect(parseFloat(result.realizedCapitalBase)).toBeGreaterThan(0);
      expect(parseFloat(result.realizedFxBase)).toBeGreaterThan(0);
      expect(parseFloat(result.unrealizedCapitalBase)).toBeGreaterThan(0);
      expect(parseFloat(result.unrealizedFxBase)).toBeGreaterThan(0);
      expect(parseFloat(result.dividendFxBase)).toBeCloseTo(0.30, 2);
    });

    it('decomposition totals match per-security sum exactly', () => {
      const period = { start: '2025-12-31', end: '2026-05-17' };
      const totals = getPortfolioCalc(db, period, CostMethod.FIFO, true);
      const perSec = getSecurityPerformanceList(db, period, CostMethod.FIFO, true);
      const sumRealizedCap = perSec.reduce(
        (s, r) => s.plus(r.realizedCapitalBase),
        new Decimal(0),
      );
      const sumRealizedFx = perSec.reduce(
        (s, r) => s.plus(r.realizedFxBase),
        new Decimal(0),
      );
      const sumUnrealizedCap = perSec.reduce(
        (s, r) => s.plus(r.unrealizedCapitalBase),
        new Decimal(0),
      );
      const sumUnrealizedFx = perSec.reduce(
        (s, r) => s.plus(r.unrealizedFxBase),
        new Decimal(0),
      );
      const sumDividendFx = perSec.reduce(
        (s, r) => s.plus(r.dividendFxBase),
        new Decimal(0),
      );
      // Single security, fully resolved → totals === per-sec sum exactly
      // (string→Decimal→string roundtrip only).
      expect(new Decimal(totals.realizedCapitalBase).eq(sumRealizedCap)).toBe(true);
      expect(new Decimal(totals.realizedFxBase).eq(sumRealizedFx)).toBe(true);
      expect(new Decimal(totals.unrealizedCapitalBase).eq(sumUnrealizedCap)).toBe(true);
      expect(new Decimal(totals.unrealizedFxBase).eq(sumUnrealizedFx)).toBe(true);
      expect(new Decimal(totals.dividendFxBase).eq(sumDividendFx)).toBe(true);
    });
  });

  // Coverage-gap fixture: one USD security with rates, one GBP security with
  // NO rates anywhere in vf_exchange_rate. The forward-fill rate map covers
  // any DATE so single-currency gaps require an entirely-missing CURRENCY.
  // The unresolved security MUST be excluded from the decomposition totals,
  // mirroring the existing totalMVB/totalMVE exclusion.
  describe('rollup excludes unresolved-FX securities from decomposition totals', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('usd-acct','Cash USD','account','USD',0,'2026-01-01',1,0),
                         ('gbp-acct','Cash GBP','account','GBP',0,'2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('test','Broker','portfolio',NULL,0,'usd-acct','2026-01-01',3,2)`).run();
      // 'resolved' is USD (has rate coverage); 'unresolved' is GBP (no GBP
      // rates anywhere → buildRateMap returns an empty map → FIFO coverage
      // check fails → decomposition helper returns null).
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt) VALUES
                  ('resolved','Resolved USD Co','USD',0,'2026-01-01'),
                  ('unresolved','Unresolved GBP Co','GBP',0,'2026-01-01')`).run();
      // ONLY USD rates exist. GBP is deliberately absent.
      db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                  ('2025-12-31','USD','EUR','0.850'),
                  ('2026-05-01','USD','EUR','0.860'),
                  ('2026-05-17','USD','EUR','0.900')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES
                  ('resolved',55000000000,'2026-05-17'),
                  ('unresolved',55000000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order) VALUES
                  ('dep1','DEPOSIT','2025-12-30','USD',500000,0,'usd-acct','account','2025-12-30',1,1),
                  ('dep2','DEPOSIT','2025-12-30','GBP',500000,0,'gbp-acct','account','2025-12-30',2,2)`).run();
      // BUY of 'resolved' (USD): rate available, decomposition succeeds.
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','USD',50000,100000000,'resolved','test','portfolio','2026-05-01',3,3)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','USD',50000,0,'resolved','usd-acct','account','2026-05-01',4,4)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
                  VALUES ('b1s','test','b1c','usd-acct','buysell')`).run();
      // BUY of 'unresolved' (GBP): no rateMap for GBP → unresolved.
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b2s','BUY','2026-05-01','GBP',50000,100000000,'unresolved','test','portfolio','2026-05-01',5,5)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b2c','BUY','2026-05-01','GBP',50000,0,'unresolved','gbp-acct','account','2026-05-01',6,6)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
                  VALUES ('b2s','test','b2c','gbp-acct','buysell')`).run();
    });

    it('totals reflect only the resolved security; unresolved one excluded', () => {
      const period = { start: '2025-12-31', end: '2026-05-17' };
      const totals = getPortfolioCalc(db, period, CostMethod.FIFO, true);
      const perSec = getSecurityPerformanceList(db, period, CostMethod.FIFO, true);
      const resolvedRow = perSec.find((r) => r.securityId === 'resolved');
      const unresolvedRow = perSec.find((r) => r.securityId === 'unresolved');
      expect(resolvedRow).toBeDefined();
      expect(unresolvedRow).toBeDefined();

      // The unresolved security MUST report zeroes (decomposition helper
      // returned null → defaults to '0' at the wire layer).
      expect(unresolvedRow!.unrealizedCapitalBase).toBe('0');
      expect(unresolvedRow!.unrealizedFxBase).toBe('0');

      // The unresolved security must ALSO be excluded from the rollup
      // (continue at the unresolvedSecurityIds.add). Because the unresolved
      // row reports '0' for these fields anyway, the rollup totals trivially
      // equal the resolved row's values — but the key invariant the test
      // pins is that totals MUST NOT pick up any spurious decomposition for
      // the unresolved security.
      expect(new Decimal(totals.unrealizedCapitalBase).eq(resolvedRow!.unrealizedCapitalBase)).toBe(true);
      expect(new Decimal(totals.unrealizedFxBase).eq(resolvedRow!.unrealizedFxBase)).toBe(true);
      expect(new Decimal(totals.realizedCapitalBase).eq(resolvedRow!.realizedCapitalBase)).toBe(true);
      expect(new Decimal(totals.realizedFxBase).eq(resolvedRow!.realizedFxBase)).toBe(true);

      // And confirm the unresolved security is flagged in the wire result.
      expect(totals.unresolvedSecurityIds).toContain('unresolved');
    });
  });

  // Multi-security identity: two RESOLVED USD securities → totals = sum exactly.
  // The single-security identity test above covers the loop's per-row math
  // for a single iteration; this test covers the cross-row summation
  // (catches off-by-one in the accumulator wiring, e.g. `=` vs `+=`).
  describe('multi-security: rollup totals = sum of per-security exactly', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('usd-acct','Cash USD','account','USD',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('test','Broker','portfolio',NULL,0,'usd-acct','2026-01-01',2,1)`).run();
      // Two distinct USD securities, both fully resolved.
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt) VALUES
                  ('usd-a','USD Co A','USD',0,'2026-01-01'),
                  ('usd-b','USD Co B','USD',0,'2026-01-01')`).run();
      db.prepare(`INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
                  ('2025-12-31','USD','EUR','0.850'),
                  ('2026-05-01','USD','EUR','0.860'),
                  ('2026-05-15','USD','EUR','0.880'),
                  ('2026-05-17','USD','EUR','0.900')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES
                  ('usd-a',55000000000,'2026-05-17'),
                  ('usd-b',45000000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('dep','DEPOSIT','2025-12-30','USD',500000,0,'usd-acct','account','2025-12-30',1,1)`).run();
      // BUY usd-a + SELL half on different date (realized decomposition lives)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order) VALUES
                  ('aBs','BUY','2026-05-01','USD',100000,200000000,'usd-a','test','portfolio','2026-05-01',2,2),
                  ('aBc','BUY','2026-05-01','USD',100000,0,'usd-a','usd-acct','account','2026-05-01',3,3),
                  ('aSs','SELL','2026-05-15','USD',53000,100000000,'usd-a','test','portfolio','2026-05-15',4,4),
                  ('aSc','SELL','2026-05-15','USD',53000,0,'usd-a','usd-acct','account','2026-05-15',5,5)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES
                  ('aBs','test','aBc','usd-acct','buysell'),
                  ('aSs','test','aSc','usd-acct','buysell')`).run();
      // BUY usd-b only (unrealized decomposition lives)
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order) VALUES
                  ('bBs','BUY','2026-05-01','USD',40000,100000000,'usd-b','test','portfolio','2026-05-01',6,6),
                  ('bBc','BUY','2026-05-01','USD',40000,0,'usd-b','usd-acct','account','2026-05-01',7,7)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES
                  ('bBs','test','bBc','usd-acct','buysell')`).run();
    });

    it('all 5 decomposition totals equal sum of per-security values (multi-row)', () => {
      const period = { start: '2025-12-31', end: '2026-05-17' };
      const totals = getPortfolioCalc(db, period, CostMethod.FIFO, true);
      const perSec = getSecurityPerformanceList(db, period, CostMethod.FIFO, true);
      // Both rows should be resolved (no unresolved-FX).
      expect(totals.unresolvedSecurityIds).toHaveLength(0);
      expect(perSec).toHaveLength(2);

      for (const field of [
        'realizedCapitalBase',
        'realizedFxBase',
        'unrealizedCapitalBase',
        'unrealizedFxBase',
        'dividendFxBase',
      ] as const) {
        const sum = perSec.reduce((s, r) => s.plus(r[field]), new Decimal(0));
        expect(new Decimal(totals[field]).eq(sum)).toBe(true);
      }
      // Sanity: at least one of the realized/unrealized fields nonzero
      // (otherwise the identity could be vacuously true).
      expect(parseFloat(totals.realizedCapitalBase) !== 0
          || parseFloat(totals.unrealizedCapitalBase) !== 0).toBe(true);
    });
  });

  // Same-ccy short-circuit at the rollup: every security same-ccy as base →
  // all 5 decomposition totals are '0' (no FX component anywhere).
  describe('all securities same-ccy as base → decomposition totals all "0"', () => {
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      db.prepare(`INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, updatedAt, _xmlid, _order)
                  VALUES ('eur-acct','Cash EUR','account','EUR',0,'2026-01-01',1,0)`).run();
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
                  VALUES ('port','Broker','portfolio',NULL,0,'eur-acct','2026-01-01',2,1)`).run();
      db.prepare(`INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
                  VALUES ('eur-sec','Acme EUR','EUR',0,'2026-01-01')`).run();
      db.prepare(`INSERT INTO latest_price (security, value, tstamp) VALUES ('eur-sec',12000000000,'2026-05-17')`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('dep','DEPOSIT','2025-12-30','EUR',500000,0,'eur-acct','account','2025-12-30',1,1)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1s','BUY','2026-05-01','EUR',10000,100000000,'eur-sec','port','portfolio','2026-05-01',2,2)`).run();
      db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
                  VALUES ('b1c','BUY','2026-05-01','EUR',10000,0,'eur-sec','eur-acct','account','2026-05-01',3,3)`).run();
      db.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
                  VALUES ('b1s','port','b1c','eur-acct','buysell')`).run();
    });

    it('all decomposition totals are "0" when no cross-currency exposure exists', () => {
      const result = getPortfolioCalc(
        db, { start: '2025-12-31', end: '2026-05-17' }, CostMethod.FIFO, true,
      );
      expect(result.realizedCapitalBase).toBe('0');
      expect(result.realizedFxBase).toBe('0');
      expect(result.unrealizedCapitalBase).toBe('0');
      expect(result.unrealizedFxBase).toBe('0');
      expect(result.dividendFxBase).toBe('0');
    });
  });
});
