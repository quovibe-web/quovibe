// Calculation-panel per-security items must be emitted in BASE currency.
//
// The panel renders every expandable row's items with the portfolio's base
// currency label, and each row's items are the decomposition of that row's
// total. So an item emitted in the security's native currency is both a
// mislabeled number and a broken sum: for a USD security in a EUR portfolio
// the item read ~16 % high (the raw USD figure) while the row total above it
// was the EUR conversion.
//
// The invariant pinned here is not a magic number — it is
//   Σ items == row total
// on a cross-currency fixture, for both capital-gain rows.

import { describe, it, expect, beforeEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { getPortfolioCalc } from '../performance.service';
import { createTestDb, shares, euros, price, hasSqliteBindings } from './test-fixtures';

const PERIOD = { start: '2025-01-01', end: '2026-12-31' };
const DEPOSIT = 'acc-cash-eur';
const SECACC = 'acc-sec';

let db: BetterSqlite3.Database;

function insertLeg(opts: {
  uuid: string;
  type: 'BUY' | 'SELL';
  date: string;
  securityId: string;
  shareCount: number;
  amountDepositCcy: number;
  forexAmountSecurityCcy: number;
  securityCurrency: string;
  order: number;
}): void {
  const insert = db.prepare(
    `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, _order)
     VALUES (?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    `${opts.uuid}-sec`, opts.type, opts.date, euros(opts.amountDepositCcy),
    shares(opts.shareCount), opts.securityId, SECACC, 'portfolio', opts.order,
  );
  insert.run(
    `${opts.uuid}-cash`, opts.type, opts.date, euros(opts.amountDepositCcy),
    0, opts.securityId, DEPOSIT, 'account', opts.order + 1,
  );
  db.prepare(
    `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
     VALUES (?, ?, ?, ?, 'buysell')`,
  ).run(`${opts.uuid}-sec`, SECACC, `${opts.uuid}-cash`, DEPOSIT);

  // GROSS_VALUE FOREX unit — the shape a cross-currency PP-XML import produces.
  db.prepare(
    `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
     VALUES (?, 'GROSS_VALUE', ?, 'EUR', ?, ?, ?)`,
  ).run(
    `${opts.uuid}-sec`,
    euros(opts.amountDepositCcy),
    euros(opts.forexAmountSecurityCcy),
    opts.securityCurrency,
    new Decimal(opts.forexAmountSecurityCcy).div(opts.amountDepositCcy).toFixed(6),
  );
}

beforeEach(() => {
  db = createTestDb();
  db.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(DEPOSIT, 'Cash EUR', 'account', 'EUR');
  db.prepare(
    `INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`,
  ).run(SECACC, 'Broker', 'portfolio', 'EUR', DEPOSIT);

  db.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, 'USD', 0)`)
    .run('s-sold', 'SOLD USD SECURITY');
  db.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, 'USD', 0)`)
    .run('s-held', 'HELD USD SECURITY');

  // USD → EUR rates (quovibe convention: security-per-... multiply native→base)
  const fx = db.prepare(
    `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES (?, 'USD', 'EUR', ?)`,
  );
  fx.run('2025-01-01', '0.9400');
  fx.run('2025-04-23', '0.8803');
  fx.run('2025-06-02', '0.8889');
  fx.run('2026-08-05', '0.8634');
  fx.run('2026-12-31', '0.8600');

  // Fully-sold position: BUY 14 @ 1069.00 USD (940.99 EUR), SELL 14 @ 1217.92 USD (1051.50 EUR)
  insertLeg({
    uuid: 'buy-sold', type: 'BUY', date: '2025-04-23', securityId: 's-sold',
    shareCount: 14, amountDepositCcy: 940.99, forexAmountSecurityCcy: 1069.00,
    securityCurrency: 'USD', order: 0,
  });
  insertLeg({
    uuid: 'sell-sold', type: 'SELL', date: '2026-08-05', securityId: 's-sold',
    shareCount: 14, amountDepositCcy: 1051.50, forexAmountSecurityCcy: 1217.92,
    securityCurrency: 'USD', order: 10,
  });

  // Still-held position: BUY 10 @ 900.00 USD (800.00 EUR), marked at 100 USD/share
  insertLeg({
    uuid: 'buy-held', type: 'BUY', date: '2025-06-02', securityId: 's-held',
    shareCount: 10, amountDepositCcy: 800.00, forexAmountSecurityCcy: 900.00,
    securityCurrency: 'USD', order: 20,
  });
  db.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run('s-held', '2026-12-31', price(100));
  db.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run('s-held', '2026-12-31', price(100));
  db.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run('s-sold', '2026-08-05', price(87));
});

function sum(values: string[]): Decimal {
  return values.reduce((acc, v) => acc.plus(new Decimal(v)), new Decimal(0));
}

describe.skipIf(!hasSqliteBindings)('getPortfolioCalc — per-security items in base currency', () => {
  it('realized-gain items sum to the realized-gain total', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.FIFO, true, true);

    expect(calc.realizedGains.items.length).toBeGreaterThan(0);
    const itemSum = sum(calc.realizedGains.items.map((i) => i.realizedGain));
    expect(itemSum.minus(new Decimal(calc.realizedGains.total)).abs().toNumber())
      .toBeLessThan(0.01);
  });

  it('capital-gain items sum to the unrealized total', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.FIFO, true, true);

    expect(calc.capitalGains.items.length).toBeGreaterThan(0);
    const itemSum = sum(calc.capitalGains.items.map((i) => i.unrealizedGain));
    expect(itemSum.minus(new Decimal(calc.capitalGains.unrealized)).abs().toNumber())
      .toBeLessThan(0.01);
  });

  it('capital-gain item initial/final values are base currency (MVB/MVE at the boundary rate)', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.FIFO, true, true);
    const held = calc.capitalGains.items.find((i) => i.securityId === 's-held');
    expect(held).toBeDefined();

    // 10 shares × 100 USD × 0.86 (period-end USD→EUR) = 860 EUR — NOT the raw 1000 USD.
    expect(new Decimal(held!.finalValue).toNumber()).toBeCloseTo(860, 2);
    // Position opened inside the period → nothing held at period start.
    expect(new Decimal(held!.initialValue).toNumber()).toBeCloseTo(0, 2);
  });

  it('realized-gain item proceeds and cost stay in the same unit as the gain', () => {
    const calc = getPortfolioCalc(db, PERIOD, CostMethod.FIFO, true, true);
    const item = calc.realizedGains.items.find((i) => i.securityId === 's-sold');
    expect(item).toBeDefined();

    // proceeds − cost === realizedGain must hold within the emitted unit.
    const identity = new Decimal(item!.proceeds)
      .minus(new Decimal(item!.costAtPeriodStart))
      .minus(new Decimal(item!.realizedGain));
    expect(identity.abs().toNumber()).toBeLessThan(0.01);

    // Proceeds are the EUR cash the deposit account actually received.
    expect(new Decimal(item!.proceeds).toNumber()).toBeCloseTo(1051.50, 2);
  });
});
