// Engine regression: Multi-currency FX — synthetic fixtures
// Reference: docs/audit/engine-regression/reference-values.md Section G
// Note: all 17 securities in the DB are EUR → synthetic data required for FX tests
import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { buildForwardFilledMap, getRateFromMap, type RateMap } from '../../fx/rate-map';
import { computeCurrencyGains, type CurrencyGainsInput } from '../../fx/currency-gains';
import { convertAmount, invertRate } from '../../fx/converter';

const d = (v: string | number) => new Decimal(v);

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic FX fixture: EUR/USD rates over a 2-week period
// Simulates ECB data (business days only, no weekends/holidays)
//
// Mon 2025-01-06: 1.0350  (first known rate)
// Tue 2025-01-07: 1.0380
// Wed 2025-01-08: 1.0375
// Thu 2025-01-09: (missing — holiday)
// Fri 2025-01-10: 1.0420
// Sat 2025-01-11: (weekend)
// Sun 2025-01-12: (weekend)
// Mon 2025-01-13: 1.0400
// ─────────────────────────────────────────────────────────────────────────────

const SPARSE_RATES: RateMap = new Map([
  ['2025-01-06', d('1.0350')],
  ['2025-01-07', d('1.0380')],
  ['2025-01-08', d('1.0375')],
  // 2025-01-09: missing (holiday)
  ['2025-01-10', d('1.0420')],
  // 2025-01-11, 2025-01-12: weekend
  ['2025-01-13', d('1.0400')],
]);

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic security for currency gain tests:
// US stock bought in USD, portfolio base = EUR
// BUY: 100 shares @ $50.00 USD on 2025-01-06, rate = 1.0350
// Current: 100 shares @ $52.00 USD on 2025-01-13, rate = 1.0400
// ─────────────────────────────────────────────────────────────────────────────

const FX_GAIN_INPUT: CurrencyGainsInput = {
  nativeValue: d('5200'),   // 100 × $52.00
  nativeCost: d('5000'),    // 100 × $50.00
  purchaseRate: d('1.0350'),
  currentRate: d('1.0400'),
};

