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

  it('handles the Daimler edge case — prices start mid-period', () => {
    // Period: Jan 1-5, prices start Jan 3. Portfolio cum on Jan 2 = 1%
    // Benchmark adopts portfolio cum (1%) at first price day, then compounds own returns
    // Jan 4: 1.01 * (52/50) = 1.0504 → 5.04%
    // Jan 5: 1.0504 * (51/52) ≈ 1.03019 → 3.02%
    const input: BenchmarkInput = {
      prices: [
        { date: '2024-01-03', value: d(50) },
        { date: '2024-01-04', value: d(52) },
        { date: '2024-01-05', value: d(51) },
      ],
      periodStart: '2024-01-01',
      periodEnd: '2024-01-05',
      portfolioCumulativeSeries: [
        { date: '2024-01-01', ttwrorCumulative: d(0) },
        { date: '2024-01-02', ttwrorCumulative: d(0.01) },
        { date: '2024-01-03', ttwrorCumulative: d(0.02) },
        { date: '2024-01-04', ttwrorCumulative: d(0.03) },
        { date: '2024-01-05', ttwrorCumulative: d(0.04) },
      ],
    };
    const series = computeBenchmarkSeries(input);
    expect(series).toHaveLength(5);
    expectClose(series[0].cumulative.toNumber(), 0);
    expectClose(series[1].cumulative.toNumber(), 0.01);
    expectClose(series[2].cumulative.toNumber(), 0.01);
    expectClose(series[3].cumulative.toNumber(), 0.0504);
    expectClose(series[4].cumulative.toNumber(), 0.03019, 0.001);
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
