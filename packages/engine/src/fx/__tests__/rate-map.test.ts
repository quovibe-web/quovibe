// Reference: Exchange rate map — forward-fill for non-trading days (weekends, holidays)
// packages/engine/src/fx/__tests__/rate-map.test.ts
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { buildForwardFilledMap, getRateFromMap } from '../rate-map';

// ECB rate publication — business days only, forward-fill.
// Uses last known rate for weekends/holidays (no interpolation).

describe('buildForwardFilledMap', () => {
  test('forward-fills weekend with Friday rate', () => {
    const sparse = new Map<string, Decimal>([
      ['2024-03-15', new Decimal('0.6372')], // Friday
      ['2024-03-18', new Decimal('0.6149')], // Monday
    ]);
    const filled = buildForwardFilledMap(sparse, '2024-03-15', '2024-03-18');
    expect(getRateFromMap(filled, '2024-03-16')?.toString()).toBe('0.6372'); // Saturday
    expect(getRateFromMap(filled, '2024-03-17')?.toString()).toBe('0.6372'); // Sunday
    expect(getRateFromMap(filled, '2024-03-18')?.toString()).toBe('0.6149'); // Monday
  });

  test('forward-fills long holiday gap with last known rate', () => {
    const sparse = new Map<string, Decimal>([
      ['2024-03-15', new Decimal('1.0844')],
      ['2024-03-22', new Decimal('1.0901')],
    ]);
    const filled = buildForwardFilledMap(sparse, '2024-03-15', '2024-03-22');
    expect(getRateFromMap(filled, '2024-03-19')?.toString()).toBe('1.0844');
    expect(getRateFromMap(filled, '2024-03-20')?.toString()).toBe('1.0844');
    expect(getRateFromMap(filled, '2024-03-21')?.toString()).toBe('1.0844');
  });

  test('no backward-fill before first known rate', () => {
    const sparse = new Map<string, Decimal>([
      ['2024-03-05', new Decimal('0.6372')],
    ]);
    const filled = buildForwardFilledMap(sparse, '2024-03-03', '2024-03-07');
    expect(getRateFromMap(filled, '2024-03-03')).toBeNull();
    expect(getRateFromMap(filled, '2024-03-04')).toBeNull();
    expect(getRateFromMap(filled, '2024-03-05')?.toString()).toBe('0.6372');
    expect(getRateFromMap(filled, '2024-03-06')?.toString()).toBe('0.6372');
  });

  test('empty sparse map returns empty filled map', () => {
    const sparse = new Map<string, Decimal>();
    const filled = buildForwardFilledMap(sparse, '2024-03-01', '2024-03-05');
    expect(filled.size).toBe(0);
  });

  test('single day range', () => {
    const sparse = new Map<string, Decimal>([
      ['2024-03-15', new Decimal('0.6372')],
    ]);
    const filled = buildForwardFilledMap(sparse, '2024-03-15', '2024-03-15');
    expect(getRateFromMap(filled, '2024-03-15')?.toString()).toBe('0.6372');
  });
});

describe('getRateFromMap', () => {
  test('returns null for missing date', () => {
    const map = new Map<string, Decimal>();
    expect(getRateFromMap(map, '2024-03-15')).toBeNull();
  });

  test('returns exact rate when present', () => {
    const map = new Map<string, Decimal>([
      ['2024-03-15', new Decimal('0.6372')],
    ]);
    expect(getRateFromMap(map, '2024-03-15')?.toString()).toBe('0.6372');
  });
});

describe('same currency optimization', () => {
  test('same currency does not need a RateMap', () => {
    // When fromCurrency === toCurrency, buildRateMap is not called.
    // Engine consumer should check before lookup.
    // This test documents the convention.
    const empty = buildForwardFilledMap(new Map(), '2024-03-15', '2024-03-15');
    expect(empty.size).toBe(0);
  });
});
