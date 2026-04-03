// Reference: Currency gain/loss edge cases — zero position, same currency, missing rate
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { computeCashCurrencyGain, computeCurrencyGains } from '../currency-gains';

// FX gain/loss decomposition — edge cases (multiply convention)

/**
 * A2: Cash FX gain (positive direction)
 * Existing tests only cover the loss case (AUD depreciating against EUR).
 * This tests the gain case: AUD appreciates against EUR.
 */
describe('A2: computeCashCurrencyGain — positive FX gain', () => {
  test('400 AUD cash: gain when AUD appreciates against EUR', () => {
    // Balance = 400 AUD
    // rateStart = 0.6149 (AUD→EUR at period start, AUD weaker)
    // rateEnd   = 0.6372 (AUD→EUR at period end, AUD stronger)
    // gain = 400 × (0.6372 − 0.6149) = 400 × 0.0223 = +8.92 EUR
    const balance = new Decimal('400');
    const rateStart = new Decimal('0.6149');
    const rateEnd = new Decimal('0.6372');

    const gain = computeCashCurrencyGain(balance, rateStart, rateEnd);

    expect(gain.toDecimalPlaces(2).toNumber()).toBe(8.92);
    expect(gain.isPositive()).toBe(true);
  });

  test('symmetry: gain is opposite sign of loss with swapped rates', () => {
    const balance = new Decimal('400');
    const rateA = new Decimal('0.6149');
    const rateB = new Decimal('0.6372');

    const gain = computeCashCurrencyGain(balance, rateA, rateB);
    const loss = computeCashCurrencyGain(balance, rateB, rateA);

    // gain + loss should be exactly 0 (perfect symmetry)
    expect(gain.plus(loss).toString()).toBe('0');
  });
});

/**
 * A3: Missing exchange rate downstream behavior
 * Forward-fill is tested in rate-map.test.ts.
 * Here we test the DOWNSTREAM impact: what happens when
 * computeCashCurrencyGain receives a zero rate (missing/unfilled).
 */
describe('A3: computeCashCurrencyGain — missing rate downstream (no NaN)', () => {
  test('rateEnd = 0 produces a deterministic result, not NaN', () => {
    const balance = new Decimal('400');
    const rateStart = new Decimal('0.6372');
    const rateEnd = new Decimal('0'); // missing rate → 0

    const result = computeCashCurrencyGain(balance, rateStart, rateEnd);

    // 400 × (0 − 0.6372) = −254.88 (deterministic, not NaN)
    expect(result.isNaN()).toBe(false);
    expect(result.isFinite()).toBe(true);
    expect(result.toDecimalPlaces(2).toNumber()).toBe(-254.88);
  });

  test('rateStart = 0 produces a deterministic result, not NaN', () => {
    const balance = new Decimal('400');
    const rateStart = new Decimal('0'); // missing rate → 0
    const rateEnd = new Decimal('0.6149');

    const result = computeCashCurrencyGain(balance, rateStart, rateEnd);

    // 400 × (0.6149 − 0) = +245.96 (deterministic, not NaN)
    expect(result.isNaN()).toBe(false);
    expect(result.isFinite()).toBe(true);
    expect(result.toDecimalPlaces(2).toNumber()).toBe(245.96);
  });

  test('both rates = 0 produces zero gain, not NaN', () => {
    const balance = new Decimal('400');
    const result = computeCashCurrencyGain(
      balance,
      new Decimal('0'),
      new Decimal('0'),
    );

    expect(result.isNaN()).toBe(false);
    expect(result.toString()).toBe('0');
  });
});

/**
 * A4: Blended rate = period-start rate (not weighted average)
 *
 * Currency effect is decomposed using the purchase rate (period-start rate),
 * NOT a weighted average. This test verifies the correct decomposition.
 */
describe('A4: computeCurrencyGains — uses period-start rate, not weighted avg', () => {
  test('currencyEffect uses purchaseRate, not weighted average', () => {
    // 100 AUD position
    // purchaseRate = 0.6200 (period start)
    // currentRate  = 0.5882 (period end)
    // Hypothetical weighted avg rate = 0.6436 (must NOT be used)
    const nativeCost = new Decimal('100');
    const nativeValue = new Decimal('100'); // unchanged price for isolation
    const purchaseRate = new Decimal('0.6200');
    const currentRate = new Decimal('0.5882');
    const weightedAvgRate = new Decimal('0.6436'); // wrong rate

    const result = computeCurrencyGains({
      nativeCost,
      nativeValue,
      purchaseRate,
      currentRate,
    });

    // Correct: currencyEffect = 100 × (0.5882 − 0.6200) = 100 × (−0.0318) = −3.18
    const expectedCorrect = nativeCost.mul(currentRate.minus(purchaseRate));
    expect(result.currencyEffect.toDecimalPlaces(2).toNumber()).toBe(-3.18);
    expect(result.currencyEffect.toDecimalPlaces(2).toString()).toBe(
      expectedCorrect.toDecimalPlaces(2).toString(),
    );

    // Wrong (weighted avg): 100 × (0.5882 − 0.6436) = −5.54
    const wrongEffect = nativeCost.mul(currentRate.minus(weightedAvgRate));
    expect(wrongEffect.toDecimalPlaces(2).toNumber()).toBe(-5.54);

    // Verify they are different
    expect(result.currencyEffect.toDecimalPlaces(2).toString()).not.toBe(
      wrongEffect.toDecimalPlaces(2).toString(),
    );
  });

  test('decomposition identity holds: priceGain + currencyEffect = totalGain', () => {
    const result = computeCurrencyGains({
      nativeCost: new Decimal('100'),
      nativeValue: new Decimal('110'),
      purchaseRate: new Decimal('0.6200'),
      currentRate: new Decimal('0.5882'),
    });

    const sum = result.priceGain.plus(result.currencyEffect);
    expect(sum.toDecimalPlaces(4).toString()).toBe(
      result.totalGain.toDecimalPlaces(4).toString(),
    );
  });
});