describe('GROUP B — Multi-Currency FX Regression', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // R6.1 — Forward-fill: weekend/holiday rates carry forward the last known rate
  // ───────────────────────────────────────────────────────────────────────────
  describe('R6.1 — forward-fill carries last known rate', () => {
    test('Thursday holiday (2025-01-09) carries Wednesday rate 1.0375', () => {
      const filled = buildForwardFilledMap(SPARSE_RATES, '2025-01-06', '2025-01-13');
      const thursdayRate = getRateFromMap(filled, '2025-01-09');

      expect(thursdayRate).not.toBeNull();
      expect(thursdayRate!.toNumber()).toBe(1.0375);
    });

    test('Saturday (2025-01-11) carries Friday rate 1.0420', () => {
      const filled = buildForwardFilledMap(SPARSE_RATES, '2025-01-06', '2025-01-13');
      const saturdayRate = getRateFromMap(filled, '2025-01-11');

      expect(saturdayRate).not.toBeNull();
      expect(saturdayRate!.toNumber()).toBe(1.0420);
    });

    test('Sunday (2025-01-12) carries Friday rate 1.0420', () => {
      const filled = buildForwardFilledMap(SPARSE_RATES, '2025-01-06', '2025-01-13');
      const sundayRate = getRateFromMap(filled, '2025-01-12');

      expect(sundayRate).not.toBeNull();
      expect(sundayRate!.toNumber()).toBe(1.0420);
    });

    test('all 8 days in range have a rate after forward-fill', () => {
      const filled = buildForwardFilledMap(SPARSE_RATES, '2025-01-06', '2025-01-13');
      expect(filled.size).toBe(8); // 8 calendar days inclusive
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R6.2 — No backward-fill: date before first known rate → no entry
  // ───────────────────────────────────────────────────────────────────────────
  describe('R6.2 — no backward-fill before first known rate', () => {
    test('date before first rate (2025-01-03) has no entry', () => {
      // Start the range 3 days before the first known rate
      const filled = buildForwardFilledMap(SPARSE_RATES, '2025-01-03', '2025-01-13');

      // 2025-01-03, 04, 05 should have no rate (before first known 2025-01-06)
      expect(getRateFromMap(filled, '2025-01-03')).toBeNull();
      expect(getRateFromMap(filled, '2025-01-04')).toBeNull();
      expect(getRateFromMap(filled, '2025-01-05')).toBeNull();
    });

    test('first known date (2025-01-06) has a rate', () => {
      const filled = buildForwardFilledMap(SPARSE_RATES, '2025-01-03', '2025-01-13');
      const rate = getRateFromMap(filled, '2025-01-06');

      expect(rate).not.toBeNull();
      expect(rate!.toNumber()).toBe(1.0350);
    });

    test('empty sparse map → empty filled map', () => {
      const empty: RateMap = new Map();
      const filled = buildForwardFilledMap(empty, '2025-01-06', '2025-01-13');

      expect(filled.size).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R6.3 — priceGain = (nativeValue - nativeCost) × currentRate
  // ───────────────────────────────────────────────────────────────────────────
  describe('R6.3 — priceGain computation', () => {
    test('priceGain = (5200 - 5000) × 1.0400 = 208.00', () => {
      const result = computeCurrencyGains(FX_GAIN_INPUT);

      // priceGain = (5200 - 5000) × 1.0400 = 200 × 1.0400 = 208.00
      expect(result.priceGain.toNumber()).toBeCloseTo(208.0, 2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R6.4 — currencyEffect = nativeCost × (currentRate - purchaseRate)
  // ───────────────────────────────────────────────────────────────────────────
  describe('R6.4 — currencyEffect computation', () => {
    test('currencyEffect = 5000 × (1.0400 - 1.0350) = 25.00', () => {
      const result = computeCurrencyGains(FX_GAIN_INPUT);

      // currencyEffect = 5000 × 0.005 = 25.00
      expect(result.currencyEffect.toNumber()).toBeCloseTo(25.0, 2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R6.5 — totalGain = priceGain + currencyEffect
  // ───────────────────────────────────────────────────────────────────────────
  describe('R6.5 — totalGain = priceGain + currencyEffect', () => {
    test('totalGain = 208.00 + 25.00 = 233.00', () => {
      const result = computeCurrencyGains(FX_GAIN_INPUT);

      // totalGain = nativeValue × currentRate - nativeCost × purchaseRate
      // = 5200 × 1.0400 - 5000 × 1.0350 = 5408 - 5175 = 233.00
      expect(result.totalGain.toNumber()).toBeCloseTo(233.0, 2);
    });

    test('decomposition invariant: totalGain ≡ priceGain + currencyEffect', () => {
      const result = computeCurrencyGains(FX_GAIN_INPUT);

      const sum = result.priceGain.plus(result.currencyEffect);
      // Must be exactly equal (Decimal arithmetic, no floating-point drift)
      expect(result.totalGain.eq(sum)).toBe(true);
    });

    test('negative FX effect: rate depreciates', () => {
      // Same security but rate dropped from 1.0350 to 1.0200
      const input: CurrencyGainsInput = {
        nativeValue: d('5200'),
        nativeCost: d('5000'),
        purchaseRate: d('1.0350'),
        currentRate: d('1.0200'),
      };
      const result = computeCurrencyGains(input);

      // priceGain = 200 × 1.0200 = 204.00
      expect(result.priceGain.toNumber()).toBeCloseTo(204.0, 2);
      // currencyEffect = 5000 × (1.0200 - 1.0350) = 5000 × (-0.015) = -75.00
      expect(result.currencyEffect.toNumber()).toBeCloseTo(-75.0, 2);
      // totalGain = 204 + (-75) = 129.00
      expect(result.totalGain.toNumber()).toBeCloseTo(129.0, 2);
      // Invariant holds
      expect(result.totalGain.eq(result.priceGain.plus(result.currencyEffect))).toBe(true);
    });

    test('zero price change: totalGain = pure currency effect', () => {
      // nativeValue = nativeCost (no price movement)
      const input: CurrencyGainsInput = {
        nativeValue: d('5000'),
        nativeCost: d('5000'),
        purchaseRate: d('1.0350'),
        currentRate: d('1.0400'),
      };
      const result = computeCurrencyGains(input);

      // priceGain = 0 × 1.04 = 0
      expect(result.priceGain.toNumber()).toBe(0);
      // currencyEffect = 5000 × 0.005 = 25
      expect(result.currencyEffect.toNumber()).toBeCloseTo(25.0, 2);
      // totalGain = currencyEffect only
      expect(result.totalGain.eq(result.currencyEffect)).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R6.6 — invertRate(0) throws (defensive guard)
  // ───────────────────────────────────────────────────────────────────────────
  describe('R6.6 — invertRate(0) throws', () => {
    test('invertRate(0) throws "Cannot invert zero rate"', () => {
      expect(() => invertRate(d(0))).toThrow('Cannot invert zero rate');
    });

    test('invertRate with valid rate succeeds', () => {
      const inverted = invertRate(d('1.0350'));
      // 1 / 1.0350 ≈ 0.96618...
      expect(inverted.toNumber()).toBeCloseTo(1 / 1.035, 6); // native-ok
    });

    test('invertRate round-trip: invert(invert(r)) ≈ r', () => {
      const rate = d('1.0350');
      const roundTrip = invertRate(invertRate(rate));
      // Decimal precision should give us a very close round-trip
      expect(roundTrip.minus(rate).abs().lt(d('1e-20'))).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // R6.7 — convertAmount(amount, 0, 'divide') throws
  // ───────────────────────────────────────────────────────────────────────────
  describe('R6.7 — convertAmount division by zero throws', () => {
    test('convertAmount(100, 0, "divide") throws "Cannot divide by zero rate"', () => {
      expect(() => convertAmount(d(100), d(0), 'divide')).toThrow(
        'Cannot divide by zero rate',
      );
    });

    test('convertAmount(100, 0, "multiply") does NOT throw (result = 0)', () => {
      // Multiply by zero is valid (just returns 0)
      const result = convertAmount(d(100), d(0), 'multiply');
      expect(result.toNumber()).toBe(0);
    });

    test('convertAmount with valid rate: multiply and divide', () => {
      const amount = d('5000');
      const rate = d('1.0400');

      const multiplied = convertAmount(amount, rate, 'multiply');
      expect(multiplied.toNumber()).toBeCloseTo(5200, 2);

      const divided = convertAmount(amount, rate, 'divide');
      expect(divided.toNumber()).toBeCloseTo(4807.6923, 2);
    });
  });
});
