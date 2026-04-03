import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { CostMethod } from '@quovibe/shared';
import { computeFIFO } from '../src/cost/fifo';
import { computeMovingAverage } from '../src/cost/moving-average';
import { computePeriodRelativeGains } from '../src/valuation/period-gains';
import { CostTransaction } from '../src/cost/types';

const d = (n: number) => new Decimal(n);

describe('FIFO vs Moving Average — cost method comparison', () => {
  // Cost methodology summary table:
  // | Gains            | Moving Average | FIFO   |
  // | Unrealized Gains | 1200 €         | 600 €  |
  // | Realized Gains   | 1650 €         | 2250 € |
  // | Total            | 2850 €         | 2850 € |
  test('full sequence — FIFO ≠ MA realized, same total', () => {
    const transactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
      { type: 'BUY', date: '2024-05-01', shares: d(50), grossAmount: d(5000), fees: d(0) },
      { type: 'BUY', date: '2024-06-01', shares: d(300), grossAmount: d(32250), fees: d(0) },
      { type: 'SELL', date: '2024-07-01', shares: d(200), grossAmount: d(21600), fees: d(0) },
    ];

    const currentPrice = d(108);
    const fifo = computeFIFO(transactions, currentPrice);
    const ma = computeMovingAverage(transactions, currentPrice);

    // FIFO: realized=2250, unrealized=600
    expect(fifo.realizedGain.toNumber()).toBeCloseTo(2250, 2);
    expect(fifo.unrealizedGain.toNumber()).toBeCloseTo(600, 2);

    // MA: realized=1650, unrealized=1200
    expect(ma.realizedGain.toNumber()).toBeCloseTo(1650, 2);
    expect(ma.unrealizedGain.toNumber()).toBeCloseTo(1200, 2);

    // Realized differs
    expect(fifo.realizedGain.toNumber()).not.toBeCloseTo(ma.realizedGain.toNumber(), 0);

    // Total invariant: FIFO total = MA total = 2850
    const fifoTotal = fifo.realizedGain.plus(fifo.unrealizedGain);
    const maTotal = ma.realizedGain.plus(ma.unrealizedGain);
    expect(fifoTotal.toNumber()).toBeCloseTo(2850, 2);
    expect(maTotal.toNumber()).toBeCloseTo(2850, 2);
    expect(fifoTotal.toNumber()).toBeCloseTo(maTotal.toNumber(), 2);
  });

  // When all buys happen before the period and are collapsed into a single synthetic lot,
  // FIFO and MA must produce identical values (single lot = no ordering difference).
  test('only pre-period buys → FIFO = MA (single synthetic lot)', () => {
    // Synthetic lot: 15 shares at 18.638/share = 279.57 total
    const valueAtPeriodStart = d(279.57);
    const sharesAtPeriodStart = d(15);

    // One sell within period
    const inPeriodTransactions: CostTransaction[] = [
      { type: 'SELL', date: '2023-04-12', shares: d(5), grossAmount: d(112), fees: d(0) },
    ];

    const fifoResult = computePeriodRelativeGains({
      valueAtPeriodStart,
      sharesAtPeriodStart,
      inPeriodTransactions,
      priceAtPeriodEnd: d(20),
      sharesAtPeriodEnd: d(10),
      costMethod: CostMethod.FIFO,
    });

    const maResult = computePeriodRelativeGains({
      valueAtPeriodStart,
      sharesAtPeriodStart,
      inPeriodTransactions,
      priceAtPeriodEnd: d(20),
      sharesAtPeriodEnd: d(10),
      costMethod: CostMethod.MOVING_AVERAGE,
    });

    // With a single synthetic lot, both methods must produce identical realized gains
    expect(fifoResult.realizedGain.toNumber()).toBeCloseTo(maResult.realizedGain.toNumber(), 4);
    expect(fifoResult.unrealizedGain.toNumber()).toBeCloseTo(maResult.unrealizedGain.toNumber(), 4);
  });

  // When period includes all buys AND sells (ALL period, no pre-period buys),
  // FIFO and MA should produce different realized gains (multiple lots at different prices).
  test('ALL period (no pre-period buys) → FIFO ≠ MA realized gains', () => {
    // No synthetic lot — period starts before all buys
    const inPeriodTransactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
      { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
      { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
      { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
    ];

    const fifoResult = computePeriodRelativeGains({
      valueAtPeriodStart: d(0),
      sharesAtPeriodStart: d(0),
      inPeriodTransactions,
      priceAtPeriodEnd: d(110),
      sharesAtPeriodEnd: d(250),
      costMethod: CostMethod.FIFO,
    });

    const maResult = computePeriodRelativeGains({
      valueAtPeriodStart: d(0),
      sharesAtPeriodStart: d(0),
      inPeriodTransactions,
      priceAtPeriodEnd: d(110),
      sharesAtPeriodEnd: d(250),
      costMethod: CostMethod.MOVING_AVERAGE,
    });

    // FIFO realized = 1750, MA realized = 1050
    expect(fifoResult.realizedGain.toNumber()).toBeCloseTo(1750, 2);
    expect(maResult.realizedGain.toNumber()).toBeCloseTo(1050, 2);

    // Realized gains differ
    expect(fifoResult.realizedGain.toNumber()).not.toBeCloseTo(maResult.realizedGain.toNumber(), 0);

    // Total invariant: realized + unrealized is the same for both methods
    const fifoTotal = fifoResult.realizedGain.plus(fifoResult.unrealizedGain);
    const maTotal = maResult.realizedGain.plus(maResult.unrealizedGain);
    expect(fifoTotal.toNumber()).toBeCloseTo(maTotal.toNumber(), 2);
  });

  // Verify the total invariant across different scenarios
  test('total gains invariant holds across cost methods for mixed scenario', () => {
    // Mix of pre-period and in-period buys
    const valueAtPeriodStart = d(1000); // 10 shares at 100
    const inPeriodTransactions: CostTransaction[] = [
      { type: 'BUY', date: '2024-03-01', shares: d(20), grossAmount: d(2400), fees: d(0) },
      { type: 'SELL', date: '2024-06-01', shares: d(15), grossAmount: d(2100), fees: d(0) },
    ];

    const fifoResult = computePeriodRelativeGains({
      valueAtPeriodStart,
      sharesAtPeriodStart: d(10),
      inPeriodTransactions,
      priceAtPeriodEnd: d(150),
      sharesAtPeriodEnd: d(15),
      costMethod: CostMethod.FIFO,
    });

    const maResult = computePeriodRelativeGains({
      valueAtPeriodStart,
      sharesAtPeriodStart: d(10),
      inPeriodTransactions,
      priceAtPeriodEnd: d(150),
      sharesAtPeriodEnd: d(15),
      costMethod: CostMethod.MOVING_AVERAGE,
    });

    const fifoTotal = fifoResult.realizedGain.plus(fifoResult.unrealizedGain);
    const maTotal = maResult.realizedGain.plus(maResult.unrealizedGain);
    expect(fifoTotal.toNumber()).toBeCloseTo(maTotal.toNumber(), 2);
  });
});
