// Pins the recursive-aggregation contract of getTaxonomySeriesPerformance.
//
// Two implementations of the same descent rule live side-by-side:
//   - services/performance.service.ts (account/security-scope filter path)
//   - services/taxonomy-performance.service.ts (data-series chart path)
// Without a fixture, drift between them is silent. This file locks the
// chart-path implementation against PP's classification-level contract:
//
//   metrics(parent) == Σ metrics(direct children)   for non-overlapping items
//   weight split    == proportional contribution across siblings
//   account assign  == cash balance included in slice MV
//   invisible-root  == entire-taxonomy aggregate
//
// Fixture: Industries taxonomy, 3 securities (one weight-split across two
// siblings), 1 deposit account assigned to a top-level slice. No in-period
// cashflows — keeps the MVE/MVB identity unambiguous.

import { describe, it, expect, beforeEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { getTaxonomySeriesPerformance } from '../taxonomy-performance.service';
import { createTestDb, hasSqliteBindings, shares, euros, price } from './test-fixtures';

const PERIOD = { start: '2024-01-01', end: '2024-12-31' };

// Identifiers
const TAXONOMY_ID  = 'tax-industries';
const ROOT_CAT     = 'cat-root';        // invisible root
const CAT_EQUITIES = 'cat-equities';    // top-level
const CAT_CASH     = 'cat-cash';        // top-level
const CAT_TECH     = 'cat-tech';        // child of Equities
const CAT_HC       = 'cat-healthcare';  // child of Equities

const SEC_TECH  = 'sec-tech';   // 100% Tech
const SEC_HC    = 'sec-hc';     // 100% Healthcare
const SEC_SPLIT = 'sec-split';  // 50% Tech + 50% Healthcare

const ACCT_CASH = 'acct-cash';

let db: BetterSqlite3.Database;

// ─── Fixture builders ───────────────────────────────────────────────────────

function insertSecurity(uuid: string, name: string) {
  db.prepare(`INSERT INTO security (uuid, name, currency, isRetired) VALUES (?, ?, 'EUR', 0)`)
    .run(uuid, name);
}
function insertDeposit(uuid: string, date: string, amountEur: number) {
  db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype)
    VALUES (?, 'DEPOSIT', ?, 'EUR', ?, 0, ?, 'account')`).run(uuid, date, euros(amountEur), ACCT_CASH);
}
function insertBuy(uuid: string, date: string, sec: string, shareCount: number, priceEach: number) {
  const gross = euros(shareCount * priceEach);
  db.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype)
    VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 'account')`).run(
    uuid, date, gross, shares(shareCount), sec, ACCT_CASH,
  );
}
function setPrice(sec: string, date: string, priceEur: number) {
  db.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(sec, date, price(priceEur));
}
function insertCategory(uuid: string, parent: string | null, name: string, rank: number) {
  db.prepare(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank)
    VALUES (?, ?, ?, ?, '#000000', 10000, ?)`).run(uuid, TAXONOMY_ID, parent, name, rank);
}
function insertAssignment(category: string, itemType: 'security' | 'account', item: string, weight = 10000) {
  db.prepare(`INSERT INTO taxonomy_assignment (taxonomy, category, item_type, item, weight)
    VALUES (?, ?, ?, ?, ?)`).run(TAXONOMY_ID, category, itemType, item, weight);
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  db = createTestDb();

  // Accounts + securities
  db.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(ACCT_CASH, 'Cash', 'account', 'EUR');
  insertSecurity(SEC_TECH, 'Tech Corp');
  insertSecurity(SEC_HC, 'Healthcare Corp');
  insertSecurity(SEC_SPLIT, 'Diversified Corp');

  // Taxonomy structure:
  //   Industries (root, invisible)
  //   ├── Equities (top-level)
  //   │   ├── Tech
  //   │   └── Healthcare
  //   └── Cash (top-level)
  db.prepare(`INSERT INTO taxonomy (uuid, name, root) VALUES (?, ?, ?)`).run(
    TAXONOMY_ID, 'Industries', ROOT_CAT,
  );
  insertCategory(ROOT_CAT, null, 'Industries', 0);
  insertCategory(CAT_EQUITIES, ROOT_CAT, 'Equities', 0);
  insertCategory(CAT_CASH, ROOT_CAT, 'Cash', 1);
  insertCategory(CAT_TECH, CAT_EQUITIES, 'Tech', 0);
  insertCategory(CAT_HC, CAT_EQUITIES, 'Healthcare', 1);

  // Assignments:
  //   SEC_TECH  → Tech 100%
  //   SEC_HC    → Healthcare 100%
  //   SEC_SPLIT → Tech 50% + Healthcare 50%   (cross-sibling split)
  //   ACCT_CASH → Cash 100%                    (deposit account assignment)
  insertAssignment(CAT_TECH, 'security', SEC_TECH);
  insertAssignment(CAT_HC, 'security', SEC_HC);
  insertAssignment(CAT_TECH, 'security', SEC_SPLIT, 5000);
  insertAssignment(CAT_HC, 'security', SEC_SPLIT, 5000);
  insertAssignment(CAT_CASH, 'account', ACCT_CASH);

  // Pre-period cashflow + buys — keeps the in-period MVB/MVE math clean.
  // All buys executed pre-period at €100/share; period-end prices diverge.
  insertDeposit('d1', '2023-12-01', 10_000);
  insertBuy('b-tech',  '2023-12-15', SEC_TECH,  10, 100);
  insertBuy('b-hc',    '2023-12-15', SEC_HC,    10, 100);
  insertBuy('b-split', '2023-12-15', SEC_SPLIT, 10, 100);

  // Pre-period and boundary prices: all securities @ €100 at period start.
  setPrice(SEC_TECH,  '2023-12-15', 100);
  setPrice(SEC_HC,    '2023-12-15', 100);
  setPrice(SEC_SPLIT, '2023-12-15', 100);
  setPrice(SEC_TECH,  '2024-01-01', 100);
  setPrice(SEC_HC,    '2024-01-01', 100);
  setPrice(SEC_SPLIT, '2024-01-01', 100);

  // Period-end prices: diverge so additivity is observable in non-trivial values.
  setPrice(SEC_TECH,  '2024-12-31', 110);
  setPrice(SEC_HC,    '2024-12-31', 120);
  setPrice(SEC_SPLIT, '2024-12-31', 130);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function runSlice(categoryId: string) {
  const [slice] = getTaxonomySeriesPerformance(
    db, TAXONOMY_ID, [categoryId], PERIOD, CostMethod.MOVING_AVERAGE, true, 'auto', undefined,
  );
  return slice!;
}

const TOLERANCE = new Decimal('0.01');
function approxEqual(a: string, b: Decimal | string) {
  return new Decimal(a).minus(b).abs().lte(TOLERANCE);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('taxonomy data-series — recursive aggregation', () => {
  it.skipIf(!hasSqliteBindings)('parent slice MVE equals sum of direct children MVE', () => {
    // Tech MVE   = SEC_TECH 10 × 110 + SEC_SPLIT 10 × 130 × 0.5 = 1100 + 650 = 1750
    // HC MVE     = SEC_HC   10 × 120 + SEC_SPLIT 10 × 130 × 0.5 = 1200 + 650 = 1850
    // Equities   = 1750 + 1850 = 3600
    const tech   = runSlice(CAT_TECH);
    const hc     = runSlice(CAT_HC);
    const equity = runSlice(CAT_EQUITIES);

    expect(approxEqual(tech.mve,   new Decimal(1750))).toBe(true);
    expect(approxEqual(hc.mve,     new Decimal(1850))).toBe(true);
    expect(approxEqual(equity.mve, new Decimal(3600))).toBe(true);

    // Strict additivity: parent == Σ children (within rounding tolerance)
    const childrenSum = new Decimal(tech.mve).plus(hc.mve);
    expect(approxEqual(equity.mve, childrenSum)).toBe(true);
  });

  it.skipIf(!hasSqliteBindings)('parent slice MVB equals sum of direct children MVB', () => {
    // At period start all prices are €100 → each holding worth €1000.
    // Tech MVB   = 1000 + 500 = 1500
    // HC MVB     = 1000 + 500 = 1500
    // Equities   = 3000
    const tech   = runSlice(CAT_TECH);
    const hc     = runSlice(CAT_HC);
    const equity = runSlice(CAT_EQUITIES);

    expect(approxEqual(tech.mvb,   new Decimal(1500))).toBe(true);
    expect(approxEqual(hc.mvb,     new Decimal(1500))).toBe(true);
    expect(approxEqual(equity.mvb, new Decimal(3000))).toBe(true);
    expect(approxEqual(equity.mvb, new Decimal(tech.mvb).plus(hc.mvb))).toBe(true);
  });

  it.skipIf(!hasSqliteBindings)('split-weight security is neither dropped nor counted in full', () => {
    // Drift detector for the weight-scaling step (`taxonomy-performance.service.ts:111`).
    // If weights were ignored: Tech would either include SEC_SPLIT in full (1100 + 1300 = 2400)
    // or drop it entirely (1100). Neither value may appear.
    const tech = runSlice(CAT_TECH);
    const mve = new Decimal(tech.mve);
    expect(mve.minus(2400).abs().gt(TOLERANCE)).toBe(true); // not full inclusion
    expect(mve.minus(1100).abs().gt(TOLERANCE)).toBe(true); // not zero contribution
  });

  it.skipIf(!hasSqliteBindings)('deposit account assignment surfaces cash balance in slice MV', () => {
    // ACCT_CASH balance @ 2024-12-31:
    //   +10000 (DEPOSIT) − 1000 − 1000 − 1000 (three BUYs) = 7000
    const cash = runSlice(CAT_CASH);
    expect(approxEqual(cash.mve, new Decimal(7000))).toBe(true);
    expect(approxEqual(cash.mvb, new Decimal(7000))).toBe(true);
  });

  it.skipIf(!hasSqliteBindings)('invisible-root category aggregates entire taxonomy', () => {
    // Backend handles taxonomy.root UUID as a valid category — even though the
    // UI tree endpoint does not surface it. Picking it should aggregate every
    // assignment in the taxonomy: Equities (3600) + Cash (7000) = 10600.
    const root     = runSlice(ROOT_CAT);
    const equity   = runSlice(CAT_EQUITIES);
    const cash     = runSlice(CAT_CASH);

    expect(approxEqual(root.mve, new Decimal(10600))).toBe(true);
    expect(approxEqual(root.mvb, new Decimal(10000))).toBe(true);
    expect(approxEqual(root.mve, new Decimal(equity.mve).plus(cash.mve))).toBe(true);
    expect(approxEqual(root.mvb, new Decimal(equity.mvb).plus(cash.mvb))).toBe(true);
  });

  it.skipIf(!hasSqliteBindings)('accepts categoryIds[] and returns parallel slices in input order', () => {
    const slices = getTaxonomySeriesPerformance(
      db, TAXONOMY_ID,
      [CAT_TECH, CAT_HC, CAT_CASH],
      PERIOD, CostMethod.MOVING_AVERAGE, true, 'auto', undefined,
    );

    expect(slices).toHaveLength(3);
    expect(slices[0]!.categoryId).toBe(CAT_TECH);
    expect(slices[1]!.categoryId).toBe(CAT_HC);
    expect(slices[2]!.categoryId).toBe(CAT_CASH);

    expect(approxEqual(slices[0]!.mve, new Decimal(1750))).toBe(true);
    expect(approxEqual(slices[1]!.mve, new Decimal(1850))).toBe(true);
    expect(approxEqual(slices[2]!.mve, new Decimal(7000))).toBe(true);
  });
});
