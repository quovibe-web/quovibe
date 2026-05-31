// Reference: Realized/unrealized P&L decomposition into capital + FX components
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { decomposeRealized, decomposeUnrealized } from '../decomposition';
import type { Lot, ConsumedLotSlice } from '../types';

describe('decomposeRealized', () => {
  it('splits SELL into capital + FX components', () => {
    // Buy 10 shares @ 100 USD when USD->EUR = 0.85
    // Sell 10 shares @ 110 USD when USD->EUR = 0.90
    // Capital gain (in EUR): 10 x (110 - 100) x 0.90 = 90 EUR
    // FX gain    (in EUR):  10 x 100 x (0.90 - 0.85) = 50 EUR
    const slices: ConsumedLotSlice[] = [{
      shares: new Decimal(10),
      lotPricePerShare: new Decimal(100),
      lotAcquisitionRate: new Decimal('0.85'),
    }];
    const result = decomposeRealized(
      slices,
      new Decimal(110),
      new Decimal('0.90')
    );
    expect(result.capitalBase.toString()).toBe('90');
    expect(result.forexBase.toString()).toBe('50');
  });

  it('handles multi-slice FIFO consumption (different lot rates)', () => {
    // 5@100@0.85, 5@105@0.88. Sell 10 @ 110 @ 0.90.
    // Capital: 5 x (110-100) x 0.90 + 5 x (110-105) x 0.90 = 45 + 22.5 = 67.5
    // FX:      5 x 100 x (0.90-0.85) + 5 x 105 x (0.90-0.88) = 25 + 10.5 = 35.5
    const slices: ConsumedLotSlice[] = [
      { shares: new Decimal(5), lotPricePerShare: new Decimal(100), lotAcquisitionRate: new Decimal('0.85') },
      { shares: new Decimal(5), lotPricePerShare: new Decimal(105), lotAcquisitionRate: new Decimal('0.88') },
    ];
    const result = decomposeRealized(slices, new Decimal(110), new Decimal('0.90'));
    expect(result.capitalBase.toString()).toBe('67.5');
    expect(result.forexBase.toString()).toBe('35.5');
  });

  it('returns zero when no slices consumed', () => {
    const result = decomposeRealized([], new Decimal(100), new Decimal(1));
    expect(result.capitalBase.toString()).toBe('0');
    expect(result.forexBase.toString()).toBe('0');
  });

  it('falls back to identity rate when slice has no acquisitionRate', () => {
    const slices: ConsumedLotSlice[] = [{
      shares: new Decimal(10),
      lotPricePerShare: new Decimal(100),
    }];
    const result = decomposeRealized(slices, new Decimal(110), new Decimal(1));
    expect(result.capitalBase.toString()).toBe('100');
    expect(result.forexBase.toString()).toBe('0');
  });

  it('algebraic identity: capital + forex = sellValueInBase - costInBase', () => {
    const slices: ConsumedLotSlice[] = [
      { shares: new Decimal(5), lotPricePerShare: new Decimal(100), lotAcquisitionRate: new Decimal('0.85') },
      { shares: new Decimal(5), lotPricePerShare: new Decimal(105), lotAcquisitionRate: new Decimal('0.88') },
    ];
    const sellPrice = new Decimal(110);
    const sellRate = new Decimal('0.90');
    const result = decomposeRealized(slices, sellPrice, sellRate);
    const sellValueInBase = slices.reduce(
      (s, sl) => s.plus(sl.shares.mul(sellPrice).mul(sellRate)),
      new Decimal(0),
    );
    const costInBase = slices.reduce(
      (s, sl) => s.plus(sl.shares.mul(sl.lotPricePerShare).mul(sl.lotAcquisitionRate!)),
      new Decimal(0),
    );
    expect(result.capitalBase.plus(result.forexBase).toString()).toBe(sellValueInBase.minus(costInBase).toString());
  });
});

describe('decomposeUnrealized', () => {
  it('splits open-position MV vs cost into capital + FX', () => {
    // 10 shares @ lotPrice 100 @ lotRate 0.85. Current price 120, rate 0.92.
    // Capital: 10 x (120-100) x 0.92 = 184
    // FX:      10 x 100 x (0.92-0.85) = 70
    // Sum=254; mvBase=10x120x0.92=1104; costBase=10x100x0.85=850; diff=254
    const lots: Lot[] = [{
      date: '2026-01-15',
      shares: new Decimal(10),
      pricePerShare: new Decimal(100),
      totalCost: new Decimal(1000),
      acquisitionRate: new Decimal('0.85'),
      costInBase: new Decimal(850),
    }];
    const result = decomposeUnrealized(lots, new Decimal(120), new Decimal('0.92'));
    expect(result.capitalBase.toString()).toBe('184');
    expect(result.forexBase.toString()).toBe('70');
  });

  it('returns zero when lots empty', () => {
    const result = decomposeUnrealized([], new Decimal(100), new Decimal(1));
    expect(result.capitalBase.toString()).toBe('0');
    expect(result.forexBase.toString()).toBe('0');
  });

  it('algebraic identity: capital + forex = mvBase - costBase', () => {
    const lots: Lot[] = [
      { date: '2026-01-01', shares: new Decimal(5), pricePerShare: new Decimal(100), totalCost: new Decimal(500), acquisitionRate: new Decimal('0.80'), costInBase: new Decimal(400) },
      { date: '2026-02-01', shares: new Decimal(7), pricePerShare: new Decimal(110), totalCost: new Decimal(770), acquisitionRate: new Decimal('0.85'), costInBase: new Decimal('654.5') },
    ];
    const currentPrice = new Decimal(125);
    const currentRate = new Decimal('0.90');
    const totalShares = new Decimal(12);
    const mvBase = totalShares.mul(currentPrice).mul(currentRate);
    const costBase = lots.reduce((s, l) => s.plus(l.costInBase!), new Decimal(0));
    const result = decomposeUnrealized(lots, currentPrice, currentRate);
    expect(result.capitalBase.plus(result.forexBase).toString()).toBe(mvBase.minus(costBase).toString());
  });

  it('produces signed components (loss + FX headwind)', () => {
    // Lot 10 shares @ 100 sec ccy @ rate 0.90. Current price 90 (loss), current rate 0.85 (FX headwind).
    // capital = 10 x (90 - 100) x 0.85 = -85
    // forex   = 10 x 100 x (0.85 - 0.90) = -50
    const lots: Lot[] = [{
      date: '2026-01-15',
      shares: new Decimal(10),
      pricePerShare: new Decimal(100),
      totalCost: new Decimal(1000),
      acquisitionRate: new Decimal('0.90'),
      costInBase: new Decimal(900),
    }];
    const result = decomposeUnrealized(lots, new Decimal(90), new Decimal('0.85'));
    expect(result.capitalBase.toString()).toBe('-85');
    expect(result.forexBase.toString()).toBe('-50');
  });
});
