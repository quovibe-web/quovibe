// Reference: Periodic return aggregation — compound daily TTWROR returns within period buckets (daily/weekly/monthly/quarterly/yearly)
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { aggregatePeriodicReturns } from '../periodic-returns';

describe('aggregatePeriodicReturns', () => {
  it('returns empty array for empty input', () => {
    const result = aggregatePeriodicReturns([], 'monthly');
    expect(result).toHaveLength(0);
  });

  it('daily interval returns one entry per day', () => {
    const daily = [
      { date: '2024-01-02', r: new Decimal('0.01') },
      { date: '2024-01-03', r: new Decimal('-0.005') },
      { date: '2024-01-04', r: new Decimal('0.02') },
    ];
    const result = aggregatePeriodicReturns(daily, 'daily');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: '2024-01-02', return: '0.01' });
    expect(result[1]).toEqual({ date: '2024-01-03', return: '-0.005' });
    expect(result[2]).toEqual({ date: '2024-01-04', return: '0.02' });
  });

  it('monthly interval compounds daily returns within a month', () => {
    const daily = [
      { date: '2024-01-02', r: new Decimal('0.01') },
      { date: '2024-01-03', r: new Decimal('0.01') },
      { date: '2024-01-04', r: new Decimal('0.01') },
    ];
    const result = aggregatePeriodicReturns(daily, 'monthly');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2024-01-04');
    expect(new Decimal(result[0].return).toFixed(6)).toBe('0.030301');
  });

  it('weekly interval compounds daily returns within ISO week', () => {
    const daily = [
      { date: '2024-01-01', r: new Decimal('0.01') },
      { date: '2024-01-02', r: new Decimal('0.02') },
      { date: '2024-01-03', r: new Decimal('-0.005') },
      { date: '2024-01-04', r: new Decimal('0.015') },
      { date: '2024-01-05', r: new Decimal('0.008') },
    ];
    const result = aggregatePeriodicReturns(daily, 'weekly');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2024-01-05');
    const expected = new Decimal('1.01').times('1.02').times('0.995')
      .times('1.015').times('1.008').minus(1);
    expect(new Decimal(result[0].return).toFixed(10)).toBe(expected.toFixed(10));
  });

  it('quarterly interval compounds across 3 months', () => {
    const daily = [
      { date: '2024-01-15', r: new Decimal('0.10') },
      { date: '2024-02-15', r: new Decimal('-0.05') },
      { date: '2024-03-15', r: new Decimal('0.03') },
    ];
    const result = aggregatePeriodicReturns(daily, 'quarterly');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2024-03-15');
    const expected = new Decimal('1.10').times('0.95').times('1.03').minus(1);
    expect(new Decimal(result[0].return).toFixed(5)).toBe(expected.toFixed(5));
  });

  it('yearly interval compounds across the full year', () => {
    const daily = [
      { date: '2024-01-15', r: new Decimal('0.10') },
      { date: '2024-02-15', r: new Decimal('-0.05') },
    ];
    const result = aggregatePeriodicReturns(daily, 'yearly');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2024-02-15');
    expect(new Decimal(result[0].return).toFixed(4)).toBe('0.0450');
  });

  it('handles multiple buckets across years', () => {
    const daily = [
      { date: '2023-12-29', r: new Decimal('0.02') },
      { date: '2024-01-02', r: new Decimal('0.03') },
    ];
    const result = aggregatePeriodicReturns(daily, 'monthly');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: '2023-12-29', return: '0.02' });
    expect(result[1]).toEqual({ date: '2024-01-02', return: '0.03' });
  });

  it('sorts results chronologically', () => {
    const daily = [
      { date: '2024-03-10', r: new Decimal('0.01') },
      { date: '2024-01-10', r: new Decimal('0.02') },
      { date: '2024-02-10', r: new Decimal('0.03') },
    ];
    const result = aggregatePeriodicReturns(daily, 'monthly');
    const dates = result.map((r) => r.date);
    expect(dates).toEqual(['2024-01-10', '2024-02-10', '2024-03-10']);
  });
});
