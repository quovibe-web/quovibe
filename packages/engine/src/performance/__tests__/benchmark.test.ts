// Reference: Benchmarking your portfolio — benchmark cumulative return series
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeBenchmarkSeries } from '../benchmark';
import type { BenchmarkInput } from '../benchmark';

const d = (v: number | string) => new Decimal(v);

function expectClose(actual: number, expected: number, tol = 0.0001) {
  expect(actual).toBeCloseTo(expected, Math.round(-Math.log10(tol)));
}

describe('computeBenchmarkSeries', () => {
  it('computes cumulative returns from period start (common case)', () => {
    // Prices: 100, 102, 101, 105 over 4 days
    // Cumulative: (1.02)*(101/102)*(105/101)-1 = (105/100)-1 = 0.05
    const input: BenchmarkInput = {
      prices: [
        { date: '2024-01-01', value: d(100) },
        { date: '2024-01-02', value: d(102) },
        { date: '2024-01-03', value: d(101) },
        { date: '2024-01-04', value: d(105) },
      ],
      periodStart: '2024-01-01',
      periodEnd: '2024-01-04',
    };
    const series = computeBenchmarkSeries(input);
    expect(series).toHaveLength(4);
    expectClose(series[0].cumulative.toNumber(), 0);
    expectClose(series[1].cumulative.toNumber(), 0.02);
    expectClose(series[2].cumulative.toNumber(), 0.01);
    expectClose(series[3].cumulative.toNumber(), 0.05);
  });

  it('truncates series when prices start mid-period', () => {
    // Period: Jan 1-5, prices start Jan 3. Series should start at Jan 3 with 0%.
    // Jan 4: (52/50) - 1 = 4%
    // Jan 5: (52/50)*(51/52) - 1 = (51/50) - 1 = 2%
    const input: BenchmarkInput = {
      prices: [
        { date: '2024-01-03', value: d(50) },
        { date: '2024-01-04', value: d(52) },
        { date: '2024-01-05', value: d(51) },
      ],
      periodStart: '2024-01-01',
      periodEnd: '2024-01-05',
    };
    const series = computeBenchmarkSeries(input);
    // Only 3 points: Jan 3, 4, 5 (Jan 1-2 are truncated)
    expect(series).toHaveLength(3);
    expect(series[0].date).toBe('2024-01-03');
    expectClose(series[0].cumulative.toNumber(), 0);
    expectClose(series[1].cumulative.toNumber(), 0.04);
    expectClose(series[2].cumulative.toNumber(), 0.02);
  });

  it('carries prices forward across weekend gaps', () => {
    const input: BenchmarkInput = {
      prices: [
        { date: '2024-01-05', value: d(100) },
        { date: '2024-01-08', value: d(103) },
      ],
      periodStart: '2024-01-05',
      periodEnd: '2024-01-08',
    };
    const series = computeBenchmarkSeries(input);
    expect(series).toHaveLength(4);
    expectClose(series[0].cumulative.toNumber(), 0);
    expectClose(series[1].cumulative.toNumber(), 0);
    expectClose(series[2].cumulative.toNumber(), 0);
    expectClose(series[3].cumulative.toNumber(), 0.03);
  });

  it('returns single point at 0% for single-day period', () => {
    const input: BenchmarkInput = {
      prices: [{ date: '2024-01-01', value: d(100) }],
      periodStart: '2024-01-01',
      periodEnd: '2024-01-01',
    };
    const series = computeBenchmarkSeries(input);
    expect(series).toHaveLength(1);
    expectClose(series[0].cumulative.toNumber(), 0);
  });

  it('returns empty series when no prices provided', () => {
    const input: BenchmarkInput = {
      prices: [],
      periodStart: '2024-01-01',
      periodEnd: '2024-01-05',
    };
    const series = computeBenchmarkSeries(input);
    expect(series).toHaveLength(0);
  });

  it('returns flat 0% line when all prices are before period', () => {
    const input: BenchmarkInput = {
      prices: [{ date: '2023-12-29', value: d(100) }],
      periodStart: '2024-01-01',
      periodEnd: '2024-01-03',
    };
    const series = computeBenchmarkSeries(input);
    expect(series).toHaveLength(3);
    expectClose(series[0].cumulative.toNumber(), 0);
    expectClose(series[1].cumulative.toNumber(), 0);
    expectClose(series[2].cumulative.toNumber(), 0);
  });
});
