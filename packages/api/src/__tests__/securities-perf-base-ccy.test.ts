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

// ─── Per-leg conversion + fee/tax base fields ────────────────────────────────
//
// Fixture shape shared by the blocks below: EUR base, USD security, ONE in-period
// BUY, and an FX rate that MOVES between the trade date (0.95) and period end
// (0.88). The FX swing is what discriminates the two candidate conventions:
//
//   per-leg   → mveBase − costBase          (each side converted at its own date)
//   diff-then-convert → nativeGain × endRate (the old, wrong shape)
//
// Values are chosen so the two disagree in SIGN, not just magnitude.

function seedFxSwingFixture(
  db: Database.Database,
  opts: { feesUsd?: number; taxesUsd?: number } = {},
): void {
  const feesUsd = opts.feesUsd ?? 0;
  const taxesUsd = opts.taxesUsd ?? 0;
  applyBootstrap(db);

  db.prepare(
    `INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`,
  ).run();
  db.prepare(
    `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (1, 'acc-dep', 'Cash EUR', 'EUR', 'account', NULL, '2026-01-01T00:00:00Z', 1, 0)`,
  ).run();
  db.prepare(
    `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (2, 'acc-sec', 'Broker', 'EUR', 'portfolio', 'acc-dep', '2026-01-01T00:00:00Z', 2, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO security (_id, uuid, name, currency, isin, isRetired, updatedAt)
     VALUES (1, 's-usd', 'Tech USD Inc', 'USD', 'US1111111111', 0, '2026-01-01T00:00:00Z')`,
  ).run();

  // 10 shares bought at 100 USD; quote at period end 105 USD.
  db.prepare(
    `INSERT INTO price (security, tstamp, value) VALUES ('s-usd', '2026-02-02', ?)`,
  ).run(Math.round(100 * 1e8));
  db.prepare(
    `INSERT INTO latest_price (security, tstamp, value) VALUES ('s-usd', '2026-06-20', ?)`,
  ).run(Math.round(105 * 1e8));

  const fx = db.prepare(
    `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
     VALUES (?, 'USD', 'EUR', ?)`,
  );
  fx.run('2026-01-01', '0.95');
  fx.run('2026-02-02', '0.95'); // trade date
  fx.run('2026-06-30', '0.88'); // period end — USD weakened vs EUR

  // BUY: xact.amount is the total outflow (gross + fees + taxes) per ppxml2db.
  const totalUsd = 1000 + feesUsd + taxesUsd;
  db.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('b1-sec', 'acc-sec', 'BUY', '2026-02-02', ?, 1000000000, 's-usd', 'USD',
             'portfolio', '2026-02-02T00:00:00Z', 1, 0, 0, 0)`,
  ).run(Math.round(totalUsd * 100));
  db.prepare(
    `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                       acctype, updatedAt, _xmlid, _order, fees, taxes)
     VALUES ('b1-cas', 'acc-dep', 'BUY', '2026-02-02', ?, 0, 's-usd', 'USD',
             'account', '2026-02-02T00:00:00Z', 2, 1, 0, 0)`,
  ).run(Math.round(totalUsd * 100));
  db.prepare(
    `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
     VALUES ('b1-sec', 'acc-sec', 'b1-cas', 'acc-dep', 'buysell')`,
  ).run();

  // Units live on the securities-side row only — the shape the write path emits.
  const unit = db.prepare(
    `INSERT INTO xact_unit (xact, type, amount, currency) VALUES (?, ?, ?, 'USD')`,
  );
  if (feesUsd > 0) unit.run('b1-sec', 'FEE', Math.round(feesUsd * 100));
  if (taxesUsd > 0) unit.run('b1-sec', 'TAX', Math.round(taxesUsd * 100));
}

const SWING_PERIOD = { start: '2026-01-01', end: '2026-06-30' };

describe('getSecurityPerformanceList — unrealizedBase per-leg conversion', () => {
  it('converts each leg at its own date instead of converting the native difference', () => {
    const db = new Database(':memory:');
    try {
      seedFxSwingFixture(db);
      const results = getSecurityPerformanceList(db, SWING_PERIOD, CostMethod.MOVING_AVERAGE, true);
      const sec = results.find((r) => r.securityId === 's-usd')!;

      // costBase:        1000 USD × 0.95 = 950.00 EUR (trade-date rate)
      // marketValueBase: 1050 USD × 0.88 = 924.00 EUR (period-end rate)
      expect(parseFloat(sec.costBase)).toBeCloseTo(950.0, 1);
      expect(parseFloat(sec.marketValueBase)).toBeCloseTo(924.0, 1);

      // Per-leg: 924.00 − 950.00 = −26.00 EUR. The position gained in USD but the
      // EUR investor lost, because USD weakened more than the quote rose.
      expect(parseFloat(sec.unrealizedBase)).toBeCloseTo(-26.0, 1);

      // The native figure is a gain, and the old diff-then-convert shape would
      // have emitted +44.00 EUR (50 USD × 0.88) — opposite sign.
      expect(parseFloat(sec.unrealizedGain)).toBeCloseTo(50.0, 1);
      expect(parseFloat(sec.unrealizedBase)).toBeLessThan(0);
    } finally {
      db.close();
    }
  });

  it('reconciles with the fields rendered beside it: unrealizedBase = marketValueBase − costBase', () => {
    const db = new Database(':memory:');
    try {
      seedFxSwingFixture(db);
      const results = getSecurityPerformanceList(db, SWING_PERIOD, CostMethod.MOVING_AVERAGE, true);
      const sec = results.find((r) => r.securityId === 's-usd')!;

      expect(parseFloat(sec.unrealizedBase)).toBeCloseTo(
        parseFloat(sec.marketValueBase) - parseFloat(sec.costBase),
        6,
      );
    } finally {
      db.close();
    }
  });

  it('matches the capital + FX decomposition it is displayed alongside', () => {
    const db = new Database(':memory:');
    try {
      seedFxSwingFixture(db);
      const results = getSecurityPerformanceList(db, SWING_PERIOD, CostMethod.MOVING_AVERAGE, true);
      const sec = results.find((r) => r.securityId === 's-usd')!;

      expect(parseFloat(sec.unrealizedBase)).toBeCloseTo(
        parseFloat(sec.unrealizedCapitalBase) + parseFloat(sec.unrealizedFxBase),
        6,
      );
    } finally {
      db.close();
    }
  });

  it('same-currency securities keep the native unrealized gain untouched', () => {
    const db = new Database(':memory:');
    try {
      applyBootstrap(db);
      db.prepare(
        `INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`,
      ).run();
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (1, 'acc-dep', 'Cash', 'EUR', 'account', NULL, '2026-01-01T00:00:00Z', 1, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (2, 'acc-sec', 'Broker', 'EUR', 'portfolio', 'acc-dep', '2026-01-01T00:00:00Z', 2, 1)`,
      ).run();
      db.prepare(
        `INSERT INTO security (_id, uuid, name, currency, isin, isRetired, updatedAt)
         VALUES (1, 's-eur', 'Acme EUR', 'EUR', 'IT0000000002', 0, '2026-01-01T00:00:00Z')`,
      ).run();
      db.prepare(
        `INSERT INTO latest_price (security, tstamp, value) VALUES ('s-eur', '2026-06-20', ?)`,
      ).run(Math.round(105 * 1e8));
      db.prepare(
        `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                           acctype, updatedAt, _xmlid, _order, fees, taxes)
         VALUES ('e1-sec', 'acc-sec', 'BUY', '2026-02-02', ?, 1000000000, 's-eur', 'EUR',
                 'portfolio', '2026-02-02T00:00:00Z', 1, 0, 0, 0)`,
      ).run(Math.round(1000 * 100));
      db.prepare(
        `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                           acctype, updatedAt, _xmlid, _order, fees, taxes)
         VALUES ('e1-cas', 'acc-dep', 'BUY', '2026-02-02', ?, 0, 's-eur', 'EUR',
                 'account', '2026-02-02T00:00:00Z', 2, 1, 0, 0)`,
      ).run(Math.round(1000 * 100));
      db.prepare(
        `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
         VALUES ('e1-sec', 'acc-sec', 'e1-cas', 'acc-dep', 'buysell')`,
      ).run();

      const results = getSecurityPerformanceList(db, SWING_PERIOD, CostMethod.MOVING_AVERAGE, true);
      const sec = results.find((r) => r.securityId === 's-eur')!;
      expect(sec.unrealizedBase).toBe(sec.unrealizedGain);
    } finally {
      db.close();
    }
  });
});

