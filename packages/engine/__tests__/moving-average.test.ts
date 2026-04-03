import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeMovingAverage } from '../src/cost/moving-average';
import { CostTransaction } from '../src/cost/types';

const d = (n: number) => new Decimal(n);

// Moving Average: all shares assigned the same average purchase price.

describe('computeMovingAverage', () => {
  // Moving Average Example 1:
  // Buy 100@95, Buy 200@105, Buy 100@107, Sell 150@110
  // MA avg price = (100*95 + 200*105 + 100*107) / 400 = 41200 / 400 = 103
  // Realized = 150*(110-103) = 1050
  // Unrealized = 250*(110-103) = 1750
  test('Example 1 — BUY 100@95, BUY 200@105, BUY 100@107, SELL 150@110', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
    ];

    const result = computeMovingAverage(transactions, d(110));

    // Realized: 150*(110-103) = 1050
    expect(result.realizedGain.toNumber()).toBeCloseTo(1050, 2);

    // Average price remains 103 after sell (MA invariant)
    expect(result.averagePurchasePrice.toNumber()).toBeCloseTo(103, 2);

    // Remaining: 250 shares
    expect(result.totalShares.toNumber()).toBe(250);

    // Unrealized: 250*(110-103) = 1750
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(1750, 2);

    // Total gain invariant: realized + unrealized = 2800
    expect(result.realizedGain.plus(result.unrealizedGain).toNumber()).toBeCloseTo(2800, 2);
  });

  // Moving Average Example 2 (continuation):
  // Remaining: 250@103
  // Buy 50@100, Buy 300@107.5 → new avg = (250*103 + 50*100 + 300*107.5) / 600 = 63000/600 = 105
  // Sell 200@108 → realized = 200*(108-105) = 600
  // Total realized: 1050 + 600 = 1650
  // Remaining: 400@105
  // Unrealized: 400*(108-105) = 1200
  test('Example 2 — continued from Example 1, BUY 50@100, BUY 300@107.5, SELL 200@108', () => {
    const transactions: CostTransaction[] = [
      // Example 1 transactions
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
      // Example 2 new transactions
      { type: 'BUY', date: '2024-05-01', shares: d(50), grossAmount: d(5000), fees: d(0) },
      { type: 'BUY', date: '2024-06-01', shares: d(300), grossAmount: d(32250), fees: d(0) },
      { type: 'SELL', date: '2024-07-01', shares: d(200), grossAmount: d(21600), fees: d(0) },
    ];

    const result = computeMovingAverage(transactions, d(108));

    // Total realized: 1050 + 600 = 1650
    expect(result.realizedGain.toNumber()).toBeCloseTo(1650, 2);

    // Average price after Example 2 buys and sell: 105
    expect(result.averagePurchasePrice.toNumber()).toBeCloseTo(105, 2);

    // Remaining: 400 shares
    expect(result.totalShares.toNumber()).toBe(400);

    // Unrealized: 400*(108-105) = 1200
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(1200, 2);

    // Total invariant: 1650 + 1200 = 2850
    expect(result.realizedGain.plus(result.unrealizedGain).toNumber()).toBeCloseTo(2850, 2);
  });

  // Moving Average cost methodology — summary table.
  // Total gains (realized + unrealized) must be 2850 for MA (same as FIFO).
  test('MA total gains = 2850 (summary table)', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
      { type: 'BUY', date: '2024-05-01', shares: d(50), grossAmount: d(5000), fees: d(0) },
      { type: 'BUY', date: '2024-06-01', shares: d(300), grossAmount: d(32250), fees: d(0) },
      { type: 'SELL', date: '2024-07-01', shares: d(200), grossAmount: d(21600), fees: d(0) },
    ];

    const result = computeMovingAverage(transactions, d(108));
    const total = result.realizedGain.plus(result.unrealizedGain);
    expect(total.toNumber()).toBeCloseTo(2850, 2);
  });

  test('no transactions → zero values', () => {
    const result = computeMovingAverage([], d(100));
    expect(result.realizedGain.toNumber()).toBe(0);
    expect(result.unrealizedGain.toNumber()).toBe(0);
    expect(result.totalShares.toNumber()).toBe(0);
    expect(result.purchaseValue.toNumber()).toBe(0);
  });

  test('buys only → no realized, unrealized = mv - cost', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(10), grossAmount: d(1000), fees: d(10) },
    ];

    const result = computeMovingAverage(transactions, d(120));
    expect(result.realizedGain.toNumber()).toBe(0);
    // unrealized = 10 * 120 - 1010 = 190
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(190, 2);
    expect(result.purchaseValue.toNumber()).toBeCloseTo(1010, 2);
  });

  test('MA avg price does not change after a sale', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(10000), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(100), grossAmount: d(12000), fees: d(0) },
    ];

    const beforeSell = computeMovingAverage(transactions, d(120));
    // avg = (10000+12000)/200 = 110
    expect(beforeSell.averagePurchasePrice.toNumber()).toBeCloseTo(110, 2);

    const withSell: CostTransaction[] = [
      ...transactions,
      { type: 'SELL', date: '2024-03-01', shares: d(50), grossAmount: d(6000), fees: d(0) },
    ];
    const afterSell = computeMovingAverage(withSell, d(120));
    // avg stays at 110 after sale (MA property)
    expect(afterSell.averagePurchasePrice.toNumber()).toBeCloseTo(110, 2);
    expect(afterSell.totalShares.toNumber()).toBe(150);
  });

  // Purchase Value includes fees and taxes.
  // Regression: computeMovingAverage must include fees in cost basis for Purchase Value.
  test('fees are included in moving average cost basis (for Purchase Value)', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(10000), fees: d(200) },
      { type: 'BUY', date: '2024-02-01', shares: d(100), grossAmount: d(12000), fees: d(300) },
    ];

    const result = computeMovingAverage(transactions, d(120));
    // Total cost = (10000+200) + (12000+300) = 22500; avg = 22500/200 = 112.50
    expect(result.averagePurchasePrice.toNumber()).toBeCloseTo(112.50, 2);
    expect(result.purchaseValue.toNumber()).toBeCloseTo(22500, 2);
    // Unrealized = 200*120 - 22500 = 1500
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(1500, 2);
  });

  test('DELIVERY_INBOUND treated as buy', () => {
    const transactions: CostTransaction[] = [
      { type: 'DELIVERY_INBOUND', date: '2024-01-01', shares: d(10), grossAmount: d(500), fees: d(0) },
      { type: 'SELL', date: '2024-02-01', shares: d(5), grossAmount: d(300), fees: d(0) },
    ];

    const result = computeMovingAverage(transactions, d(60));
    // avg = 500/10 = 50; realized = 5*(60-50) = 50
    expect(result.realizedGain.toNumber()).toBeCloseTo(50, 2);
  });
});
