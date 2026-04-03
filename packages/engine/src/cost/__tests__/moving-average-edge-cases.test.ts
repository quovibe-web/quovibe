// Reference: Moving average cost basis — weighted average recalculated on each buy
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeMovingAverage } from '../moving-average';
import type { CostTransaction } from '../types';

// Moving Average edge cases: requires positive shares for BUY.
// SELL must not exceed available shares.

describe('computeMovingAverage — edge cases: zero shares', () => {
  test('BUY with zero shares throws descriptive error', () => {
    const txs: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-01-10',
        shares: new Decimal(0),
        grossAmount: new Decimal('1000'),
        fees: new Decimal('10'),
      },
    ];
    expect(() => computeMovingAverage(txs)).toThrow(/BUY transaction must have positive shares/);
  });

  test('SELL exceeding available shares throws descriptive error', () => {
    const txs: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-01-05',
        shares: new Decimal('10'),
        grossAmount: new Decimal('950'),
        fees: new Decimal('0'),
      },
      {
        type: 'SELL',
        date: '2024-01-10',
        shares: new Decimal('15'),
        grossAmount: new Decimal('1500'),
        fees: new Decimal('0'),
      },
    ];
    expect(() => computeMovingAverage(txs)).toThrow(/Sold more shares than available/);
  });
});

// Moving Average Example 1:
// BUY 100@95, BUY 200@105, SELL 150@110
// Moving average cost = (100×95 + 200×105) / 300 = 30500 / 300 = 101.6667
// Realized gain = 150 × (110 − 101.6667) = 150 × 8.3333 = 1250.00
// NOTE: With zero fees, grossAmount = shares × price, so the example
// uses: buy 100 shares for 9500, buy 200 shares for 21000, sell 150 for 16500
// avgCost = 30500/300 = 101.6667, gain = 16500 − 150×101.6667 = 16500 − 15250 = 1250

describe('computeMovingAverage — cost methodology Example 1 regression', () => {
  test('buy 100@95, buy 200@105, sell 150@110 → realized gain = 1250', () => {
    const txs: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-01-05',
        shares: new Decimal('100'),
        grossAmount: new Decimal('9500'),
        fees: new Decimal('0'),
      },
      {
        type: 'BUY',
        date: '2024-01-10',
        shares: new Decimal('200'),
        grossAmount: new Decimal('21000'),
        fees: new Decimal('0'),
      },
      {
        type: 'SELL',
        date: '2024-02-01',
        shares: new Decimal('150'),
        grossAmount: new Decimal('16500'),
        fees: new Decimal('0'),
      },
    ];

    const result = computeMovingAverage(txs);

    // avgCost = (9500 + 21000) / 300 = 30500 / 300 = 101.6667
    // costBasis for sell = 150 × 101.6667 = 15250.00
    // realizedGain = 16500 − 15250 = 1250
    expect(result.realizedGain.toDecimalPlaces(2).toNumber()).toBeCloseTo(1250, 0);
    expect(result.totalShares.toNumber()).toBe(150);
  });
});
