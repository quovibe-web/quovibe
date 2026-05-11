// packages/shared/src/csv/csv-fx.test.ts
import { describe, it, expect } from 'vitest';
import { ppRateToQvRate, verifyGrossRateValue } from './csv-fx';

describe('ppRateToQvRate', () => {
  it('inverts a positive rate', () => {
    expect(ppRateToQvRate(2)).toBe(0.5);
    expect(ppRateToQvRate(0.5)).toBe(2);
  });

  it('returns null for zero', () => {
    expect(ppRateToQvRate(0)).toBeNull();
  });

  it('returns null for negative rates', () => {
    expect(ppRateToQvRate(-1)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(ppRateToQvRate(NaN)).toBeNull();
  });

  it('returns null for non-finite values', () => {
    expect(ppRateToQvRate(Infinity)).toBeNull();
    expect(ppRateToQvRate(-Infinity)).toBeNull();
  });

  it('round-trips through reciprocal at typical EUR/USD scale', () => {
    const ppRate = 1.0837;
    const qv = ppRateToQvRate(ppRate);
    expect(qv).not.toBeNull();
    // qv * wire === 1 within float tolerance
    expect(qv! * ppRate).toBeCloseTo(1, 12);
  });
});

describe('verifyGrossRateValue', () => {
  it('accepts canonical dividend fixture (15 USD × 0.5 = 7.5 EUR)', () => {
    expect(verifyGrossRateValue(15, 0.5, 7.5)).toBe(true);
  });

  it('accepts canonical BUY fixture (1606.71 USD × 1.0837 ≈ 1740.99 EUR)', () => {
    // value tolerance covers 4-decimal rate × 2-decimal amount rounding
    expect(verifyGrossRateValue(1606.71, 1.0837, 1740.99)).toBe(true);
  });

  it('rejects when Value is far from Gross × Rate', () => {
    // gross 15 USD × 0.5 → 7.5 EUR, supplied Value 7.6 EUR; diff 0.1 / max(7.6,1) ≈ 1.3 % > 0.05 %
    expect(verifyGrossRateValue(15, 0.5, 7.6)).toBe(false);
  });

  it('rejects on direction error (rate inverted)', () => {
    // Same numbers but rate inverted (2 instead of 0.5) yields gross×rate = 30, not 7.5
    expect(verifyGrossRateValue(15, 2, 7.5)).toBe(false);
  });

  it('respects custom tolerance', () => {
    // gross×rate = 7.5; value = 7.6; diff/max = 0.1/7.6 ≈ 1.3 %.
    // tolerance 2 % accepts; default 0.05 % rejects.
    expect(verifyGrossRateValue(15, 0.5, 7.6, 0.02)).toBe(true);
  });

  it('rejects NaN inputs', () => {
    expect(verifyGrossRateValue(NaN, 0.5, 7.5)).toBe(false);
    expect(verifyGrossRateValue(15, NaN, 7.5)).toBe(false);
    expect(verifyGrossRateValue(15, 0.5, NaN)).toBe(false);
  });

  it('uses denominator floor of 1 to avoid zero-denominator collapse', () => {
    // value=0, gross=0 → diff=0, tolerance × max(0,1)=tolerance × 1 → accepts
    expect(verifyGrossRateValue(0, 1, 0)).toBe(true);
    // value=0, gross=0.001 × rate=1 = 0.001; tolerance=0.0005 × 1 = 0.0005; 0.001 > 0.0005
    expect(verifyGrossRateValue(0.001, 1, 0)).toBe(false);
  });
});
