// Service-level regression for the multi-currency per-security perf path.
// Pins the three scenarios from docs/architecture/multi-currency.md:
//
//   1. USD security in EUR portfolio — user-reported case
//   2. GBP security in EUR portfolio — Zegona-shaped
//   3. GBp / GBP minor-unit non-regression — proves cost basis stays in GBP
//      (the security currency) and is not 100x inflated by a stray GBp leak
//
// The fixture mirrors how PP-XML imports land: xact.amount in deposit
// currency, plus a GROSS_VALUE xact_unit row carrying forex_amount /
// forex_currency / exchangeRate when the trade is cross-currency. We do
// NOT call applyBootstrap's backfill here — the test seeds the FOREX
// units directly to pin the read path (the backfill helper is covered
// separately by bootstrap-fx-backfill.test.ts).

import { describe, it, expect, beforeEach, expectTypeOf as _ } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { CostMethod } from '@quovibe/shared';
import { getSecurityPerformanceList } from '../performance.service';
import { createTestDb, shares, euros, price } from './test-fixtures';

const PERIOD = { start: '2025-01-01', end: '2025-12-31' };
const DEPOSIT = 'acc-cash-eur';

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = createTestDb();
  db.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(DEPOSIT, 'Cash EUR', 'account', 'EUR');
});

function insertSecurity(uuid: string, name: string, currency: string): void {
  db.prepare(
    `INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, 0)`,
  ).run(uuid, name, currency);
}

function insertCrossCurrencyBuy(opts: {
  uuid: string;
  date: string;
  securityId: string;
  shareCount: number;
  amountDepositCcy: number;        // gross in deposit currency (no fees)
  depositCurrency: string;
  forexAmountSecurityCcy: number;  // gross in security currency (no fees)
  securityCurrency: string;
  exchangeRate: string;            // deposit→security multiplicative
}): void {
  db.prepare(
    `INSERT INTO xact (
       uuid, type, date, currency, amount, shares, security, account, acctype
     ) VALUES (?, 'BUY', ?, ?, ?, ?, ?, ?, 'portfolio')`,
  ).run(
    opts.uuid, opts.date, opts.depositCurrency,
    euros(opts.amountDepositCcy), shares(opts.shareCount),
    opts.securityId, DEPOSIT,
  );
  // GROSS_VALUE FOREX unit — the shape ppxml2db produces for cross-ccy BUY.
  db.prepare(
    `INSERT INTO xact_unit (
       xact, type, amount, currency, forex_amount, forex_currency, exchangeRate
     ) VALUES (?, 'GROSS_VALUE', ?, ?, ?, ?, ?)`,
  ).run(
    opts.uuid,
    euros(opts.amountDepositCcy),
    opts.depositCurrency,
    euros(opts.forexAmountSecurityCcy),
    opts.securityCurrency,
    opts.exchangeRate,
  );
}

function setLatestPrice(uuid: string, date: string, priceNative: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`,
  ).run(uuid, date, price(priceNative));
}

function setPrice(uuid: string, date: string, priceNative: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`,
  ).run(uuid, date, price(priceNative));
}

