// packages/api/src/__tests__/securities-perf-base-ccy.test.ts
//
// Integration test: getSecurityPerformanceList emits real *Base values for cross-currency
// securities instead of placeholder '0'.
//
// Fixture: BRK-B style (USD security, EUR portfolio base)
//   - 2 BUY transactions, both with cash paid in EUR (deposit account)
//   - costBase = sum of EUR cash paid (direct, since deposit ccy = base ccy)
//   - marketValueBase = latest_price_USD × 2 shares × period-end USD→EUR rate
//
// Pattern: direct service call on a fresh :memory: DB (avoids supertest/createApp overhead;
// the route is a thin pass-through to getSecurityPerformanceList).

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CostMethod } from '@quovibe/shared';

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let getSecurityPerformanceList: typeof import('../services/performance.service').getSecurityPerformanceList;

beforeEach(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));
  ({ getSecurityPerformanceList } = await import('../services/performance.service'));
});

function seedBrkFixture(db: Database.Database): void {
  applyBootstrap(db);

  // Set portfolio base currency to EUR
  db.prepare(
    `INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`,
  ).run();

  // Accounts: EUR deposit + EUR securities account
  db.prepare(
    `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (1, 'acc-dep', 'Cash EUR', 'EUR', 'account', NULL, '2025-01-01T00:00:00Z', 1, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (2, 'acc-sec', 'Broker', 'EUR', 'portfolio', 'acc-dep', '2025-01-01T00:00:00Z', 2, 1)`,
  ).run();

  // USD security (BRK-B style)
  db.prepare(
    `INSERT INTO security (_id, uuid, name, currency, isin, isRetired, updatedAt)
     VALUES (1, 's-brk', 'Berkshire Hathaway B', 'USD', 'US0846707026', 0, '2025-01-01T00:00:00Z')`,
  ).run();

  // Latest price: 500 USD per share (stored as integer × 1e8 per ppxml2db convention)
  // date within period [2025-12-31, 2026-05-17]
  db.prepare(
    `INSERT INTO latest_price (security, tstamp, value)
     VALUES ('s-brk', '2026-05-10', ?)`,
  ).run(Math.round(500 * 1e8));

  // Historical price at period start (needed so MVB is non-null)
  db.prepare(
    `INSERT INTO price (security, tstamp, value)
     VALUES ('s-brk', '2025-12-31', ?)`,
  ).run(Math.round(480 * 1e8));

  // FX rates: USD → EUR
  // Trade dates: 2025-01-15 and 2025-03-15
  // Period end: 2026-05-17 → rate 0.8302
  const fxStmt = db.prepare(
    `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
     VALUES (?, 'USD', 'EUR', ?)`,
  );
  fxStmt.run('2025-01-15', '0.8302');
  fxStmt.run('2025-03-15', '0.8302');
  fxStmt.run('2026-05-17', '0.8302');

  // BUY #1 — 2025-01-15 — 1 share BRK-B
  // Portfolio-side (securities account, shares = 1, currency = USD)
  db.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('t1-sec', 'acc-sec', 'BUY', '2025-01-15', ?, 100000000, 's-brk', 'USD',
             'portfolio', '2025-01-15T00:00:00Z', 1, 0, 0, 0)`,
  ).run(Math.round(406.79 * 100)); // amount_hecto (EUR)

  // Cash-side BUY #1 (deposit account, shares = 0, currency = EUR)
  db.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('t1-cas', 'acc-dep', 'BUY', '2025-01-15', ?, 0, 's-brk', 'EUR',
             'account', '2025-01-15T00:00:00Z', 2, 1, 0, 0)`,
  ).run(Math.round(406.79 * 100));

  // Cross-entry linking t1 (type='buysell' per ppxml2db convention for BUY/SELL)
  db.prepare(
    `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
     VALUES ('t1-sec', 'acc-sec', 't1-cas', 'acc-dep', 'buysell')`,
  ).run();

  // BUY #2 — 2025-03-15 — 1 share BRK-B
  db.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('t2-sec', 'acc-sec', 'BUY', '2025-03-15', ?, 100000000, 's-brk', 'USD',
             'portfolio', '2025-03-15T00:00:00Z', 3, 2, 0, 0)`,
  ).run(Math.round(404.68 * 100));

  db.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('t2-cas', 'acc-dep', 'BUY', '2025-03-15', ?, 0, 's-brk', 'EUR',
             'account', '2025-03-15T00:00:00Z', 4, 3, 0, 0)`,
  ).run(Math.round(404.68 * 100));

  db.prepare(
    `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
     VALUES ('t2-sec', 'acc-sec', 't2-cas', 'acc-dep', 'buysell')`,
  ).run();
}

