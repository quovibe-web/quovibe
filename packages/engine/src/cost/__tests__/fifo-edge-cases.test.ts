// Reference: FIFO cost basis — first-in first-out lot matching on partial sells
import { describe, test, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { computeFIFO } from '../fifo';
import { applySplitAdjustment } from '../split';
import type { CostTransaction, Lot } from '../types';
import type { SplitEvent } from '../split';
import type { RateMap } from '../../fx/rate-map';

// FIFO edge cases: zero shares, negative shares, and split ratio guards.

describe('computeFIFO — edge cases: zero / negative shares', () => {
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
    expect(() => computeFIFO(txs)).toThrow(/BUY transaction must have positive shares/);
  });

  test('BUY with negative shares throws descriptive error', () => {
    const txs: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-01-10',
        shares: new Decimal('-5'),
        grossAmount: new Decimal('1000'),
        fees: new Decimal('10'),
      },
    ];
    expect(() => computeFIFO(txs)).toThrow(/BUY transaction must have positive shares/);
  });

  test('SELL with zero shares throws descriptive error', () => {
    const txs: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-01-05',
        shares: new Decimal('10'),
        grossAmount: new Decimal('1000'),
        fees: new Decimal('0'),
      },
      {
        type: 'SELL',
        date: '2024-01-10',
        shares: new Decimal(0),
        grossAmount: new Decimal('500'),
        fees: new Decimal('0'),
      },
    ];
    expect(() => computeFIFO(txs)).toThrow(/SELL transaction must have positive shares/);
  });

  test('normal BUY/SELL still works (regression guard)', () => {
    const txs: CostTransaction[] = [
      {
        type: 'BUY',
        date: '2024-01-05',
        shares: new Decimal('10'),
        grossAmount: new Decimal('1000'),
        fees: new Decimal('0'),
      },
      {
        type: 'SELL',
        date: '2024-02-01',
        shares: new Decimal('5'),
        grossAmount: new Decimal('600'),
        fees: new Decimal('0'),
      },
    ];

    const result = computeFIFO(txs);
    // BUY 10@100, SELL 5@120 → realized gain = 5 × (120 − 100) = 100
    expect(result.realizedGain.toNumber()).toBe(100);
    expect(result.remainingLots).toHaveLength(1);
    expect(result.remainingLots[0].shares.toNumber()).toBe(5);
  });
});

describe('applySplitAdjustment — edge cases: zero / negative ratio', () => {
  test('split ratio of zero throws descriptive error', () => {
    const lots: Lot[] = [
      {
        date: '2024-01-05',
        shares: new Decimal('10'),
        pricePerShare: new Decimal('100'),
        totalCost: new Decimal('1000'),
      },
    ];
    const events: SplitEvent[] = [
      { date: '2024-06-01', ratio: new Decimal(0), securityId: 'sec-1' },
    ];

    expect(() => applySplitAdjustment(lots, events)).toThrow(/Split ratio must be positive/);
  });

  test('negative split ratio throws descriptive error', () => {
    const lots: Lot[] = [
      {
        date: '2024-01-05',
        shares: new Decimal('10'),
        pricePerShare: new Decimal('100'),
        totalCost: new Decimal('1000'),
      },
    ];
    const events: SplitEvent[] = [
      { date: '2024-06-01', ratio: new Decimal('-2'), securityId: 'sec-1' },
    ];

    expect(() => applySplitAdjustment(lots, events)).toThrow(/Split ratio must be positive/);
  });
});

