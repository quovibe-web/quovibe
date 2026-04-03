import { describe, it, expect } from 'vitest';
import { computeDragMetrics } from '../drag-utils';

describe('computeDragMetrics', () => {
  it('computes drag metrics for normal gain period', () => {
    const result = computeDragMetrics({
      fees: 342,
      taxes: 1247,
      initialValue: 58000,
      finalValue: 66500,
      periodDays: 90,
    });

    // grossReturn = (66500 - 58000) + 342 + 1247 = 10089
    expect(result.grossReturn).toBeCloseTo(10089, 0);
    expect(result.feeGainsPct).toBeCloseTo(0.03390, 4);
    expect(result.taxGainsPct).toBeCloseTo(0.12359, 4);
    expect(result.totalGainsPct).toBeCloseTo(0.15749, 4);
    // avgPortfolioValue = 62250, feeExpenseRatio = (342/62250)*(365/90)
    expect(result.feeExpenseRatio).toBeCloseTo(0.02228, 4);
    expect(result.taxExpenseRatio).toBeCloseTo(0.08124, 4);
    expect(result.gainsAvailable).toBe(true);
    expect(result.shortPeriodWarning).toBe(false);
  });

  it('returns gainsAvailable=false when gross return <= 0 (loss period)', () => {
    const result = computeDragMetrics({
      fees: 100,
      taxes: 50,
      initialValue: 60000,
      finalValue: 55000,
      periodDays: 90,
    });

    expect(result.gainsAvailable).toBe(false);
    expect(result.feeGainsPct).toBeNull();
    expect(result.taxGainsPct).toBeNull();
    expect(result.totalGainsPct).toBeNull();
    expect(result.feeExpenseRatio).toBeGreaterThan(0);
    expect(result.taxExpenseRatio).toBeGreaterThan(0);
  });

  it('returns all zeros for empty portfolio', () => {
    const result = computeDragMetrics({
      fees: 0,
      taxes: 0,
      initialValue: 0,
      finalValue: 0,
      periodDays: 90,
    });

    expect(result.gainsAvailable).toBe(false);
    expect(result.feeExpenseRatio).toBe(0);
    expect(result.taxExpenseRatio).toBe(0);
  });

  it('warns for short periods (< 30 days)', () => {
    const result = computeDragMetrics({
      fees: 10,
      taxes: 5,
      initialValue: 10000,
      finalValue: 10500,
      periodDays: 7,
    });

    expect(result.shortPeriodWarning).toBe(true);
    expect(result.feeExpenseRatio).toBeGreaterThan(0);
  });

  it('handles preTax mode (taxes = 0)', () => {
    const result = computeDragMetrics({
      fees: 200,
      taxes: 0,
      initialValue: 50000,
      finalValue: 55000,
      periodDays: 365,
    });

    expect(result.taxGainsPct).toBeCloseTo(0, 5);
    expect(result.taxExpenseRatio).toBeCloseTo(0, 5);
    expect(result.feeGainsPct).toBeGreaterThan(0);
  });
});
