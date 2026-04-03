import { describe, test, expect } from 'vitest';
import { computeATH } from '../api/use-ath';

describe('computeATH', () => {
  test('returns the max marketValue and its date', () => {
    const points = [
      { date: '2024-01-01', marketValue: '10000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
      { date: '2024-06-15', marketValue: '15000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
      { date: '2024-12-31', marketValue: '12000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
    ];
    const result = computeATH(points);
    expect(result.athValue).toBe('15000');
    expect(result.athDate).toBe('2024-06-15');
  });

  test('returns zeros when array is empty', () => {
    const result = computeATH([]);
    expect(result.athValue).toBe('0');
    expect(result.athDate).toBeNull();
  });

  test('returns zeros when all marketValues are zero (pre-first-buy period)', () => {
    const points = [
      { date: '2024-01-01', marketValue: '0', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
      { date: '2024-01-02', marketValue: '0', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
    ];
    const result = computeATH(points);
    expect(result.athValue).toBe('0');
    expect(result.athDate).toBeNull();
  });

  test('handles Decimal precision — does not use native float arithmetic', () => {
    const points = [
      { date: '2024-01-01', marketValue: '99999.999', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
      { date: '2024-06-01', marketValue: '100000.001', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
    ];
    const result = computeATH(points);
    expect(result.athValue).toBe('100000.001');
    expect(result.athDate).toBe('2024-06-01');
  });

  test('picks the first occurrence when two days tie for ATH', () => {
    const points = [
      { date: '2024-01-01', marketValue: '15000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
      { date: '2024-06-01', marketValue: '15000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
    ];
    const result = computeATH(points);
    expect(result.athValue).toBe('15000');
    expect(result.athDate).toBe('2024-01-01');
  });

  test('handles single data point', () => {
    const points = [
      { date: '2024-03-15', marketValue: '50000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
    ];
    const result = computeATH(points);
    expect(result.athValue).toBe('50000');
    expect(result.athDate).toBe('2024-03-15');
  });

  test('returns the least-negative day when all values are negative', () => {
    const points = [
      { date: '2024-01-01', marketValue: '-5000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
      { date: '2024-06-01', marketValue: '-3000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
      { date: '2024-12-31', marketValue: '-8000', transfersAccumulated: '0', ttwrorCumulative: '0', delta: '0', drawdown: '0' },
    ];
    const result = computeATH(points);
    expect(result.athValue).toBe('-3000');
    expect(result.athDate).toBe('2024-06-01');
  });
});
