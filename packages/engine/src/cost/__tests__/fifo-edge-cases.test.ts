// Reference: FIFO cost basis — first-in first-out lot matching on partial sells
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeFIFO } from '../fifo';
import { applySplitAdjustment } from '../split';
import type { CostTransaction, Lot } from '../types';
import type { SplitEvent } from '../split';

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
