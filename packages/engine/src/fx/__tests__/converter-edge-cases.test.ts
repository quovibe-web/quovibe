// Reference: FX rate conversion edge cases — zero rate, inversion, rounding
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { invertRate, convertAmount } from '../converter';

// Exchange rates must be positive real numbers

describe('invertRate — zero rate guard', () => {
  test('invertRate(0) throws descriptive error', () => {
    expect(() => invertRate(new Decimal('0'))).toThrow('Cannot invert zero rate');
  });

  test('invertRate(positive) works normally', () => {
    const result = invertRate(new Decimal('1.5693'));
    expect(result.toDecimalPlaces(5).toString()).toBe('0.63723');
  });
});

describe('convertAmount — zero rate guard for divide direction', () => {
  test('divide by zero rate throws', () => {
    expect(() =>
      convertAmount(new Decimal('100'), new Decimal('0'), 'divide'),
    ).toThrow('Cannot divide by zero rate');
  });

  test('multiply by zero rate returns 0 (valid)', () => {
    const result = convertAmount(new Decimal('100'), new Decimal('0'), 'multiply');
    expect(result.toString()).toBe('0');
  });

  test('divide by positive rate works normally', () => {
    // 100 / 1.5 = 66.6666...
    const result = convertAmount(new Decimal('100'), new Decimal('1.5'), 'divide');
    expect(result.toDecimalPlaces(4).toString()).toBe('66.6667');
  });
});
