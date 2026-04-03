import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeFIFO } from '../src/cost/fifo';
import { CostTransaction } from '../src/cost/types';

const d = (n: number) => new Decimal(n);

// FIFO (First-In, First-Out): oldest shares sold first, each share retains original purchase price.

describe('computeFIFO', () => {
  // FIFO Example 1:
  // Buy 100@95, Buy 200@105, Buy 100@107, Sell 150@110
  // FIFO realized = 100*(110-95) + 50*(110-105) = 1500 + 250 = 1750
  // Remaining: 150@105, 100@107 → avg = (150*105 + 100*107)/250 = 105.80
  // Unrealized = 250*(110-105.80) = 1050
  test('Example 1 — BUY 100@95, BUY 200@105, BUY 100@107, SELL 150@110', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
    ];

    const result = computeFIFO(transactions, d(110));

    // Realized: 100*(110-95) + 50*(110-105) = 1500 + 250 = 1750
    expect(result.realizedGain.toNumber()).toBeCloseTo(1750, 2);

    // Remaining lots: 150@105, 100@107
    expect(result.remainingLots).toHaveLength(2);
    expect(result.remainingLots[0].shares.toNumber()).toBe(150);
    expect(result.remainingLots[0].pricePerShare.toNumber()).toBe(105);
    expect(result.remainingLots[1].shares.toNumber()).toBe(100);
    expect(result.remainingLots[1].pricePerShare.toNumber()).toBe(107);

    // Average purchase price of remaining: (150*105 + 100*107) / 250 = 105.80
    expect(result.averagePurchasePrice.toNumber()).toBeCloseTo(105.80, 2);

    // Unrealized: 250*(110-105.80) = 1050
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(1050, 2);

    // Total gain invariant: realized + unrealized = 2800
    expect(result.realizedGain.plus(result.unrealizedGain).toNumber()).toBeCloseTo(2800, 2);
  });

  // FIFO Example 2 (continuation):
  // Remaining from Example 1: 150@105, 100@107
  // Buy 50@100, Buy 300@107.5, Sell 200@108
  // FIFO sell 200: 150@105 + 50@107 → realized = 150*(108-105) + 50*(108-107) = 450 + 50 = 500
  // Remaining: 50@107, 50@100, 300@107.5 → avg = (50*107 + 50*100 + 300*107.5)/400 = 106.50
  // Unrealized = 50*(108-107) + 50*(108-100) + 300*(108-107.5) = 50 + 400 + 150 = 600
  test('Example 2 — continued from Example 1, BUY 50@100, BUY 300@107.5, SELL 200@108', () => {
    const transactions: CostTransaction[] = [
      // Original buys from Example 1
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      // First sell from Example 1
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
      // Example 2 new buys
      { type: 'BUY', date: '2024-05-01', shares: d(50), grossAmount: d(5000), fees: d(0) },
      { type: 'BUY', date: '2024-06-01', shares: d(300), grossAmount: d(32250), fees: d(0) },
      // Example 2 sell
      { type: 'SELL', date: '2024-07-01', shares: d(200), grossAmount: d(21600), fees: d(0) },
    ];

    const result = computeFIFO(transactions, d(108));

    // Total realized from both sells: 1750 + 500 = 2250
    expect(result.realizedGain.toNumber()).toBeCloseTo(2250, 2);

    // Remaining: 50@107, 50@100, 300@107.5
    const totalRemainingShares = result.remainingLots.reduce(
      (sum, lot) => sum.plus(lot.shares),
      new Decimal(0),
    );
    expect(totalRemainingShares.toNumber()).toBe(400);

    // Average purchase price: (50*107 + 50*100 + 300*107.5) / 400 = 106.50
    expect(result.averagePurchasePrice.toNumber()).toBeCloseTo(106.50, 2);

    // Unrealized: 400*(108) - (50*107 + 50*100 + 300*107.5) = 43200 - 42600 = 600
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(600, 2);

    // Total invariant: realized + unrealized = 2850
    expect(result.realizedGain.plus(result.unrealizedGain).toNumber()).toBeCloseTo(2850, 2);
  });

  // FIFO cost methodology — summary table.
  // Total gains (realized + unrealized) must be 2850 for FIFO.
  test('FIFO total gains = 2850 (summary table)', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
      { type: 'BUY', date: '2024-05-01', shares: d(50), grossAmount: d(5000), fees: d(0) },
      { type: 'BUY', date: '2024-06-01', shares: d(300), grossAmount: d(32250), fees: d(0) },
      { type: 'SELL', date: '2024-07-01', shares: d(200), grossAmount: d(21600), fees: d(0) },
    ];

    const result = computeFIFO(transactions, d(108));
    const total = result.realizedGain.plus(result.unrealizedGain);
    expect(total.toNumber()).toBeCloseTo(2850, 2);
  });

  test('no transactions → zero values', () => {
    const result = computeFIFO([], d(100));
    expect(result.realizedGain.toNumber()).toBe(0);
    expect(result.unrealizedGain.toNumber()).toBe(0);
    expect(result.remainingLots).toHaveLength(0);
    expect(result.purchaseValue.toNumber()).toBe(0);
  });

  test('buys only → no realized, unrealized = mv - cost', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(10), grossAmount: d(1000), fees: d(10) },
    ];

    const result = computeFIFO(transactions, d(120));
    expect(result.realizedGain.toNumber()).toBe(0);
    // unrealized = 10 * 120 - 1010 (incl fees) = 190
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(190, 2);
    expect(result.purchaseValue.toNumber()).toBeCloseTo(1010, 2);
  });

  // Purchase Value includes fees and taxes.
  // Regression: computeFIFO must include fees in cost basis for Purchase Value.
  test('fees are included in FIFO cost basis (for Purchase Value)', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(10), grossAmount: d(1000), fees: d(50) },
      { type: 'BUY', date: '2024-02-01', shares: d(10), grossAmount: d(1200), fees: d(60) },
    ];

    const result = computeFIFO(transactions, d(130));
    // Lot 1: 10 shares @ (1000+50)/10 = 105; Lot 2: 10 shares @ (1200+60)/10 = 126
    expect(result.remainingLots).toHaveLength(2);
    expect(result.remainingLots[0].pricePerShare.toNumber()).toBeCloseTo(105, 2);
    expect(result.remainingLots[1].pricePerShare.toNumber()).toBeCloseTo(126, 2);
    // Purchase value = 1050 + 1260 = 2310
    expect(result.purchaseValue.toNumber()).toBeCloseTo(2310, 2);
    // Unrealized = 20*130 - 2310 = 290
    expect(result.unrealizedGain.toNumber()).toBeCloseTo(290, 2);
  });

  test('DELIVERY_INBOUND treated as buy', () => {
    const transactions: CostTransaction[] = [
      { type: 'DELIVERY_INBOUND', date: '2024-01-01', shares: d(10), grossAmount: d(500), fees: d(0) },
      { type: 'SELL', date: '2024-02-01', shares: d(5), grossAmount: d(300), fees: d(0) },
    ];

    const result = computeFIFO(transactions, d(60));
    // FIFO: sell 5 from delivery lot at 50/share; realized = 5*(60-50) = 50
    expect(result.realizedGain.toNumber()).toBeCloseTo(50, 2);
  });

  test('unsorted input is handled correctly', () => {
    // Pass transactions in reverse order — computeFIFO sorts internally
    const transactions: CostTransaction[] = [
      { type: 'SELL', date: '2024-04-01', shares: d(5), grossAmount: d(600), fees: d(0) },
      { type: 'BUY', date: '2024-01-01', shares: d(10), grossAmount: d(1000), fees: d(0) },
    ];

    const result = computeFIFO(transactions, d(120));
    // realized = 5*(120-100) = 100
    expect(result.realizedGain.toNumber()).toBeCloseTo(100, 2);
    expect(result.remainingLots).toHaveLength(1);
    expect(result.remainingLots[0].shares.toNumber()).toBe(5);
  });
});