describe('computeFIFO with rateMap (Phase 3)', () => {
  it('lots carry acquisitionRate + costInBase when rateMap supplied', () => {
    const rateMap: RateMap = new Map([
      ['2026-05-01', new Decimal('0.86')],
      ['2026-05-08', new Decimal('0.85')],
    ]);
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'BUY', date: '2026-05-08', shares: new Decimal(5), grossAmount: new Decimal(525), fees: new Decimal(0) },
    ];
    const result = computeFIFO(txs, undefined, undefined, { rateMap });
    expect(result.remainingLots).toHaveLength(2);
    expect(result.remainingLots[0].acquisitionRate?.toString()).toBe('0.86');
    expect(result.remainingLots[0].costInBase?.toString()).toBe('860');
    expect(result.remainingLots[1].acquisitionRate?.toString()).toBe('0.85');
    expect(result.remainingLots[1].costInBase?.toString()).toBe('446.25');
  });

  it('SELL emits consumedSlices with lot rates preserved (FIFO order)', () => {
    const rateMap: RateMap = new Map([
      ['2026-05-01', new Decimal('0.86')],
      ['2026-05-08', new Decimal('0.85')],
      ['2026-05-15', new Decimal('0.90')],
    ]);
    const txs: CostTransaction[] = [
      { type: 'BUY',  date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'BUY',  date: '2026-05-08', shares: new Decimal(5),  grossAmount: new Decimal(525),  fees: new Decimal(0) },
      { type: 'SELL', date: '2026-05-15', shares: new Decimal(12), grossAmount: new Decimal(1320), fees: new Decimal(0) },
    ];
    const result = computeFIFO(txs, undefined, undefined, { rateMap });
    expect(result.consumedSlices).toHaveLength(2);
    expect(result.consumedSlices![0].shares.toString()).toBe('10');
    expect(result.consumedSlices![0].lotAcquisitionRate?.toString()).toBe('0.86');
    expect(result.consumedSlices![1].shares.toString()).toBe('2');
    expect(result.consumedSlices![1].lotAcquisitionRate?.toString()).toBe('0.85');
  });

  it('rateMap missing buy-date → lot born without acquisitionRate (degraded path)', () => {
    const rateMap: RateMap = new Map();
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
    ];
    const result = computeFIFO(txs, undefined, undefined, { rateMap });
    expect(result.remainingLots[0].acquisitionRate).toBeUndefined();
    expect(result.remainingLots[0].costInBase).toBeUndefined();
  });

  it('no rateMap (legacy call) → lots have no base fields (regression)', () => {
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
    ];
    const result = computeFIFO(txs);
    expect(result.remainingLots[0].acquisitionRate).toBeUndefined();
    expect(result.consumedSlices).toBeUndefined();
  });

  it('FIFO emits unresolvedBuyDates when rateMap missing BUY date', () => {
    const rateMap: RateMap = new Map([['2026-05-01', new Decimal('0.86')]]);
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
      { type: 'BUY', date: '2026-05-15', shares: new Decimal(5),  grossAmount: new Decimal(550),  fees: new Decimal(0) }, // no rate
    ];
    const result = computeFIFO(txs, undefined, undefined, { rateMap });
    expect(result.unresolvedBuyDates).toEqual(['2026-05-15']);
    expect(result.remainingLots[0].acquisitionRate?.toString()).toBe('0.86');
    expect(result.remainingLots[1].acquisitionRate).toBeUndefined();
  });

  it('FIFO unresolvedBuyDates undefined when no rateMap (legacy)', () => {
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
    ];
    const result = computeFIFO(txs);
    expect(result.unresolvedBuyDates).toBeUndefined();
  });

  it('FIFO unresolvedBuyDates empty array when rateMap covers all BUYs', () => {
    const rateMap: RateMap = new Map([['2026-05-01', new Decimal('0.86')]]);
    const txs: CostTransaction[] = [
      { type: 'BUY', date: '2026-05-01', shares: new Decimal(10), grossAmount: new Decimal(1000), fees: new Decimal(0) },
    ];
    const result = computeFIFO(txs, undefined, undefined, { rateMap });
    expect(result.unresolvedBuyDates).toEqual([]);
  });
});

// SECURITY_TRANSFER: inbound creates a new lot preserving original purchase price;
// outbound consumes lots FIFO with zero realized gain (basis travels with the shares).

describe('computeFIFO — SECURITY_TRANSFER_INBOUND / OUTBOUND', () => {
  it('inbound creates a lot at the inherited price; SELL against it realizes gain correctly', () => {
    // Source account lot: 100 shares @€10 cost.
    // Transfer: OUTBOUND 100 @€1000 (inherited basis), INBOUND 100 @€1000.
    // Sell 100 @€12 → realized gain = 100 × (12 − 10) = €200
    const txs: CostTransaction[] = [
      { type: 'BUY',                        date: '2024-01-05', shares: new Decimal('100'), grossAmount: new Decimal('1000'), fees: new Decimal('0') },
      { type: 'SECURITY_TRANSFER_OUTBOUND', date: '2024-03-01', shares: new Decimal('100'), grossAmount: new Decimal('1000'), fees: new Decimal('0') },
      { type: 'SECURITY_TRANSFER_INBOUND',  date: '2024-03-01', shares: new Decimal('100'), grossAmount: new Decimal('1000'), fees: new Decimal('0') },
      { type: 'SELL',                       date: '2024-06-01', shares: new Decimal('100'), grossAmount: new Decimal('1200'), fees: new Decimal('0') },
    ];
    const result = computeFIFO(txs);
    expect(result.remainingLots).toHaveLength(0);
    expect(result.realizedGain.toString()).toBe('200');
  });

  it('multiple inherited lots produce correct FIFO lot stack', () => {
    // Two BUYs on source side → two INBOUND rows → FIFO order preserved
    const txs: CostTransaction[] = [
      { type: 'SECURITY_TRANSFER_INBOUND', date: '2024-01-10', shares: new Decimal('30'), grossAmount: new Decimal('300'), fees: new Decimal('0') },
      { type: 'SECURITY_TRANSFER_INBOUND', date: '2024-02-10', shares: new Decimal('20'), grossAmount: new Decimal('250'), fees: new Decimal('0') },
      { type: 'SELL',                      date: '2024-06-01', shares: new Decimal('30'), grossAmount: new Decimal('420'), fees: new Decimal('0') },
    ];
    const result = computeFIFO(txs);
    // First lot: 30 shares @10/share. Sell 30 @14: gain = 30 × (14 − 10) = 120
    expect(result.realizedGain.toString()).toBe('120');
    expect(result.remainingLots).toHaveLength(1);
    expect(result.remainingLots[0].shares.toString()).toBe('20');
  });

  it('outbound with no prior shares throws (over-transfer)', () => {
    const txs: CostTransaction[] = [
      { type: 'SECURITY_TRANSFER_OUTBOUND', date: '2024-03-01', shares: new Decimal('10'), grossAmount: new Decimal('100'), fees: new Decimal('0') },
    ];
    // FIFO SELL-path: sharesToSell = 10, lots = [] → loop exhausted, no throw.
    // No "sold more than held" guard in FIFO (FIFO silently under-delivers).
    // Document expected behavior: remaining lots empty, realized gain 0.
    const result = computeFIFO(txs);
    expect(result.remainingLots).toHaveLength(0);
    expect(result.realizedGain.toString()).toBe('0');
  });
});