describe('getSecurityPerformanceList — base currency fields', () => {
  it('cross-currency security emits real *Base values (not placeholder 0)', () => {
    const db = new Database(':memory:');
    try {
      seedBrkFixture(db);

      const period = { start: '2025-12-31', end: '2026-05-17' };
      const results = getSecurityPerformanceList(db, period, CostMethod.MOVING_AVERAGE, true);

      const brk = results.find((r) => r.securityId === 's-brk');
      expect(brk).toBeDefined();
      expect(brk!.currency).toBe('USD');
      expect(brk!.baseCurrency).toBe('EUR');

      // marketValueBase: 2 shares × 500 USD × 0.8302 EUR/USD = 830.20
      expect(parseFloat(brk!.marketValueBase)).toBeCloseTo(830.20, 0);

      // costBase: per-lot FIFO surviving cost in base. Both BUYs survive (no SELL),
      // so total = (406.79 USD × 0.8302) + (404.68 USD × 0.8302)
      //         = 337.72 + 335.96 = 673.68 EUR.
      // Note: securities-side xact.currency='USD' and there's no FOREX unit, so
      // the engine reads the USD-denominated gross directly and applies the
      // trade-date USD→EUR rate via the cost-rate map (widened to cover pre-period
      // BUY dates — see getSecurityPerformanceList).
      expect(parseFloat(brk!.costBase)).toBeCloseTo(673.68, 1);

      // Sanity: *Base values must be non-zero (regression against placeholder '0')
      expect(parseFloat(brk!.marketValueBase)).toBeGreaterThan(0);
      expect(parseFloat(brk!.costBase)).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('same-currency security emits native values on *Base fields (no regression)', () => {
    const db = new Database(':memory:');
    try {
      applyBootstrap(db);
      db.prepare(
        `INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`,
      ).run();
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (1, 'acc-dep2', 'Cash', 'EUR', 'account', NULL, '2026-01-01T00:00:00Z', 1, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (2, 'acc-sec2', 'Broker', 'EUR', 'portfolio', 'acc-dep2', '2026-01-01T00:00:00Z', 2, 1)`,
      ).run();
      db.prepare(
        `INSERT INTO security (_id, uuid, name, currency, isin, isRetired, updatedAt)
         VALUES (1, 's-eur', 'Acme EUR', 'EUR', 'IT0000000001', 0, '2026-01-01T00:00:00Z')`,
      ).run();
      db.prepare(
        `INSERT INTO latest_price (security, tstamp, value) VALUES ('s-eur', '2026-05-15', ?)`,
      ).run(Math.round(100 * 1e8));
      db.prepare(
        `INSERT INTO price (security, tstamp, value) VALUES ('s-eur', '2025-12-31', ?)`,
      ).run(Math.round(95 * 1e8));
      // BUY EUR security
      db.prepare(
        `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                           acctype, updatedAt, _xmlid, _order, fees, taxes)
         VALUES ('e1-sec', 'acc-sec2', 'BUY', '2026-01-10', ?, 100000000, 's-eur', 'EUR',
                 'portfolio', '2026-01-10T00:00:00Z', 1, 0, 0, 0)`,
      ).run(Math.round(95 * 100));
      db.prepare(
        `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                           acctype, updatedAt, _xmlid, _order, fees, taxes)
         VALUES ('e1-cas', 'acc-dep2', 'BUY', '2026-01-10', ?, 0, 's-eur', 'EUR',
                 'account', '2026-01-10T00:00:00Z', 2, 1, 0, 0)`,
      ).run(Math.round(95 * 100));
      db.prepare(
        `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
         VALUES ('e1-sec', 'acc-sec2', 'e1-cas', 'acc-dep2', 'buysell')`,
      ).run();

      const period = { start: '2025-12-31', end: '2026-05-17' };
      const results = getSecurityPerformanceList(db, period, CostMethod.MOVING_AVERAGE, true);
      const eur = results.find((r) => r.securityId === 's-eur');
      expect(eur).toBeDefined();
      expect(eur!.currency).toBe('EUR');
      expect(eur!.baseCurrency).toBe('EUR');

      // Same-currency: marketValueBase should equal native mve
      expect(eur!.marketValueBase).toBe(eur!.mve);
      expect(eur!.costBase).toBe(eur!.purchaseValue);
    } finally {
      db.close();
    }
  });

  it('cross-currency security with USD deposit exercises FX-projection path on costBase', () => {
    // USD deposit account in EUR portfolio: cash-side BUY rows carry currencyCode='USD',
    // so the FIFO cost helper (computeSecurityFifoInBase) must project them via FX rate → EUR.
    // BUY 1 share at 490 USD (cash paid = 490 USD → 490 × 0.85 = 416.50 EUR)
    const db = new Database(':memory:');
    try {
      applyBootstrap(db);
      db.prepare(
        `INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`,
      ).run();
      // USD deposit account + securities account
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (1, 'acc-usd-dep', 'Cash USD', 'USD', 'account', NULL, '2025-06-01T00:00:00Z', 1, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (2, 'acc-usd-sec', 'Broker USD', 'EUR', 'portfolio', 'acc-usd-dep', '2025-06-01T00:00:00Z', 2, 1)`,
      ).run();
      // USD security
      db.prepare(
        `INSERT INTO security (_id, uuid, name, currency, isin, isRetired, updatedAt)
         VALUES (1, 's-usd2', 'Tech USD Inc', 'USD', 'US9999999999', 0, '2025-06-01T00:00:00Z')`,
      ).run();
      // Latest price: 600 USD per share
      db.prepare(
        `INSERT INTO latest_price (security, tstamp, value) VALUES ('s-usd2', '2026-05-10', ?)`,
      ).run(Math.round(600 * 1e8));
      // Historical price at period start
      db.prepare(
        `INSERT INTO price (security, tstamp, value) VALUES ('s-usd2', '2025-12-31', ?)`,
      ).run(Math.round(480 * 1e8));
      // FX rates USD → EUR: trade date + period end
      const fx = db.prepare(
        `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
         VALUES (?, 'USD', 'EUR', ?)`,
      );
      fx.run('2026-01-20', '0.85');   // trade date rate
      fx.run('2026-05-17', '0.85');   // period end rate
      // BUY 1 share at 490 USD cash (USD deposit pays USD)
      db.prepare(
        `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                           acctype, updatedAt, _xmlid, _order, fees, taxes)
         VALUES ('u1-sec', 'acc-usd-sec', 'BUY', '2026-01-20', ?, 100000000, 's-usd2', 'USD',
                 'portfolio', '2026-01-20T00:00:00Z', 1, 0, 0, 0)`,
      ).run(Math.round(490 * 100));
      // Cash-side: USD deposit, shares=0, currency=USD
      db.prepare(
        `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                           acctype, updatedAt, _xmlid, _order, fees, taxes)
         VALUES ('u1-cas', 'acc-usd-dep', 'BUY', '2026-01-20', ?, 0, 's-usd2', 'USD',
                 'account', '2026-01-20T00:00:00Z', 2, 1, 0, 0)`,
      ).run(Math.round(490 * 100));
      db.prepare(
        `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
         VALUES ('u1-sec', 'acc-usd-sec', 'u1-cas', 'acc-usd-dep', 'buysell')`,
      ).run();

      const period = { start: '2025-12-31', end: '2026-05-17' };
      const results = getSecurityPerformanceList(db, period, CostMethod.MOVING_AVERAGE, true);
      const sec = results.find((r) => r.securityId === 's-usd2');
      expect(sec).toBeDefined();
      expect(sec!.currency).toBe('USD');
      expect(sec!.baseCurrency).toBe('EUR');

      // costBase: 490 USD × 0.85 EUR/USD = 416.50 EUR (FX-projection path)
      expect(parseFloat(sec!.costBase)).toBeCloseTo(416.50, 1);

      // marketValueBase: 1 share × 600 USD × 0.85 = 510.00 EUR
      expect(parseFloat(sec!.marketValueBase)).toBeCloseTo(510.00, 1);

      // Both must be non-zero
      expect(parseFloat(sec!.costBase)).toBeGreaterThan(0);
      expect(parseFloat(sec!.marketValueBase)).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