describe('multi-currency per-security perf', () => {
  // ─── Scenario 1 — user's reported case ───────────────────────────────────
  it('USD security bought in EUR: cost basis + MV + unrealized in USD', () => {
    const SEC = 'sec-usd';
    insertSecurity(SEC, 'USD Stock', 'USD');

    // BUY 1 share for 366.60 EUR on 2025-02-01 at rate 1.10 EUR→USD
    //   → 403.26 USD security-currency gross
    insertCrossCurrencyBuy({
      uuid: 'tx1',
      date: '2025-02-01',
      securityId: SEC,
      shareCount: 1,
      amountDepositCcy: 366.6,
      depositCurrency: 'EUR',
      forexAmountSecurityCcy: 403.26,
      securityCurrency: 'USD',
      exchangeRate: '1.1',
    });

    // BUY 2 shares for 806.60 EUR on 2025-05-01 at rate 1.05 EUR→USD
    //   → 846.93 USD security-currency gross
    insertCrossCurrencyBuy({
      uuid: 'tx2',
      date: '2025-05-01',
      securityId: SEC,
      shareCount: 2,
      amountDepositCcy: 806.6,
      depositCurrency: 'EUR',
      forexAmountSecurityCcy: 846.93,
      securityCurrency: 'USD',
      exchangeRate: '1.05',
    });

    setPrice(SEC, '2025-02-01', 403.26);
    setPrice(SEC, '2025-05-01', 423.465);
    setPrice(SEC, '2025-12-31', 482.7);
    setLatestPrice(SEC, '2025-12-31', 482.7);

    const list = getSecurityPerformanceList(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const row = list.find((s) => s.securityId === SEC);
    expect(row).toBeDefined();
    expect(row!.currency).toBe('USD');

    // Cost basis in USD = 403.26 + 846.93 = 1,250.19 USD
    expect(parseFloat(row!.purchaseValue)).toBeCloseTo(1250.19, 2);

    // MVE = 3 × 482.70 = 1,448.10 USD
    expect(parseFloat(row!.mve)).toBeCloseTo(1448.10, 2);

    // Unrealized = MV − cost = 197.91 USD
    expect(parseFloat(row!.unrealizedGain)).toBeCloseTo(197.91, 2);

    // Shares end: 3
    expect(parseFloat(row!.shares)).toBeCloseTo(3, 6);
  });

  // ─── Scenario 2 — Zegona-shaped GBP security in EUR portfolio ────────────
  it('GBP security bought in EUR: cost basis + MV + unrealized in GBP', () => {
    const SEC = 'sec-gbp';
    insertSecurity(SEC, 'GBP Stock', 'GBP');

    // BUY 100 shares for 1,200 EUR on 2025-02-01 at rate 0.86 EUR→GBP
    //   → 1,032 GBP security-currency gross
    insertCrossCurrencyBuy({
      uuid: 'tx-gbp',
      date: '2025-02-01',
      securityId: SEC,
      shareCount: 100,
      amountDepositCcy: 1200,
      depositCurrency: 'EUR',
      forexAmountSecurityCcy: 1032,
      securityCurrency: 'GBP',
      exchangeRate: '0.86',
    });

    setPrice(SEC, '2025-02-01', 10.32);
    setPrice(SEC, '2025-12-31', 12.50);
    setLatestPrice(SEC, '2025-12-31', 12.50);

    const list = getSecurityPerformanceList(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const row = list.find((s) => s.securityId === SEC);
    expect(row).toBeDefined();
    expect(row!.currency).toBe('GBP');

    // Cost basis = 1,032.00 GBP
    expect(parseFloat(row!.purchaseValue)).toBeCloseTo(1032.0, 2);

    // MV = 100 × 12.50 = 1,250.00 GBP
    expect(parseFloat(row!.mve)).toBeCloseTo(1250.0, 2);

    // Unrealized = 1,250 − 1,032 = 218.00 GBP
    expect(parseFloat(row!.unrealizedGain)).toBeCloseTo(218.0, 2);
  });

  // ─── Scenario 3 — GBp / GBP minor-unit non-regression ────────────────────
  it('GBP security stays in GBP — minor-unit (GBp) 100x inflation does not creep in', () => {
    const SEC = 'sec-gbp-minor';
    insertSecurity(SEC, 'GBP Stock minor', 'GBP');

    // BUY 100 shares for 1,000 EUR at rate 0.85 EUR→GBP → 850 GBP gross.
    insertCrossCurrencyBuy({
      uuid: 'tx-gbp-minor',
      date: '2025-02-01',
      securityId: SEC,
      shareCount: 100,
      amountDepositCcy: 1000,
      depositCurrency: 'EUR',
      forexAmountSecurityCcy: 850,
      securityCurrency: 'GBP',
      exchangeRate: '0.85',
    });

    // Prices stored in GBP (post BUG-127 normalization).
    setPrice(SEC, '2025-02-01', 8.50);
    setPrice(SEC, '2025-12-31', 9.50);
    setLatestPrice(SEC, '2025-12-31', 9.50);

    const list = getSecurityPerformanceList(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const row = list.find((s) => s.securityId === SEC);
    expect(row).toBeDefined();
    expect(row!.currency).toBe('GBP');

    // Cost 850 GBP. NOT 85,000 (the 100x inflation symptom).
    expect(parseFloat(row!.purchaseValue)).toBeCloseTo(850.0, 2);
    expect(parseFloat(row!.purchaseValue)).toBeLessThan(10_000);

    // MV 100 × 9.50 = 950 GBP. NOT 95,000.
    expect(parseFloat(row!.mve)).toBeCloseTo(950.0, 2);
    expect(parseFloat(row!.mve)).toBeLessThan(10_000);

    // Unrealized 100 GBP.
    expect(parseFloat(row!.unrealizedGain)).toBeCloseTo(100.0, 2);
  });

  // ─── Scenario 4 — same-currency BUY: no GROSS_VALUE unit, no regression ──
  it('same-currency EUR security: pre-fix arithmetic still holds', () => {
    const SEC = 'sec-eur';
    insertSecurity(SEC, 'EUR Stock', 'EUR');

    // Same-currency BUY: no GROSS_VALUE FOREX unit (matches PP convention).
    db.prepare(
      `INSERT INTO xact (
         uuid, type, date, currency, amount, shares, security, account, acctype
       ) VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'portfolio')`,
    ).run(
      'tx-eur', '2025-02-01', euros(500), shares(10), SEC, DEPOSIT,
    );

    setPrice(SEC, '2025-02-01', 50);
    setPrice(SEC, '2025-12-31', 60);
    setLatestPrice(SEC, '2025-12-31', 60);

    const list = getSecurityPerformanceList(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const row = list.find((s) => s.securityId === SEC);
    expect(row).toBeDefined();
    expect(row!.currency).toBe('EUR');
    expect(parseFloat(row!.purchaseValue)).toBeCloseTo(500.0, 2);
    expect(parseFloat(row!.mve)).toBeCloseTo(600.0, 2);
    expect(parseFloat(row!.unrealizedGain)).toBeCloseTo(100.0, 2);
  });

  // ─── Scenario 5 — vf_exchange_rate backfill path ──────────────────────────
  // Cross-currency BUY without a GROSS_VALUE unit, but with a rate stored
  // in vf_exchange_rate. The service-layer projection helper falls back
  // to getRate() and produces the same security-currency cost as if the
  // unit were present.
  it('falls back to vf_exchange_rate when GROSS_VALUE unit is missing', () => {
    const SEC = 'sec-usd-fallback';
    insertSecurity(SEC, 'USD Stock fallback', 'USD');

    db.prepare(
      `INSERT INTO xact (
         uuid, type, date, currency, amount, shares, security, account, acctype
       ) VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'portfolio')`,
    ).run('tx-fb', '2025-02-01', euros(366.6), shares(1), SEC, DEPOSIT);

    db.prepare(
      `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate)
       VALUES (?, ?, ?, ?)`,
    ).run('2025-02-01', 'EUR', 'USD', '1.1');

    setPrice(SEC, '2025-02-01', 403.26);
    setPrice(SEC, '2025-12-31', 482.7);
    setLatestPrice(SEC, '2025-12-31', 482.7);

    const list = getSecurityPerformanceList(db, PERIOD, CostMethod.MOVING_AVERAGE, true);
    const row = list.find((s) => s.securityId === SEC);
    expect(row).toBeDefined();
    expect(row!.currency).toBe('USD');
    // 366.60 EUR × 1.10 = 403.26 USD
    expect(parseFloat(row!.purchaseValue)).toBeCloseTo(403.26, 2);
    expect(parseFloat(row!.mve)).toBeCloseTo(482.70, 2);
    expect(parseFloat(row!.unrealizedGain)).toBeCloseTo(79.44, 2);
  });

  // ─── Scenario 6 — quovibe-native FOREX-typed units (Test-2026-05-16.db) ──
  // Mirrors the user's reproducer DB: 2 BUYs of BRK-B (USD security) created
  // through the regular quovibe API (NOT PP-XML), each emitting a
  // type='FOREX' xact_unit (per transaction.service.ts > buildUnits). The
  // dual-writer resolver MUST treat these identically to type='GROSS_VALUE'.
  it('BRK-B cross-ccy BUYs with type=FOREX units resolve to USD cost basis', () => {
    const SEC = 'sec-brk-b';
    insertSecurity(SEC, 'Berkshire Hathaway Inc.', 'USD');

    // BUY 1 share for 406.79 EUR on 2026-05-01 at rate 1.1628 EUR→USD
    //   → 473.01 USD
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
       VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'portfolio')`,
    ).run('tx-brk-1', '2026-05-01', euros(406.79), shares(1), SEC, DEPOSIT);
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES (?, 'FOREX', ?, 'EUR', ?, 'USD', ?)`,
    ).run('tx-brk-1', euros(406.79), euros(473.01), '1.1628');

    // BUY 1 share for 404.68 EUR on 2026-05-08 at rate 1.1761 EUR→USD
    //   → 475.94 USD
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
       VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'portfolio')`,
    ).run('tx-brk-2', '2026-05-08', euros(404.68), shares(1), SEC, DEPOSIT);
    db.prepare(
      `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
       VALUES (?, 'FOREX', ?, 'EUR', ?, 'USD', ?)`,
    ).run('tx-brk-2', euros(404.68), euros(475.94), '1.1761');

    setPrice(SEC, '2026-05-01', 473.01);
    setPrice(SEC, '2026-05-08', 475.94);
    setPrice(SEC, '2026-05-31', 480.0);
    setLatestPrice(SEC, '2026-05-31', 480.0);

    const list = getSecurityPerformanceList(
      db,
      { start: '2026-01-01', end: '2026-12-31' },
      CostMethod.MOVING_AVERAGE,
      true,
    );
    const row = list.find((s) => s.securityId === SEC);
    expect(row).toBeDefined();
    expect(row!.currency).toBe('USD');

    // Cost basis USD = 473.01 + 475.94 = 948.95
    // (NOT 406.79 + 404.68 = 811.47 EUR labelled as USD — the bug shape.)
    expect(parseFloat(row!.purchaseValue)).toBeCloseTo(948.95, 2);

    // MV = 2 × 480.00 = 960.00 USD
    expect(parseFloat(row!.mve)).toBeCloseTo(960.0, 2);

    // Unrealized = 960.00 − 948.95 = 11.05 USD
    expect(parseFloat(row!.unrealizedGain)).toBeCloseTo(11.05, 2);
  });
});
