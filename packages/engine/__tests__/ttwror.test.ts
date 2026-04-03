import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  carryForwardPrices,
  buildDailySnapshots,
  buildDailySnapshotsWithCarry,
  computeTTWROR,
  DailySnapshot,
} from '../src/performance/ttwror';
import { Cashflow } from '@quovibe/shared';
import { TransactionType } from '@quovibe/shared';

const d = (n: number) => new Decimal(n);

// ─── carryForwardPrices ────────────────────────────────────────────────────

describe('carryForwardPrices', () => {
  test('fills missing day with last known price', () => {
    const prices = new Map([
      ['2024-01-01', d(100)],
      ['2024-01-03', d(102)], // gap: 2024-01-02 missing
    ]);
    const filled = carryForwardPrices(prices, '2024-01-01', '2024-01-03');
    expect(filled.get('2024-01-02')!.toNumber()).toBe(100);
    expect(filled.get('2024-01-03')!.toNumber()).toBe(102);
  });

  test('weekend gap: Friday price carries through Saturday and Sunday', () => {
    // Friday Jan 5 → Sat/Sun Jan 6-7 → Monday Jan 8
    const prices = new Map([
      ['2024-01-05', d(50)],
      ['2024-01-08', d(52)],
    ]);
    const filled = carryForwardPrices(prices, '2024-01-05', '2024-01-08');
    expect(filled.get('2024-01-06')!.toNumber()).toBe(50);
    expect(filled.get('2024-01-07')!.toNumber()).toBe(50);
    expect(filled.get('2024-01-08')!.toNumber()).toBe(52);
  });

  test('days before first known price produce no entry', () => {
    const prices = new Map([['2024-01-03', d(100)]]);
    const filled = carryForwardPrices(prices, '2024-01-01', '2024-01-03');
    expect(filled.has('2024-01-01')).toBe(false);
    expect(filled.has('2024-01-02')).toBe(false);
    expect(filled.get('2024-01-03')!.toNumber()).toBe(100);
  });

  test('single day period with known price', () => {
    const prices = new Map([['2024-06-15', d(42)]]);
    const filled = carryForwardPrices(prices, '2024-06-15', '2024-06-15');
    expect(filled.get('2024-06-15')!.toNumber()).toBe(42);
  });

  test('multiple gaps in a row', () => {
    const prices = new Map([
      ['2024-01-01', d(10)],
      ['2024-01-05', d(15)],
    ]);
    const filled = carryForwardPrices(prices, '2024-01-01', '2024-01-05');
    expect(filled.get('2024-01-02')!.toNumber()).toBe(10);
    expect(filled.get('2024-01-03')!.toNumber()).toBe(10);
    expect(filled.get('2024-01-04')!.toNumber()).toBe(10);
    expect(filled.get('2024-01-05')!.toNumber()).toBe(15);
  });
});

// ─── buildDailySnapshots ──────────────────────────────────────────────────

describe('buildDailySnapshots', () => {
  test('splits signed cashflows into cfIn and cfOut correctly', () => {
    const cashflows: Cashflow[] = [
      { date: '2024-01-02', amount: d(100), type: TransactionType.DEPOSIT },
      { date: '2024-01-03', amount: d(-50), type: TransactionType.REMOVAL },
    ];
    const mv = new Map([
      ['2024-01-01', d(200)],
      ['2024-01-02', d(310)],
      ['2024-01-03', d(265)],
    ]);
    const snapshots = buildDailySnapshots(cashflows, mv, {
      start: '2024-01-01',
      end: '2024-01-03',
    });

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].cfIn.toNumber()).toBe(0);
    expect(snapshots[0].cfOut.toNumber()).toBe(0);
    expect(snapshots[1].cfIn.toNumber()).toBe(100);
    expect(snapshots[1].cfOut.toNumber()).toBe(0);
    expect(snapshots[2].cfIn.toNumber()).toBe(0);
    expect(snapshots[2].cfOut.toNumber()).toBe(50);
  });

  test('day with no market value entry defaults to mve=0', () => {
    const cashflows: Cashflow[] = [];
    const mv = new Map<string, Decimal>(); // empty
    const snapshots = buildDailySnapshots(cashflows, mv, {
      start: '2024-01-01',
      end: '2024-01-01',
    });
    expect(snapshots[0].mve.toNumber()).toBe(0);
  });
});

// ─── buildDailySnapshotsWithCarry ─────────────────────────────────────────

describe('buildDailySnapshotsWithCarry', () => {
  test('carries forward market value into gap days', () => {
    const cashflows: Cashflow[] = [];
    const rawMV = new Map([
      ['2024-01-01', d(100)],
      ['2024-01-03', d(105)],
    ]);
    const snapshots = buildDailySnapshotsWithCarry(cashflows, rawMV, {
      start: '2024-01-01',
      end: '2024-01-03',
    });
    expect(snapshots[1].mve.toNumber()).toBe(100); // gap day carries 100
    expect(snapshots[2].mve.toNumber()).toBe(105);
  });
});

