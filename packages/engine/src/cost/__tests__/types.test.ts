// Reference: Lot type — per-lot cost basis with optional acquisition-rate FX tracking
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import type { Lot, ConsumedLotSlice } from '../types';

describe('Lot type extensions', () => {
  it('accepts optional acquisitionRate + costInBase fields', () => {
    const lot: Lot = {
      date: '2026-01-15',
      shares: new Decimal(10),
      pricePerShare: new Decimal(100),
      totalCost: new Decimal(1000),
      acquisitionRate: new Decimal('0.85'),
      costInBase: new Decimal(850),
    };
    expect(lot.acquisitionRate?.toString()).toBe('0.85');
    expect(lot.costInBase?.toString()).toBe('850');
  });

  it('accepts Lot without base fields (backward-compat)', () => {
    const lot: Lot = {
      date: '2026-01-15',
      shares: new Decimal(10),
      pricePerShare: new Decimal(100),
      totalCost: new Decimal(1000),
    };
    expect(lot.acquisitionRate).toBeUndefined();
    expect(lot.costInBase).toBeUndefined();
  });

  it('ConsumedLotSlice carries lot rate forward', () => {
    const slice: ConsumedLotSlice = {
      shares: new Decimal(3),
      lotPricePerShare: new Decimal(100),
      lotAcquisitionRate: new Decimal('0.85'),
    };
    expect(slice.lotAcquisitionRate?.toString()).toBe('0.85');
  });
});
