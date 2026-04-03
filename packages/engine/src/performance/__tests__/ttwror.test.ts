// Reference: True Time-Weighted Rate of Return (TTWROR)
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { TransactionType } from '@quovibe/shared';
import type { Cashflow } from '@quovibe/shared';
import {
  carryForwardPrices,
  buildDailySnapshots,
  buildDailySnapshotsWithCarry,
  computeTTWROR,
} from '../ttwror';

/**
 * TTWROR — True Time-Weighted Rate of Return
 *
 * Equation:
 *   1 + r = (MVE + CFout) / (MVB + CFin)
 *
 * CFin  = inflows at start of day (≥ 0)
 * CFout = outflows at end of day  (≥ 0)
 */

const d = (v: number | string) => new Decimal(v);

// Helper: create a Cashflow (type=DEPOSIT for inflow, REMOVAL for outflow)
function cf(date: string, amount: number): Cashflow {
  return {
    date,
    amount: d(amount),
    type: amount >= 0 ? TransactionType.DEPOSIT : TransactionType.REMOVAL,
  };
}

// Helper: check that a Decimal is close to expected (within tolerance)
function expectClose(actual: Decimal, expected: number, tol = 0.0001) {
  expect(actual.toNumber()).toBeCloseTo(expected, Math.round(-Math.log10(tol)));
}

describe('carryForwardPrices', () => {
  it('fills gaps with last known value', () => {
    const prices = new Map<string, Decimal>([
      ['2021-06-12', d(177.94)],
      ['2021-06-15', d(180)],
    ]);
    const filled = carryForwardPrices(prices, '2021-06-12', '2021-06-17');
    expect(filled.get('2021-06-12')?.toNumber()).toBe(177.94);
    expect(filled.get('2021-06-13')?.toNumber()).toBe(177.94); // gap filled
    expect(filled.get('2021-06-14')?.toNumber()).toBe(177.94); // gap filled
    expect(filled.get('2021-06-15')?.toNumber()).toBe(180);
    expect(filled.get('2021-06-16')?.toNumber()).toBe(180); // gap filled
    expect(filled.get('2021-06-17')?.toNumber()).toBe(180); // gap filled
  });

  it('returns no entries for days before the first known price', () => {
    const prices = new Map<string, Decimal>([['2021-06-15', d(100)]]);
    const filled = carryForwardPrices(prices, '2021-06-12', '2021-06-17');
    expect(filled.has('2021-06-12')).toBe(false);
    expect(filled.has('2021-06-13')).toBe(false);
    expect(filled.has('2021-06-14')).toBe(false);
    expect(filled.get('2021-06-15')?.toNumber()).toBe(100);
    expect(filled.get('2021-06-16')?.toNumber()).toBe(100);
  });
});

describe('computeTTWROR — demo portfolio (2-year period)', () => {
  /**
   * From ttwror.md:
   * HP1: MVB=177.94, MVE=160.26, no CF  → r = -9.94%
   * HP2: MVB=160.26, MVE=264.57, CFin=84 → r = 8.31%
   * HP3: MVB=264.57, MVE=426.82, CFin=67 → r = 28.73%
   * TTWROR = (0.9006 × 1.0831 × 1.2873) - 1 = 25.58%
   *
   * We model each HP as a single-day snapshot for simplicity.
   */
  it('computes 25.58% for 3-period portfolio example', () => {
    // 4 snapshots = 3 holding periods
    const snapshots = [
      { date: '2021-06-12', mve: d(177.94), cfIn: d(0), cfOut: d(0) },
      { date: '2022-01-13', mve: d(160.26), cfIn: d(0), cfOut: d(0) },    // end HP1
      { date: '2022-01-14', mve: d(264.57), cfIn: d(84), cfOut: d(0) },   // end HP2 (cfIn on this day)
      { date: '2022-09-30', mve: d(426.82), cfIn: d(67), cfOut: d(0) },   // end HP3
    ];
    const periodDays = 2 * 365; // 2-year period (approx)
    const result = computeTTWROR(snapshots, periodDays);
    expectClose(result.cumulative, 0.2558, 0.001);
  });

  it('individual HP returns match documentation', () => {
    // HP1: -9.94%
    const hp1 = computeTTWROR([
      { date: '2021-06-12', mve: d(177.94), cfIn: d(0), cfOut: d(0) },
      { date: '2022-01-13', mve: d(160.26), cfIn: d(0), cfOut: d(0) },
    ], 215);
    expectClose(hp1.dailyReturns[0].r, -0.0994, 0.001);

    // HP2: 8.31%
    const hp2 = computeTTWROR([
      { date: '2022-01-13', mve: d(160.26), cfIn: d(0), cfOut: d(0) },
      { date: '2022-09-29', mve: d(264.57), cfIn: d(84), cfOut: d(0) },
    ], 259);
    expectClose(hp2.dailyReturns[0].r, 0.0831, 0.001);

    // HP3: 28.73%
    const hp3 = computeTTWROR([
      { date: '2022-09-29', mve: d(264.57), cfIn: d(0), cfOut: d(0) },
      { date: '2022-06-12', mve: d(426.82), cfIn: d(67), cfOut: d(0) },
    ], 255);
    expectClose(hp3.dailyReturns[0].r, 0.2873, 0.001);
  });
});

