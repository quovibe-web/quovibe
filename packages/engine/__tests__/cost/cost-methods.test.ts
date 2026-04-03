import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeFIFO } from '../../src/cost/fifo';
import { computeMovingAverage } from '../../src/cost/moving-average';
import { CostTransaction } from '../../src/cost/types';
import { SplitEvent } from '../../src/cost/split';

function d(n: number): Decimal {
  return new Decimal(n);
}

// Cost methodology — Example 1:
// BUY 100@95, BUY 200@105, BUY 100@107, SELL 150@110
const example1Txs: CostTransaction[] = [
  { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(9500), fees: d(0) },
  { type: 'BUY', date: '2024-02-01', shares: d(200), grossAmount: d(21000), fees: d(0) },
  { type: 'BUY', date: '2024-03-01', shares: d(100), grossAmount: d(10700), fees: d(0) },
  { type: 'SELL', date: '2024-04-01', shares: d(150), grossAmount: d(16500), fees: d(0) },
];
const currentPrice110 = d(110);

describe('FIFO Example 1', () => {
  it('realizedGain = 1750', () => {
    const result = computeFIFO(example1Txs, currentPrice110);
    expect(result.realizedGain.toNumber()).toBe(1750);
  });

  it('unrealizedGain = 1050', () => {
    const result = computeFIFO(example1Txs, currentPrice110);
    expect(result.unrealizedGain.toNumber()).toBe(1050);
  });

  it('averagePurchasePrice = 105.8', () => {
    const result = computeFIFO(example1Txs, currentPrice110);
    expect(result.averagePurchasePrice.toNumber()).toBe(105.8);
  });

  it('remaining lots: 150@105 and 100@107', () => {
    const result = computeFIFO(example1Txs);
    expect(result.remainingLots).toHaveLength(2);
    expect(result.remainingLots[0].shares.toNumber()).toBe(150);
    expect(result.remainingLots[0].pricePerShare.toNumber()).toBe(105);
    expect(result.remainingLots[1].shares.toNumber()).toBe(100);
    expect(result.remainingLots[1].pricePerShare.toNumber()).toBe(107);
  });
});

describe('Moving Average Example 1', () => {
  it('realizedGain = 1050', () => {
    const result = computeMovingAverage(example1Txs, currentPrice110);
    expect(result.realizedGain.toNumber()).toBe(1050);
  });

  it('unrealizedGain = 1750', () => {
    const result = computeMovingAverage(example1Txs, currentPrice110);
    expect(result.unrealizedGain.toNumber()).toBe(1750);
  });

  it('averagePurchasePrice = 103', () => {
    const result = computeMovingAverage(example1Txs, currentPrice110);
    expect(result.averagePurchasePrice.toNumber()).toBe(103);
  });

  it('totalShares = 250', () => {
    const result = computeMovingAverage(example1Txs);
    expect(result.totalShares.toNumber()).toBe(250);
  });
});

describe('Total gain invariant', () => {
  it('FIFO total gain (realized + unrealized) == MA total gain', () => {
    const fifo = computeFIFO(example1Txs, currentPrice110);
    const ma = computeMovingAverage(example1Txs, currentPrice110);
    const fifoTotal = fifo.realizedGain.plus(fifo.unrealizedGain).toNumber();
    const maTotal = ma.realizedGain.plus(ma.unrealizedGain).toNumber();
    expect(fifoTotal).toBe(2800);
    expect(maTotal).toBe(2800);
    expect(fifoTotal).toBe(maTotal);
  });
});

describe('FIFO split', () => {
  it('BUY 100@50, split 2:1, SELL 50@30 -> realizedGain = 250', () => {
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(5000), fees: d(0) },
      { type: 'SELL', date: '2024-07-01', shares: d(50), grossAmount: d(1500), fees: d(0) },
    ];
    const splits: SplitEvent[] = [
      { date: '2024-04-01', ratio: d(2), securityId: 'SEC1' },
    ];
    const result = computeFIFO(txs, undefined, splits);
    // After split: lot is 200 shares @ 25. Sell 50 @ 30 = 1500, cost = 50*25 = 1250, gain = 250
    expect(result.realizedGain.toNumber()).toBe(250);
    expect(result.remainingLots[0].shares.toNumber()).toBe(150);
    expect(result.remainingLots[0].pricePerShare.toNumber()).toBe(25);
  });
});

describe('Moving Average split', () => {
  it('BUY 100@50, split 2:1, SELL 50@30 -> realizedGain = 250', () => {
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2024-01-01', shares: d(100), grossAmount: d(5000), fees: d(0) },
      { type: 'SELL', date: '2024-07-01', shares: d(50), grossAmount: d(1500), fees: d(0) },
    ];
    const splits: SplitEvent[] = [
      { date: '2024-04-01', ratio: d(2), securityId: 'SEC1' },
    ];
    const result = computeMovingAverage(txs, undefined, splits);
    // After split: 200 shares, totalCost=5000, avg=25. Sell 50@30 gain = 50*(30-25) = 250
    expect(result.realizedGain.toNumber()).toBe(250);
    expect(result.totalShares.toNumber()).toBe(150);
    expect(result.averagePurchasePrice.toNumber()).toBe(25);
  });
});
