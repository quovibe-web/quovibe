// Reference: Moving average cost basis — weighted average recalculated on each buy
import { describe, it, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeMovingAverage } from '../moving-average';
import type { CostTransaction } from '../types';
import type { RateMap } from '../../fx/rate-map';

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

describe('computeMovingAverage with rateMap (Phase 3)', () => {
  it('emits weightedAvgRate + costInBase when rateMap supplied', () => {
    const rateMap: RateMap = new Map([
      ['2026-05-01', new Decimal('0.86')],
      ['2026-05-08', new Decimal('0.85')],
    ]);
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'BUY', date: '2026-05-08', shares: new Decimal(5),  grossAmount: new Decimal(525),  fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs, undefined, undefined, { rateMap });
    // weightedAvgRate = (10*0.86 + 5*0.85) / 15 = 12.85 / 15 ≈ 0.85666...
    expect(result.weightedAvgRate?.toFixed(6)).toBe('0.856667');
    // costInBase = totalCost × weightedAvgRate = 1525 × 0.85666... ≈ 1306.4166...
    expect(result.costInBase?.toFixed(4)).toBe('1306.4167');
  });

  it('SELL preserves weightedAvgRate (lot reduction does not change rate)', () => {
    const rateMap: RateMap = new Map([
      ['2026-05-01', new Decimal('0.86')],
      ['2026-05-15', new Decimal('0.90')],
    ]);
    const txs: CostTransaction[] = [
      { type: 'BUY',  date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'SELL', date: '2026-05-15', shares: new Decimal(4),  grossAmount: new Decimal(440),  fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs, undefined, undefined, { rateMap });
    expect(result.weightedAvgRate?.toString()).toBe('0.86');
    expect(result.totalShares.toString()).toBe('6');
  });

  it('no rateMap → no base fields (regression)', () => {
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs);
    expect(result.weightedAvgRate).toBeUndefined();
    expect(result.costInBase).toBeUndefined();
  });

  it('MA emits unresolvedBuyDates when rateMap missing BUY date', () => {
    const rateMap: RateMap = new Map([['2026-05-01', new Decimal('0.86')]]);
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'BUY', date: '2026-05-15', shares: new Decimal(5),  grossAmount: new Decimal(550),  fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs, undefined, undefined, { rateMap });
    expect(result.unresolvedBuyDates).toEqual(['2026-05-15']);
    expect(result.costInBase).toBeUndefined(); // suppressed when coverage incomplete
    expect(result.weightedAvgRate).toBeDefined(); // informational; still emitted
  });

  it('MA unresolvedBuyDates undefined when no rateMap (legacy)', () => {
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs);
    expect(result.unresolvedBuyDates).toBeUndefined();
    expect(result.unresolvedSellDates).toBeUndefined();
    expect(result.realizedSellSlices).toBeUndefined();
  });

  it('MA unresolvedBuyDates empty array when rateMap covers all BUYs', () => {
    const rateMap: RateMap = new Map([['2026-05-01', new Decimal('0.86')]]);
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs, undefined, undefined, { rateMap });
    expect(result.unresolvedBuyDates).toEqual([]);
    expect(result.costInBase).toBeDefined(); // coverage complete → costInBase emitted
  });

  it('MA emits realizedSellSlices when rateMap covers BUY + SELL dates', () => {
    const rateMap: RateMap = new Map([
      ['2026-05-01', new Decimal('0.86')],
      ['2026-05-15', new Decimal('0.90')],
    ]);
    const txs: CostTransaction[] = [
      { type: 'BUY',  date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'SELL', date: '2026-05-15', shares: new Decimal(4),  grossAmount: new Decimal(440),  fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs, undefined, undefined, { rateMap });
    expect(result.realizedSellSlices).toHaveLength(1);
    const slice = result.realizedSellSlices![0];
    expect(slice.shares.toString()).toBe('4');
    expect(slice.avgPriceAtSell.toString()).toBe('100'); // 1000/10
    expect(slice.lotRate?.toString()).toBe('0.86');
    expect(slice.sellPrice.toString()).toBe('110');
    expect(slice.sellRate?.toString()).toBe('0.9');
  });

  it('MA SELL with missing sell-date rate goes to unresolvedSellDates', () => {
    const rateMap: RateMap = new Map([['2026-05-01', new Decimal('0.86')]]);
    const txs: CostTransaction[] = [
      { type: 'BUY',  date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'SELL', date: '2026-05-15', shares: new Decimal(4),  grossAmount: new Decimal(440),  fees: new Decimal(0) },
    ];
    const result = computeMovingAverage(txs, undefined, undefined, { rateMap });
    expect(result.unresolvedSellDates).toEqual(['2026-05-15']);
    expect(result.realizedSellSlices).toEqual([]); // SELL skipped, not partial
  });
});

