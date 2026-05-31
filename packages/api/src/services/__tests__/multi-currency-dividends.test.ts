import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { applyBootstrap } from '../../db/apply-bootstrap';
import {
  getSecurityPerformanceList,
  getPortfolioCalc,
} from '../performance.service';

/**
 * Cross-currency DIVIDEND pin (GBP security, EUR-base portfolio).
 *
 * A dividend is RECEIVED in the deposit (cash-leg) currency. The booked cash
 * on `xact.amount` is the value the user sees in the transaction list and the
 * only authoritative figure. Both the portfolio Calculation panel and the
 * per-security Performance panel must display that booked amount in base
 * currency — NOT a re-projection of the security-currency gross at the
 * reporting-period-end FX rate, which drifts with the window and never ties
 * back to the transaction list.
 *
 * Fixture mirrors the real reported case: ZEGONA (GBP) dividend booked at
 * 135.83 EUR (xact.amount=13583, xact.currency='EUR'); the FOREX unit carries
 * the GBP-declared gross (117.68 GBP) and the receipt-date rate (0.8664
 * EUR->GBP), exactly as transaction.service.ts writes a cross-currency
 * dividend. Because the dividend's booked currency IS the base currency, the
 * correct base figure needs no FX rate at all — it is the booked amount.
 */

let db: Database.Database;

function setup(): { secId: string; depositId: string } {
  db = new Database(':memory:');
  applyBootstrap(db);
  const secId = randomUUID();
  const depositId = randomUUID();
  db.prepare(
    `INSERT INTO security (uuid, name, currency, isRetired, updatedAt)
     VALUES (?, 'GB Stock', 'GBP', 0, '2025-01-01T00:00:00Z')`,
  ).run(secId);
  db.prepare(
    `INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order)
     VALUES (?, 'Cash', 'account', 'EUR', '2025-01-01T00:00:00Z', 1, 0)`,
  ).run(depositId);
  db.prepare(
    `INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('baseCurrency', 'EUR')`,
  ).run();
  // One price + a latest_price so the perf engine can build market values for
  // the held security; values are incidental to the dividend assertions.
  db.prepare(
    `INSERT INTO price (security, tstamp, value) VALUES (?, '2026-01-07', 1852000000)`,
  ).run(secId);
  db.prepare(
    `INSERT INTO latest_price (security, tstamp, value) VALUES (?, '2026-01-07', 1852000000)`,
  ).run(secId);
  // GBP↔EUR rates spanning the test windows. The portfolio rollup converts each
  // security's MVB/MVE to base via these and SKIPS any security with no
  // resolvable rate at a period boundary — without them the GBP security drops
  // out of `earnings.dividends` entirely. The per-security path needs no rate
  // here (the dividend is booked in EUR), but the portfolio path does.
  const rate = db.prepare(
    `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate, source)
     VALUES (?, 'EUR', 'GBP', '0.8664', 'TEST')`,
  );
  for (const d of ['2026-01-01', '2026-01-07', '2026-02-15', '2026-05-30']) rate.run(d);
  return { secId, depositId };
}

function seedCrossCcyDividend(secId: string, depositId: string): void {
  const xactId = randomUUID();
  db.prepare(
    `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, updatedAt, _xmlid, _order)
     VALUES (?, 'DIVIDENDS', '2026-01-07T00:00:00', 'EUR', 13583, 0, ?, ?, 'account', '2026-01-07T00:00:00Z', 100, 0)`,
  ).run(xactId, secId, depositId);
  db.prepare(
    `INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
     VALUES (?, 'FOREX', 13583, 'EUR', 11768, 'GBP', '0.8664')`,
  ).run(xactId);
}

describe('cross-currency DIVIDEND — booked deposit amount, not period-end re-projection', () => {
  let secId: string;

  beforeEach(() => {
    const ids = setup();
    secId = ids.secId;
    seedCrossCcyDividend(ids.secId, ids.depositId);
  });
  afterEach(() => db?.close());

  it('portfolio dividends total reflects the booked deposit-currency amount', () => {
    const calc = getPortfolioCalc(db, { start: '2026-01-01', end: '2026-05-30' }, undefined, false, true);
    expect(calc.earnings.dividends).toBe('135.83');
  });

  it('portfolio dividend breakdown item is base-ccy and matches the total', () => {
    const calc = getPortfolioCalc(db, { start: '2026-01-01', end: '2026-05-30' }, undefined, false, true);
    // The breakdown card renders each item with currency={baseCurrency};
    // a native-GBP value (117.68) would render as "117,68 €" and never tie to
    // the 135.83 total.
    expect(calc.earnings.dividendItems[0]?.dividends).toBe('135.83');
  });

  it('per-security dividends (native) is the security-ccy gross', () => {
    const sec = getSecurityPerformanceList(db, { start: '2026-01-01', end: '2026-05-30' })
      .find((r) => r.securityId === secId)!;
    expect(sec.currency).toBe('GBP');
    expect(sec.dividends).toBe('117.68');
  });

  it('per-security dividendsBase is the booked deposit amount (the panel € figure)', () => {
    const sec = getSecurityPerformanceList(db, { start: '2026-01-01', end: '2026-05-30' })
      .find((r) => r.securityId === secId)!;
    expect(sec.dividendsBase).toBe('135.83');
  });

  it('per-security dividendsBase is independent of the reporting-period end', () => {
    const wide = getSecurityPerformanceList(db, { start: '2026-01-01', end: '2026-05-30' })
      .find((r) => r.securityId === secId)!.dividendsBase;
    const narrow = getSecurityPerformanceList(db, { start: '2026-01-01', end: '2026-02-15' })
      .find((r) => r.securityId === secId)!.dividendsBase;
    // Booked cash never changes with period.end; a period-end FX re-projection
    // (the bug) would drift between these two windows.
    expect(wide).toBe('135.83');
    expect(narrow).toBe('135.83');
  });
});
