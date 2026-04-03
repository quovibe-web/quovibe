// Reference: FX rate conversion — multiply convention (base × rate = quote)
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { convertToBase, invertRate } from '../converter';

// FX conversion — AUD→EUR multiply convention.
// Rate convention: multiply. AUD→EUR rate = 1/1.5693 = 0.6372

describe('convertToBase', () => {
  test('converts AUD to EUR using multiply convention', () => {
    // 100 AUD × 0.6372 (AUD→EUR) = 63.72 EUR
    const result = convertToBase(new Decimal('100'), new Decimal('0.6372'));
    expect(result.toDecimalPlaces(2).toString()).toBe('63.72');
  });

  test('zero amount returns zero', () => {
    expect(convertToBase(new Decimal('0'), new Decimal('0.9')).toString()).toBe('0');
  });

  test('rate = 1 returns same amount (same currency)', () => {
    expect(convertToBase(new Decimal('500'), new Decimal('1')).toString()).toBe('500');
  });
});

describe('invertRate', () => {
  test('inverts EUR/AUD rate to AUD/EUR', () => {
    // EUR/AUD = 1.5693 → AUD/EUR = 1/1.5693 = 0.63723...
    const result = invertRate(new Decimal('1.5693'));
    expect(result.toDecimalPlaces(5).toString()).toBe('0.63723');
  });
});
