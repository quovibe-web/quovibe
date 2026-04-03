// Reference: Currency gain/loss decomposition — price gain vs. exchange rate gain
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeCurrencyGains, computeCashCurrencyGain } from '../currency-gains';

// FX gain/loss decomposition — AUD security example.
// Purchase: 100 AUD, rate AUD→EUR = 0.6372 (1 EUR = 1.5693 AUD)
// Valuation: 75 AUD, rate AUD→EUR = 0.6149 (1 EUR = 1.6263 AUD)

describe('computeCurrencyGains — AUD example', () => {
  const result = computeCurrencyGains({
    nativeValue: new Decimal('75'),
    nativeCost: new Decimal('100'),
    purchaseRate: new Decimal('0.6372'),
    currentRate: new Decimal('0.6149'),
  });

  test('totalGain matches expected: -17.60 EUR', () => {
    // 75 × 0.6149 − 100 × 0.6372 = 46.1175 − 63.72 = −17.6025
    expect(result.totalGain.toDecimalPlaces(2).toNumber()).toBeCloseTo(-17.60, 1);
  });

  test('priceGain: pure price change at current rate', () => {
    // (75 − 100) × 0.6149 = −25 × 0.6149 = −15.3725
    expect(result.priceGain.toDecimalPlaces(2).toNumber()).toBeCloseTo(-15.37, 1);
  });

  test('currencyEffect on cost basis: -2.23 EUR', () => {
    // 100 × (0.6149 − 0.6372) = 100 × (−0.0223) = −2.23
    expect(result.currencyEffect.toDecimalPlaces(2).toNumber()).toBeCloseTo(-2.23, 1);
  });

  test('priceGain + currencyEffect = totalGain', () => {
    const sum = result.priceGain.plus(result.currencyEffect);
    expect(sum.toDecimalPlaces(4).toString()).toBe(result.totalGain.toDecimalPlaces(4).toString());
  });
});

describe('computeCurrencyGains — same currency', () => {
  test('no FX effect when rates are equal', () => {
    const result = computeCurrencyGains({
      nativeValue: new Decimal('1200'),
      nativeCost: new Decimal('1000'),
      purchaseRate: new Decimal('1'),
      currentRate: new Decimal('1'),
    });
    expect(result.currencyEffect.toString()).toBe('0');
    expect(result.totalGain.toString()).toBe('200');
    expect(result.priceGain.toString()).toBe('200');
  });
});

describe('computeCurrencyGains — rate unchanged', () => {
  test('no FX effect when rate does not move', () => {
    const result = computeCurrencyGains({
      nativeValue: new Decimal('120'),
      nativeCost: new Decimal('100'),
      purchaseRate: new Decimal('0.92'),
      currentRate: new Decimal('0.92'),
    });
    expect(result.currencyEffect.toString()).toBe('0');
  });
});

// FX gain/loss on cash balance — AUD deposit example.
// With multiply convention: 400 × (0.6149 − 0.6372) = −8.92

describe('computeCashCurrencyGain — AUD cash example', () => {
  test('cash FX loss on AUD deposit', () => {
    const result = computeCashCurrencyGain(
      new Decimal('400'),
      new Decimal('0.6372'),  // rateStart (AUD→EUR)
      new Decimal('0.6149'),  // rateEnd (AUD→EUR)
    );
    // 400 × (0.6149 − 0.6372) = 400 × −0.0223 = −8.92
    expect(result.toDecimalPlaces(2).toNumber()).toBeCloseTo(-8.92, 0);
  });

  test('zero balance → zero gain', () => {
    const result = computeCashCurrencyGain(
      new Decimal('0'),
      new Decimal('0.6372'),
      new Decimal('0.6149'),
    );
    expect(result.toString()).toBe('0');
  });
});

// FX gain/loss decomposition — AUD share using reciprocal rates.
// currencyEffect = nativeCost × (currentRate − purchaseRate)
// Uses reciprocal rates: purchaseRate = 1/1.5693, currentRate = 1/1.6263
describe('computeCurrencyGains — AUD share using reciprocal rates (test 8)', () => {
  const purchaseRate = new Decimal(1).div(new Decimal('1.5693'));
  const currentRate = new Decimal(1).div(new Decimal('1.6263'));
  const nativeCost = new Decimal('100');
  const nativeValue = new Decimal('75');

  const result = computeCurrencyGains({
    nativeCost,
    nativeValue,
    purchaseRate,
    currentRate,
  });

  test('currencyEffect matches formula: nativeCost × (currentRate − purchaseRate)', () => {
    const expectedCurrencyEffect = nativeCost.mul(currentRate.minus(purchaseRate));
    expect(result.currencyEffect.toFixed(2)).toBe(expectedCurrencyEffect.toFixed(2));
  });

  test('totalGain matches formula: nativeValue × currentRate − nativeCost × purchaseRate', () => {
    const expectedTotal = nativeValue.mul(currentRate).minus(nativeCost.mul(purchaseRate));
    expect(result.totalGain.toFixed(2)).toBe(expectedTotal.toFixed(2));
  });

  test('priceGain + currencyEffect = totalGain (decomposition identity)', () => {
    expect(result.priceGain.plus(result.currencyEffect).toFixed(2)).toBe(result.totalGain.toFixed(2));
  });
});

// FX gain/loss on cash balance — reciprocal rates
describe('computeCashCurrencyGain — 400 AUD cash example using reciprocal rates (test 9)', () => {
  test('400 AUD cash: loss computed via reciprocal rates, result is negative', () => {
    const balance = new Decimal('400');
    const rateStart = new Decimal(1).div(new Decimal('1.5693'));
    const rateEnd = new Decimal(1).div(new Decimal('1.6263'));

    const gain = computeCashCurrencyGain(balance, rateStart, rateEnd);

    const expected = balance.mul(rateEnd.minus(rateStart));
    expect(gain.toFixed(2)).toBe(expected.toFixed(2));
    expect(gain.isNegative()).toBe(true);
  });
});

// FX conversion — EUR/USD example
describe('computeCurrencyGains — price up + FX positive (USD→EUR)', () => {
  // Buy 10 × $100 at USD→EUR = 0.9091 (EUR/USD = 1.10)
  // Now: $120, USD→EUR = 0.9524 (EUR/USD = 1.05)
  const result = computeCurrencyGains({
    nativeValue: new Decimal('1200'),  // 10 × $120
    nativeCost: new Decimal('1000'),   // 10 × $100
    purchaseRate: new Decimal('0.9091'),
    currentRate: new Decimal('0.9524'),
  });

  test('totalGain ≈ 233.78 EUR', () => {
    // 1200 × 0.9524 − 1000 × 0.9091 = 1142.88 − 909.10 = 233.78
    expect(result.totalGain.toDecimalPlaces(0).toNumber()).toBeCloseTo(234, 0);
  });

  test('priceGain ≈ 190.48 EUR', () => {
    // (1200 − 1000) × 0.9524 = 200 × 0.9524 = 190.48
    expect(result.priceGain.toDecimalPlaces(2).toNumber()).toBeCloseTo(190.48, 1);
  });

  test('currencyEffect ≈ 43.30 EUR', () => {
    // 1000 × (0.9524 − 0.9091) = 1000 × 0.0433 = 43.30
    expect(result.currencyEffect.toDecimalPlaces(1).toNumber()).toBeCloseTo(43.3, 0);
  });
});
