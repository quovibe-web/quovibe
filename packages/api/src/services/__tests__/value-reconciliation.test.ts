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
import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { getPortfolioCalc, getStatementOfAssets } from '../performance.service';
import { getPayments } from '../reports.service';
import { createTestDb, hasSqliteBindings, shares, euros, price } from './test-fixtures';

const PERIOD = { start: '2024-01-01', end: '2024-12-31' };
const ACTIVE_SEC = 'sec-active';
const RETIRED_SEC = 'sec-retired';
const DEPOSIT = 'acct-cash';

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = createTestDb();
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

// ─── Date-suffix end-of-period inclusion ────────────────────────────────────
//
// xact.date is stored as ppxml2db's ISO timestamp 'YYYY-MM-DDTHH:MM' (PP-XML
// import) or sometimes a longer ISO 'YYYY-MM-DDTHH:MM:SS', while period
// boundaries arrive at the service layer as bare 'YYYY-MM-DD'. SQLite compares
// strings lexicographically, so 'YYYY-MM-DDT07:02' <= 'YYYY-MM-DD' is FALSE
// (the trailing 'T' sorts AFTER end-of-string). Any SQL filter that writes
// `date <= ?` or `date BETWEEN ? AND ?` against a bare period-end therefore
// silently drops every transaction stamped on the boundary date.
//
// Two precedents in this codebase already handle the asymmetry:
//   - fetchDepositCashBalance / fetchAllDepositBalances → SUBSTR(x.date, 1, 10) <= ?
//   - GET /api/transactions ?to=...                    → param + 'T23:59:59'
//
// fetchNetSharesPerSecurity used a bare `date <= ?` and was the third sibling
// that should have followed precedent #1. The end-of-period BUY landed in the
// perf engine (which slices the date to YYYY-MM-DD in JS before comparing)
// but was missed by the statement-of-assets engine (which delegates the
// comparison to SQL via fetchNetSharesPerSecurity). Result: dashboard
// (perf.finalValue) and Investments header (SoA totals.marketValue) reported
// different MV totals at the same period.end — €402.30 / 0.116 % drift on a
// real user portfolio with a single end-of-month BUY at YYYY-MM-DDT07:02.
//
// PP convention is unambiguous: a transaction dated period.end IS within the
// reporting period. The perf engine is correct; the SoA engine was reading
// stale net-shares.

describe('value reconciliation — end-of-period timestamped transactions', () => {
  it.skipIf(!hasSqliteBindings)('finalValue and SoA marketValue agree when a BUY lands at period.end with a time suffix', () => {
    const PERIOD_TS = { start: '2024-01-01', end: '2024-12-31' };
    const SEC = 'sec-eod';
    const ACCT = 'acct-eod';

    const localDb = createTestDb();
    localDb.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
      .run(SEC, 'EoD Corp', 'EUR', 0);
    localDb.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
      .run(ACCT, 'Cash', 'account', 'EUR');

    // Seed cash so the BUY clears.
    localDb.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype)
      VALUES (?, 'DEPOSIT', '2023-12-01', 'EUR', ?, 0, ?, 'account')`).run(
      'd1', euros(10_000), ACCT,
    );

    // Pre-period BUY — establishes a baseline holding (10 shares at 100).
    localDb.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
      VALUES (?, 'BUY', '2023-12-15T09:00', 'EUR', ?, ?, ?, ?, 'account')`).run(
      'b-pre', euros(1000), shares(10), SEC, ACCT,
    );

    // The bug witness: a BUY landing at PERIOD.end with a 'T07:02' suffix.
    // 17.452 shares × 23.052 each is the real-world figure that triggered the
    // €402.30 drift in QA-PRE-1.4.0 §5.1 — keep the magnitude faithful so a
    // future regression that silently rounds the diff away can't slip past.
    localDb.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
      VALUES (?, 'BUY', '2024-12-31T07:02', 'EUR', ?, ?, ?, ?, 'account')`).run(
      'b-eod', euros(402.31), shares(17.452), SEC, ACCT,
    );

    localDb.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(SEC, '2023-12-15', price(100));
    localDb.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(SEC, '2024-01-01', price(105));
    localDb.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(SEC, '2024-12-31', price(23.052));

    const calc = getPortfolioCalc(localDb, PERIOD_TS, CostMethod.MOVING_AVERAGE, true);
    const statement = getStatementOfAssets(localDb, PERIOD_TS.end);

    // Both surfaces must agree to the cent at period.end.
    expect(new Decimal(calc.finalValue).toFixed(4)).toBe(
      new Decimal(statement.totals.marketValue).toFixed(4),
    );

    // And the EoD BUY must actually be reflected in held shares — guard
    // against both sides silently converging on "10 shares" (which would
    // match but be wrong).
    const eodSec = statement.securities.find((s) => s.securityId === SEC);
    expect(eodSec).toBeDefined();
    expect(new Decimal(eodSec!.shares).toString()).toBe('27.452');

    localDb.close();
  });

  it.skipIf(!hasSqliteBindings)('a DIVIDEND timestamped on period.end is counted in payments aggregations', () => {
    // Symmetric guard for reports.service.ts getPayments / getPaymentBreakdown:
    // the same `BETWEEN ? AND ?` bug class would drop a DIVIDEND landing at
    // period.end with an HH:MM suffix from the dividend list rendered by
    // /api/p/<pid>/reports/payments. The SQL fragment used by those routes
    // shares the bug class with fetchNetSharesPerSecurity; if the fix
    // accidentally ships only against the shares helper, this test catches
    // it from the second surface.
    const PERIOD_DIV = { start: '2024-01-01', end: '2024-12-31' };
    const SEC = 'sec-div';
    const ACCT = 'acct-div';

    const localDb = createTestDb();
    localDb.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, ?, ?)`)
      .run(SEC, 'Div Corp', 'EUR', 0);
    localDb.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
      .run(ACCT, 'Cash', 'account', 'EUR');
    // Holding so a DIVIDEND has a security to attach to.
    localDb.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
      VALUES (?, 'BUY', '2023-12-01T09:00', 'EUR', ?, ?, ?, ?, 'account')`).run(
      'b1', euros(1000), shares(10), SEC, ACCT,
    );
    // DIVIDEND on the period boundary with a time suffix — this is the row
    // that the buggy `WHERE x.date BETWEEN ? AND ?` silently dropped.
    localDb.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
      VALUES (?, 'DIVIDENDS', '2024-12-31T15:30', 'EUR', ?, 0, ?, ?, 'account')`).run(
      'div-eod', euros(42.5), SEC, ACCT,
    );
    localDb.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(SEC, '2023-12-01', price(100));
    localDb.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(SEC, '2024-12-31', price(105));

    const result = getPayments(localDb, PERIOD_DIV.start, PERIOD_DIV.end, 'year');

    expect(new Decimal(result.totals.dividendsGross).toFixed(2)).toBe('42.50');

    localDb.close();
  });
});
