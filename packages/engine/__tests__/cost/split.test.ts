import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { parseSplitRatio, applySplitAdjustment, SplitEvent } from '../../src/cost/split';
import { Lot } from '../../src/cost/types';

describe('parseSplitRatio', () => {
  it('parses 2:1 as 2', () => {
    expect(parseSplitRatio('2:1').toNumber()).toBe(2);
  });

  it('parses 3:2 as 1.5', () => {
    expect(parseSplitRatio('3:2').toNumber()).toBe(1.5);
  });

  it('parses 1:2 as 0.5 (reverse split)', () => {
    expect(parseSplitRatio('1:2').toNumber()).toBe(0.5);
  });
});

describe('applySplitAdjustment', () => {
  it('doubles shares and halves pricePerShare on 2:1 split, totalCost unchanged', () => {
    const lots: Lot[] = [
      {
        date: '2024-01-01',
        shares: new Decimal(100),
        pricePerShare: new Decimal(50),
        totalCost: new Decimal(5000),
      },
    ];
    const events: SplitEvent[] = [
      { date: '2024-06-01', ratio: new Decimal(2), securityId: 'SEC1' },
    ];
    applySplitAdjustment(lots, events);
    expect(lots[0].shares.toNumber()).toBe(200);
    expect(lots[0].pricePerShare.toNumber()).toBe(25);
    expect(lots[0].totalCost.toNumber()).toBe(5000);
  });

  it('does not adjust lots with date >= split date', () => {
    const lots: Lot[] = [
      {
        date: '2024-06-01',
        shares: new Decimal(100),
        pricePerShare: new Decimal(50),
        totalCost: new Decimal(5000),
      },
    ];
    const events: SplitEvent[] = [
      { date: '2024-06-01', ratio: new Decimal(2), securityId: 'SEC1' },
    ];
    applySplitAdjustment(lots, events);
    // date is not < event.date (equal), so not adjusted
    expect(lots[0].shares.toNumber()).toBe(100);
    expect(lots[0].pricePerShare.toNumber()).toBe(50);
  });
});
