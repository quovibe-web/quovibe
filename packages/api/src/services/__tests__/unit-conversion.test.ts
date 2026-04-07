import { describe, test, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  safeDecimal,
  convertTransactionFromDb,
  convertTransactionToDb,
  convertPriceFromDb,
  convertPriceToDb,
} from '../unit-conversion';

describe('Conversione unità ppxml2db ↔ reale', () => {
  describe('safeDecimal', () => {
    test('avoids floating-point artifacts', () => {
      // 0.1 + 0.2 in JS = 0.30000000000000004
      const result = safeDecimal(0.1 + 0.2);
      expect(result.toNumber()).toBe(0.3);
    });
  });

  describe('shares (×10^8)', () => {
    test('round-trip: toDb(fromDb(x)) === x', () => {
      const dbValue = 1_000_000_000;
      const converted = convertTransactionFromDb({ shares: dbValue, amount: null });
      const back = convertTransactionToDb({ shares: converted.shares });
      expect(back.shares).toBe(dbValue);
    });

    test('fromDb: 1_000_000_000 → 10 shares', () => {
      const { shares } = convertTransactionFromDb({ shares: 1_000_000_000, amount: null });
      expect(shares!.toNumber()).toBe(10);
    });

    test('fromDb: 100_000_000 → 1 share', () => {
      const { shares } = convertTransactionFromDb({ shares: 100_000_000, amount: null });
      expect(shares!.toNumber()).toBe(1);
    });

    test('fromDb: 50_000_000 → 0.5 shares', () => {
      const { shares } = convertTransactionFromDb({ shares: 50_000_000, amount: null });
      expect(shares!.toNumber()).toBe(0.5);
    });

    test('fromDb: 0 → 0', () => {
      const { shares } = convertTransactionFromDb({ shares: 0, amount: null });
      expect(shares!.toNumber()).toBe(0);
    });

    test('fromDb: null → null', () => {
      const { shares } = convertTransactionFromDb({ shares: null, amount: null });
      expect(shares).toBeNull();
    });
  });

  describe('amounts (×10^2)', () => {
    test('round-trip: toDb(fromDb(x)) === x', () => {
      const dbValue = 150075; // 1500.75
      const converted = convertTransactionFromDb({ shares: null, amount: dbValue });
      const back = convertTransactionToDb({ amount: converted.amount });
      expect(back.amount).toBe(dbValue);
    });

    test('fromDb: 150075 → 1500.75', () => {
      const { amount } = convertTransactionFromDb({ shares: null, amount: 150075 });
      expect(amount!.toNumber()).toBe(1500.75);
    });

    test('fromDb: null → null', () => {
      const { amount } = convertTransactionFromDb({ shares: null, amount: null });
      expect(amount).toBeNull();
    });
  });

  describe('prezzi (×10^8)', () => {
    test('round-trip: toDb(fromDb(x)) === x', () => {
      const dbValue = 1894600000;
      const converted = convertPriceFromDb({ close: dbValue });
      const back = convertPriceToDb({ close: converted.close });
      expect(back.close).toBe(dbValue);
    });

    test('fromDb: 1894600000 → 18.946', () => {
      const { close } = convertPriceFromDb({ close: 1894600000 });
      expect(close.toNumber()).toBe(18.946);
    });

    test('fromDb: 11000000000 → 110', () => {
      const { close } = convertPriceFromDb({ close: 11000000000 });
      expect(close.toNumber()).toBe(110);
    });

    test('high/low null → null', () => {
      const result = convertPriceFromDb({ close: 1e8, high: null, low: null });
      expect(result.high).toBeNull();
      expect(result.low).toBeNull();
    });

    test('high/low values convert correctly', () => {
      const result = convertPriceFromDb({ close: 1e8, high: 1.2e8, low: 0.8e8 });
      expect(result.high!.toNumber()).toBe(1.2);
      expect(result.low!.toNumber()).toBe(0.8);
    });

    test('convertPriceFromDb includes open when present', () => {
      const result = convertPriceFromDb({ close: 1e8, open: 1.1e8 });
      expect(result.open).not.toBeNull();
      expect(result.open!.toNumber()).toBeCloseTo(1.1, 6);
    });

    test('convertPriceFromDb returns null open when absent', () => {
      const result = convertPriceFromDb({ close: 1e8 });
      expect(result.open).toBeNull();
    });

    test('convertPriceToDb includes open when present', () => {
      const result = convertPriceToDb({ close: new Decimal('1.0'), open: new Decimal('1.1') });
      expect(result.open).toBe(110000000);
    });
  });

  describe('unit-conversion integer guarantee', () => {
    it('convertPriceToDb produces integer close', () => {
      const result = convertPriceToDb({ close: new Decimal('0.00000001') });
      expect(Number.isInteger(result.close)).toBe(true);
      expect(result.close).toBe(1);
    });

    it('convertTransactionToDb produces integer shares and amount', () => {
      const result = convertTransactionToDb({
        shares: new Decimal('10.5'),
        amount: new Decimal('1500.005'),
      });
      expect(Number.isInteger(result.shares)).toBe(true);
      expect(Number.isInteger(result.amount)).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('valore molto piccolo (crypto)', () => {
      const { close } = convertPriceFromDb({ close: 1 });
      expect(close.toNumber()).toBe(0.00000001);
    });

    test('valore molto grande (BRK-A)', () => {
      const { close } = convertPriceFromDb({ close: 60000000000000 });
      expect(close.toNumber()).toBe(600000);
    });

    test('round-trip preserva precisione per prezzi', () => {
      const dbValue = 1894600000;
      const converted = convertPriceFromDb({ close: dbValue });
      const back = convertPriceToDb({ close: converted.close });
      expect(back.close).toBe(dbValue);
    });

    test('round-trip preserva precisione per shares frazionari', () => {
      const dbValue = 123456789; // 1.23456789 shares
      const converted = convertTransactionFromDb({ shares: dbValue, amount: null });
      const back = convertTransactionToDb({ shares: converted.shares });
      expect(back.shares).toBe(dbValue);
    });

    test('round-trip preserva precisione per amount con centesimi', () => {
      const dbValue = 999999; // 9999.99
      const converted = convertTransactionFromDb({ shares: null, amount: dbValue });
      const back = convertTransactionToDb({ amount: converted.amount });
      expect(back.amount).toBe(dbValue);
    });
  });
});