describe('getSecurityPerformanceList — feesBase / taxesBase', () => {
  it('emits fees and taxes in base currency at trade-date FX', () => {
    const db = new Database(':memory:');
    try {
      seedFxSwingFixture(db, { feesUsd: 20, taxesUsd: 10 });
      const results = getSecurityPerformanceList(db, SWING_PERIOD, CostMethod.MOVING_AVERAGE, false);
      const sec = results.find((r) => r.securityId === 's-usd')!;

      // Native: the USD unit amounts as booked.
      expect(parseFloat(sec.fees)).toBeCloseTo(20.0, 2);
      expect(parseFloat(sec.taxes)).toBeCloseTo(10.0, 2);

      // Base: converted at the 2026-02-02 rate (0.95), NOT the period-end 0.88.
      expect(parseFloat(sec.feesBase)).toBeCloseTo(19.0, 2);
      expect(parseFloat(sec.taxesBase)).toBeCloseTo(9.5, 2);
    } finally {
      db.close();
    }
  });

  it('mirrors the preTax gate on taxesBase', () => {
    const db = new Database(':memory:');
    try {
      seedFxSwingFixture(db, { feesUsd: 20, taxesUsd: 10 });
      const results = getSecurityPerformanceList(db, SWING_PERIOD, CostMethod.MOVING_AVERAGE, true);
      const sec = results.find((r) => r.securityId === 's-usd')!;

      // preTax=true zeroes the native taxes line; the base field must follow it
      // or the currency toggle would flip a 0 into a non-zero figure.
      expect(parseFloat(sec.taxes)).toBe(0);
      expect(parseFloat(sec.taxesBase)).toBe(0);
      expect(parseFloat(sec.feesBase)).toBeCloseTo(19.0, 2);
    } finally {
      db.close();
    }
  });

  it('same-currency securities emit feesBase equal to the native fees', () => {
    const db = new Database(':memory:');
    try {
      applyBootstrap(db);
      db.prepare(
        `INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`,
      ).run();
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (1, 'acc-dep', 'Cash', 'EUR', 'account', NULL, '2026-01-01T00:00:00Z', 1, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO account (_id, uuid, name, currency, type, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (2, 'acc-sec', 'Broker', 'EUR', 'portfolio', 'acc-dep', '2026-01-01T00:00:00Z', 2, 1)`,
      ).run();
      db.prepare(
        `INSERT INTO security (_id, uuid, name, currency, isin, isRetired, updatedAt)
         VALUES (1, 's-eur', 'Acme EUR', 'EUR', 'IT0000000003', 0, '2026-01-01T00:00:00Z')`,
      ).run();
      db.prepare(
        `INSERT INTO latest_price (security, tstamp, value) VALUES ('s-eur', '2026-06-20', ?)`,
      ).run(Math.round(105 * 1e8));
      db.prepare(
        `INSERT INTO xact (uuid, account, type, date, amount, shares, security, currency,
                           acctype, updatedAt, _xmlid, _order, fees, taxes)
         VALUES ('e1-sec', 'acc-sec', 'BUY', '2026-02-02', ?, 1000000000, 's-eur', 'EUR',
                 'portfolio', '2026-02-02T00:00:00Z', 1, 0, 0, 0)`,
      ).run(Math.round(1007 * 100));
      db.prepare(
        `INSERT INTO xact_unit (xact, type, amount, currency) VALUES ('e1-sec', 'FEE', ?, 'EUR')`,
      ).run(Math.round(7 * 100));

      const results = getSecurityPerformanceList(db, SWING_PERIOD, CostMethod.MOVING_AVERAGE, true);
      const sec = results.find((r) => r.securityId === 's-eur')!;
      expect(parseFloat(sec.fees)).toBeCloseTo(7.0, 2);
      expect(sec.feesBase).toBe(sec.fees);
    } finally {
      db.close();
    }
  });
});
