// Reference: Monthly return aggregation — compound annual return from monthly periods
// yearly return = product(1 + monthReturn_j) - 1 (compounding equation)
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { aggregateMonthlyReturns } from '../monthly-returns';

describe('aggregateMonthlyReturns', () => {
  it('returns empty result for empty input', () => {
    const result = aggregateMonthlyReturns([]);
    expect(result.monthly).toHaveLength(0);
    expect(result.yearly).toHaveLength(0);
  });

  it('compounds daily returns within a single month', () => {
    // +1% each day for 3 days in Jan 2024
    const dailyReturns = [
      { date: '2024-01-02', r: new Decimal('0.01') },
      { date: '2024-01-03', r: new Decimal('0.01') },
      { date: '2024-01-04', r: new Decimal('0.01') },
    ];
    const result = aggregateMonthlyReturns(dailyReturns);

    expect(result.monthly).toHaveLength(1);
    const jan = result.monthly[0];
    expect(jan.year).toBe(2024);
    expect(jan.month).toBe(1);
    // (1.01)^3 - 1 = 0.030301
    expect(jan.value.toFixed(6)).toBe('0.030301');

    expect(result.yearly).toHaveLength(1);
    expect(result.yearly[0].year).toBe(2024);
    expect(result.yearly[0].value.toFixed(6)).toBe('0.030301');
  });

  it('handles months spanning two years correctly', () => {
    const dailyReturns = [
      { date: '2023-12-29', r: new Decimal('0.02') },
      { date: '2024-01-02', r: new Decimal('0.03') },
    ];
    const result = aggregateMonthlyReturns(dailyReturns);

    expect(result.monthly).toHaveLength(2);
    expect(result.monthly[0]).toMatchObject({ year: 2023, month: 12 });
    expect(result.monthly[1]).toMatchObject({ year: 2024, month: 1 });

    expect(result.yearly).toHaveLength(2);
    expect(result.yearly[0].year).toBe(2023);
    expect(result.yearly[1].year).toBe(2024);

    // 2023 yearly = Dec monthly = 0.02
    expect(result.yearly[0].value.toFixed(4)).toBe('0.0200');
    // 2024 yearly = Jan monthly = 0.03
    expect(result.yearly[1].value.toFixed(4)).toBe('0.0300');
  });

  it('compounds monthly returns across the year', () => {
    // Jan: +10%, Feb: -5% => yearly = (1.1)(0.95) - 1 = 0.045
    const dailyReturns = [
      { date: '2024-01-15', r: new Decimal('0.10') },
      { date: '2024-02-15', r: new Decimal('-0.05') },
    ];
    const result = aggregateMonthlyReturns(dailyReturns);

    expect(result.monthly).toHaveLength(2);
    expect(result.yearly[0].value.toFixed(4)).toBe('0.0450');
  });

  it('returns monthly entries sorted by year and month', () => {
    const dailyReturns = [
      { date: '2024-03-10', r: new Decimal('0.01') },
      { date: '2024-01-10', r: new Decimal('0.02') },
      { date: '2024-02-10', r: new Decimal('0.03') },
    ];
    const result = aggregateMonthlyReturns(dailyReturns);
    const months = result.monthly.map((m) => m.month);
    expect(months).toEqual([1, 2, 3]);
  });
});
