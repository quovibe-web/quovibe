import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeIRR } from '../src/performance/irr';

const d = (n: number) => new Decimal(n);

describe('computeIRR', () => {
  /**
   * Standard portfolio case: deposit 10 000, value 10 823 after ~1 year
   * Expected IRR ≈ 8.23%
   */
  test('standard deposit → IRR ≈ 8.23%', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(10823),
      cashflows: [{ date: '2024-01-01', amount: d(10000) }],
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
    });
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0.0823, 2);
  });

  /**
   * IRR Example 1 (portfolio level, 2-year period, MVB > 0):
   *   177.94 × (1+IRR)^(730/365) + 84×(1+IRR)^(514/365) + 67×(1+IRR)^(255/365) = 426.82
   *   IRR ≈ 17.63%
   */
  test('example 4 — MVB > 0, 2-year period → IRR ≈ 17.63%', () => {
    const result = computeIRR({
      mvb: d(177.94),
      mve: d(426.82),
      cashflows: [
        { date: '2022-01-14', amount: d(84) },
        { date: '2022-09-30', amount: d(67) },
      ],
      periodStart: '2021-06-12',
      periodEnd: '2023-06-12',
    });
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0.1763, 2);
  });

  /**
   * IRR Example 6 (security level, multiple transactions, pre-tax):
   *   CF1 (buy):      +153  = 10×15 + 3 fees
   *   CF2 (buy):       +83  = 5×16 + 3 fees
   *   CF3 (dividend):  -30
   *   CF4 (sell):     -107  = -(5×22.4 − 5 fees)
   *   MVB = 0, MVE = 190.06
   *   IRR ≈ 18%
   */
  test('example 6 — security-level with buy/dividend/sell → IRR ≈ 18%', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(190.06),
      cashflows: [
        { date: '2021-01-15', amount: d(153) },
        { date: '2022-01-14', amount: d(83) },
        { date: '2022-12-15', amount: d(-30) },
        { date: '2023-04-12', amount: d(-107) },
      ],
      periodStart: '2020-06-12',
      periodEnd: '2023-06-12',
    });
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0.18, 1);
  });

  /**
   * IRR Example 5 (share-2, one buy, 3-year period):
   *   66 × (1+IRR)^(255/365) = 111.76
   *   IRR ≈ 112.53%
   */
  test('example 5 — share-2 one buy → IRR ≈ 112.53%', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(111.76),
      cashflows: [{ date: '2022-09-30', amount: d(66) }],
      periodStart: '2020-06-12',
      periodEnd: '2023-06-12',
    });
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(1.1253, 1);
  });

  /**
   * Degenerate case: MVB=0, MVE=0, no cashflows.
   * The function must not throw. It may return null or Decimal(0).
   */
  test('degenerate case (MVB=0, MVE=0, no CFs) — returns null or Decimal', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(0),
      cashflows: [],
      periodStart: '2024-01-01',
      periodEnd: '2024-01-02',
    });
    expect(result === null || result instanceof Decimal).toBe(true);
  });

  /**
   * Zero-day period returns Decimal(0) immediately.
   */
  test('zero-day period → Decimal(0)', () => {
    const result = computeIRR({
      mvb: d(100),
      mve: d(100),
      cashflows: [],
      periodStart: '2024-06-01',
      periodEnd: '2024-06-01',
    });
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBe(0);
  });

  /**
   * IRR = 0 when only a deposit and its exact amount as MVE (no return).
   */
  test('no-return scenario — IRR = 0', () => {
    const result = computeIRR({
      mvb: d(0),
      mve: d(1000),
      cashflows: [{ date: '2024-01-01', amount: d(1000) }],
      periodStart: '2024-01-01',
      periodEnd: '2024-12-31',
    });
    expect(result).not.toBeNull();
    expect(result!.toNumber()).toBeCloseTo(0, 3);
  });

  /**
   * Result is always finite (no NaN, no Infinity, no exception).
   */
  test('result is always finite or null', () => {
    const result = computeIRR({
      mvb: d(50000),
      mve: d(60000),
      cashflows: [
        { date: '2023-03-01', amount: d(5000) },
        { date: '2023-09-01', amount: d(-2000) },
      ],
      periodStart: '2023-01-01',
      periodEnd: '2024-01-01',
    });
    if (result !== null) {
      expect(isFinite(result.toNumber())).toBe(true);
    }
  });
});