describe('computeTTWROR — security share-2', () => {
  /**
   * From ttwror.md:
   * MVB=0, CFin=66 (buy cost incl. fees), MVE=111.76
   * TTWROR = 111.76/(0+66) - 1 = 69.33%
   */
  it('computes 69.33% for share-2 single holding period', () => {
    const snapshots = [
      { date: '2022-09-29', mve: d(0),      cfIn: d(0),  cfOut: d(0) },
      { date: '2023-06-12', mve: d(111.76), cfIn: d(66), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 256);
    expectClose(result.cumulative, 0.6933, 0.001);
  });
});

describe('computeTTWROR — cfIn/cfOut sign convention', () => {
  /**
   * Simple 5-day example:
   * Day 0: MV=100
   * Day 1: MV=101 (no CF) → r = 1/100 = 1%
   * Day 2: MV=110, CFin=9 → r = 110/(101+9)-1 = 0% (deposit neutralized, 0 market gain)
   * Day 3: MV=111.1 (no CF) → r = 111.1/110 = 1%
   * Day 4: MV=120, CFin=8.9 → r = 120/(111.1+8.9)-1 = 0%
   * TTWROR = (1.01)*(1.00)*(1.01)*(1.00) - 1 = 2.01%
   */
  it('deposits are neutralized in TTWROR computation', () => {
    const snapshots = [
      { date: '2024-01-01', mve: d(100),  cfIn: d(0),   cfOut: d(0) },
      { date: '2024-01-02', mve: d(101),  cfIn: d(0),   cfOut: d(0) },
      { date: '2024-01-03', mve: d(110),  cfIn: d(9),   cfOut: d(0) },
      { date: '2024-01-04', mve: d(111.1),cfIn: d(0),   cfOut: d(0) },
      { date: '2024-01-05', mve: d(120),  cfIn: d(8.9), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 4);
    expectClose(result.cumulative, 0.0201, 0.0001);
  });

  it('outflow (sell) at end of day is neutralized', () => {
    // Day 0: MV=100
    // Day 1: MV=90, CFout=10 (sold 10 at end of day) → r = (90+10)/100 - 1 = 0%
    // Day 2: MV=91, no CF → r = 91/90 ≈ 1.11%
    const snapshots = [
      { date: '2024-01-01', mve: d(100), cfIn: d(0),  cfOut: d(0)  },
      { date: '2024-01-02', mve: d(90),  cfIn: d(0),  cfOut: d(10) },
      { date: '2024-01-03', mve: d(91),  cfIn: d(0),  cfOut: d(0)  },
    ];
    const result = computeTTWROR(snapshots, 2);
    // (100/100) * (91/90) - 1 = 1/90 ≈ 1.111%
    expectClose(result.cumulative, 1 / 90, 0.0001);
  });
});

describe('computeTTWROR — edge cases', () => {
  it('MVB + CFin = 0 → daily factor = 1 (neutral)', () => {
    const snapshots = [
      { date: '2024-01-01', mve: d(0), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-02', mve: d(0), cfIn: d(0), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 1);
    expect(result.cumulative.toNumber()).toBe(0);
    expect(result.dailyReturns[0].r.toNumber()).toBe(0);
  });

  it('no cashflows → TTWROR equals pure market appreciation', () => {
    // 100 → 110 → 99 — pure price changes, no deposits/withdrawals
    const snapshots = [
      { date: '2024-01-01', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-02', mve: d(110), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-03', mve: d(99),  cfIn: d(0), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 2);
    // (110/100) * (99/110) - 1 = 0.99 - 1 = -1%
    expectClose(result.cumulative, -0.01, 0.0001);
  });
});

describe('buildDailySnapshots', () => {
  it('assigns positive cashflows to cfIn and negative to cfOut', () => {
    const cashflows: Cashflow[] = [
      cf('2024-01-02', 50),   // deposit → cfIn
      cf('2024-01-03', -20),  // withdrawal → cfOut
    ];
    const mv = new Map([
      ['2024-01-01', d(100)],
      ['2024-01-02', d(150)],
      ['2024-01-03', d(130)],
    ]);
    const snaps = buildDailySnapshots(cashflows, mv, { start: '2024-01-01', end: '2024-01-03' });
    expect(snaps[0].cfIn.toNumber()).toBe(0);
    expect(snaps[1].cfIn.toNumber()).toBe(50);
    expect(snaps[1].cfOut.toNumber()).toBe(0);
    expect(snaps[2].cfIn.toNumber()).toBe(0);
    expect(snaps[2].cfOut.toNumber()).toBe(20); // stored as positive
  });
});

describe('buildDailySnapshotsWithCarry', () => {
  it('fills MV gaps before building snapshots', () => {
    const cashflows: Cashflow[] = [];
    const mv = new Map([
      ['2024-01-01', d(100)],
      // 2024-01-02 missing
      ['2024-01-03', d(110)],
    ]);
    const snaps = buildDailySnapshotsWithCarry(cashflows, mv, { start: '2024-01-01', end: '2024-01-03' });
    expect(snaps[1].mve.toNumber()).toBe(100); // gap filled with carry-forward
    expect(snaps[2].mve.toNumber()).toBe(110);
  });
});