// SECURITY_TRANSFER: inbound adds shares with inherited cost basis (PP-parity);
// outbound removes shares with zero realized gain (cost travels with the shares).

describe('computeMovingAverage — SECURITY_TRANSFER_INBOUND / OUTBOUND', () => {
  it('inbound transfer adds shares at inherited cost, outbound removes with zero realized gain', () => {
    // BUY 100 shares @€10 in source account → avg cost = €10
    // SECURITY_TRANSFER_OUTBOUND 100 shares @€1000 (inherited basis) → zero realized gain
    // SECURITY_TRANSFER_INBOUND 100 shares @€1000 (same basis) → avg cost on dest still €10
    // SELL 100 shares @€12 → realized gain = 100 × (12 − 10) = €200
    const txs: CostTransaction[] = [
      { type: 'BUY',                        date: '2024-01-05', shares: new Decimal('100'), grossAmount: new Decimal('1000'), fees: new Decimal('0') },
      { type: 'SECURITY_TRANSFER_OUTBOUND', date: '2024-03-01', shares: new Decimal('100'), grossAmount: new Decimal('1000'), fees: new Decimal('0') },
      { type: 'SECURITY_TRANSFER_INBOUND',  date: '2024-03-01', shares: new Decimal('100'), grossAmount: new Decimal('1000'), fees: new Decimal('0') },
      { type: 'SELL',                       date: '2024-06-01', shares: new Decimal('100'), grossAmount: new Decimal('1200'), fees: new Decimal('0') },
    ];
    const result = computeMovingAverage(txs);
    expect(result.totalShares.toString()).toBe('0');
    // Outbound: realized gain = 1000 − (100 × avgCost=10) = 0.
    // Inbound: adds 100 shares @1000 cost.
    // Sell: realized gain = 1200 − 1000 = 200.
    expect(result.realizedGain.toString()).toBe('200');
    expect(result.purchaseValue.toString()).toBe('0');
  });

  it('inbound transfer without prior context starts at the transferred-in cost', () => {
    // Destination-only view: receive 50 shares with inherited cost €500, then sell @€11
    const txs: CostTransaction[] = [
      { type: 'SECURITY_TRANSFER_INBOUND', date: '2024-03-01', shares: new Decimal('50'),  grossAmount: new Decimal('500'),  fees: new Decimal('0') },
      { type: 'SELL',                      date: '2024-06-01', shares: new Decimal('50'),  grossAmount: new Decimal('550'),  fees: new Decimal('0') },
    ];
    const result = computeMovingAverage(txs);
    // avg cost = 500/50 = 10; realized = 550 − 500 = 50
    expect(result.realizedGain.toString()).toBe('50');
    expect(result.totalShares.toString()).toBe('0');
  });

  it('outbound transfer with no prior shares throws (over-transfer)', () => {
    const txs: CostTransaction[] = [
      { type: 'SECURITY_TRANSFER_OUTBOUND', date: '2024-03-01', shares: new Decimal('10'), grossAmount: new Decimal('100'), fees: new Decimal('0') },
    ];
    expect(() => computeMovingAverage(txs)).toThrow(/Sold more shares than available/);
  });
});