// ─── computeTTWROR ────────────────────────────────────────────────────────

describe('computeTTWROR', () => {
  /**
   * Demo portfolio 03 — 2-year reporting period (portfolio level)
   *
   * From TTWROR reference:
   *   HP1: r = -9.94%  (MVB=177.94 → MVE=160.26, no CF)
   *   HP2: r = +8.31%  (CFin=84, MVE=264.57)
   *   HP3: r = +28.73% (CFin=67, MVE=426.82)
   *
   * TTWROR = (0.9006 × 1.0831 × 1.2873) - 1 ≈ 25.58%
   */
  test('demo-portfolio-03 — 2-year period TTWROR ≈ 25.58%', () => {
    const snapshots: DailySnapshot[] = [
      { date: '2021-06-12', mve: d(177.94), cfIn: d(0), cfOut: d(0) },
      { date: '2022-01-13', mve: d(160.26), cfIn: d(0), cfOut: d(0) },
      { date: '2022-01-14', mve: d(264.57), cfIn: d(84), cfOut: d(0) },
      { date: '2023-06-12', mve: d(426.82), cfIn: d(67), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 730);
    expect(result.cumulative.toNumber()).toBeCloseTo(0.2558, 3);
  });

  /**
   * TTWROR security-level — share-1 from system-overview-example (architecture §13)
   *
   * March 1: MVB=0, MVE=100, CFin=103 (buy 100 gross + 3 fees)
   *   r = (100 + 0) / (0 + 103) - 1 = -0.0291
   * March 2-3: no CF, MVE unchanged → r = 0
   * March 4: MVE=110, CFout=13 (dividend 15 - 2 taxes)
   *   r = (110 + 13) / (100 + 0) - 1 = 0.23
   * March 5: MVE=60, CFout=55 (sell 60 gross - 5 fees)
   *   r = (60 + 55) / (110 + 0) - 1 = 0.0455
   *
   * Cumulative ≈ 24.85%
   */
  test('security-level share-1 with buy/dividend/sell ≈ 24.85%', () => {
    const snapshots: DailySnapshot[] = [
      { date: '2024-02-29', mve: d(0), cfIn: d(0), cfOut: d(0) },
      { date: '2024-03-01', mve: d(100), cfIn: d(103), cfOut: d(0) },
      { date: '2024-03-02', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-03-03', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-03-04', mve: d(110), cfIn: d(0), cfOut: d(13) },
      { date: '2024-03-05', mve: d(60), cfIn: d(0), cfOut: d(55) },
    ];
    const result = computeTTWROR(snapshots, 5);
    expect(result.cumulative.toNumber()).toBeCloseTo(0.2485, 2);
  });

  test('no cashflows — equals simple return', () => {
    const snapshots: DailySnapshot[] = [
      { date: '2024-01-01', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-31', mve: d(110), cfIn: d(0), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 30);
    // Simple return: 110/100 - 1 = 10%
    expect(result.cumulative.toNumber()).toBeCloseTo(0.1, 5);
  });

  test('zero denominator produces dailyReturn=0 (no crash)', () => {
    const snapshots: DailySnapshot[] = [
      { date: '2024-01-01', mve: d(0), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-02', mve: d(100), cfIn: d(0), cfOut: d(0) },
    ];
    expect(() => computeTTWROR(snapshots, 1)).not.toThrow();
    const result = computeTTWROR(snapshots, 1);
    expect(isFinite(result.cumulative.toNumber())).toBe(true);
  });

  test('annualisation: 30% over 730 days → ≈ 14.02% p.a.', () => {
    // (1.3)^(365/730) - 1 = sqrt(1.3) - 1 ≈ 14.02%
    const snapshots: DailySnapshot[] = [
      { date: '2022-01-01', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-01', mve: d(130), cfIn: d(0), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 730);
    expect(result.cumulative.toNumber()).toBeCloseTo(0.3, 4);
    expect(result.annualized.toNumber()).toBeCloseTo(0.1402, 3);
  });

  test('single snapshot (no periods) returns 0', () => {
    const snapshots: DailySnapshot[] = [
      { date: '2024-01-01', mve: d(100), cfIn: d(0), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 1);
    expect(result.cumulative.toNumber()).toBe(0);
    expect(result.dailyReturns).toHaveLength(0);
  });

  test('gap day with carried price produces r=0 (no market movement)', () => {
    // Two days with same market value, no cashflows → r = 0
    const snapshots: DailySnapshot[] = [
      { date: '2024-01-05', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-06', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-07', mve: d(100), cfIn: d(0), cfOut: d(0) },
      { date: '2024-01-08', mve: d(105), cfIn: d(0), cfOut: d(0) },
    ];
    const result = computeTTWROR(snapshots, 3);
    expect(result.dailyReturns[0].r.toNumber()).toBeCloseTo(0, 8);
    expect(result.dailyReturns[1].r.toNumber()).toBeCloseTo(0, 8);
    expect(result.cumulative.toNumber()).toBeCloseTo(0.05, 4);
  });
});
