import { describe, it, expect } from 'vitest';
import { mapPriceRows } from './csv-price-mapper';
import type { NormalizedPriceRow } from '@quovibe/shared';

const SECURITY_ID = 'sec-uuid-001';

function makeRow(overrides: Partial<NormalizedPriceRow> & { rowNumber?: number }): NormalizedPriceRow {
  return {
    rowNumber: overrides.rowNumber ?? 1,
    date: overrides.date ?? '2024-01-15',
    close: overrides.close ?? 100.0,
    high: overrides.high,
    low: overrides.low,
    volume: overrides.volume,
  };
}

describe('mapPriceRows', () => {
  describe('unit conversion', () => {
    it('converts close price to ×10^8 integer units (150.50 → 15050000000)', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ close: 150.5 })];
      const { prices, errors } = mapPriceRows(rows, SECURITY_ID);

      expect(errors).toHaveLength(0);
      expect(prices).toHaveLength(1);
      expect(prices[0].close).toBe(15050000000);
    });

    it('converts a whole-number close price correctly (100 → 10000000000)', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ close: 100 })];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices[0].close).toBe(10000000000);
    });

    it('converts small prices with many decimals accurately (0.00012345 → 12345)', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ close: 0.00012345 })];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices[0].close).toBe(12345);
    });
  });

  describe('OHLCV optional fields', () => {
    it('maps high and low when provided', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ close: 100, high: 110, low: 90 })];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices[0].high).toBe(11000000000);
      expect(prices[0].low).toBe(9000000000);
    });

    it('maps volume when provided (volume is NOT multiplied by 10^8)', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ close: 100, volume: 500000 })];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices[0].volume).toBe(500000);
    });

    it('omits high, low, volume fields when not provided', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ close: 100 })];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices[0].high).toBeUndefined();
      expect(prices[0].low).toBeUndefined();
      expect(prices[0].volume).toBeUndefined();
    });

    it('maps all OHLCV fields together', () => {
      const rows: NormalizedPriceRow[] = [
        makeRow({ close: 200.25, high: 205.75, low: 198.0, volume: 1234567 }),
      ];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices[0].close).toBe(20025000000);
      expect(prices[0].high).toBe(20575000000);
      expect(prices[0].low).toBe(19800000000);
      expect(prices[0].volume).toBe(1234567);
    });
  });

  describe('securityId propagation', () => {
    it('sets securityId on all mapped rows', () => {
      const rows: NormalizedPriceRow[] = [
        makeRow({ rowNumber: 1, close: 10 }),
        makeRow({ rowNumber: 2, close: 20 }),
        makeRow({ rowNumber: 3, close: 30 }),
      ];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices).toHaveLength(3);
      for (const p of prices) {
        expect(p.securityId).toBe(SECURITY_ID);
      }
    });
  });

  describe('date passthrough', () => {
    it('preserves the date string exactly', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ date: '2023-12-31', close: 42 })];
      const { prices } = mapPriceRows(rows, SECURITY_ID);

      expect(prices[0].date).toBe('2023-12-31');
    });
  });

  describe('validation — close <= 0', () => {
    it('rejects close=0 with INVALID_PRICE error and no price insert', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ rowNumber: 2, close: 0 })];
      const { prices, errors } = mapPriceRows(rows, SECURITY_ID);

      expect(prices).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        row: 2,
        column: 'close',
        value: '0',
        code: 'INVALID_PRICE',
      });
    });

    it('rejects negative close with INVALID_PRICE error', () => {
      const rows: NormalizedPriceRow[] = [makeRow({ rowNumber: 5, close: -10.5 })];
      const { prices, errors } = mapPriceRows(rows, SECURITY_ID);

      expect(prices).toHaveLength(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        row: 5,
        column: 'close',
        value: '-10.5',
        code: 'INVALID_PRICE',
      });
    });

    it('skips only invalid rows and still maps valid rows', () => {
      const rows: NormalizedPriceRow[] = [
        makeRow({ rowNumber: 1, close: 100 }),
        makeRow({ rowNumber: 2, close: 0 }),
        makeRow({ rowNumber: 3, close: -5 }),
        makeRow({ rowNumber: 4, close: 200 }),
      ];
      const { prices, errors } = mapPriceRows(rows, SECURITY_ID);

      expect(prices).toHaveLength(2);
      expect(prices[0].close).toBe(10000000000);
      expect(prices[1].close).toBe(20000000000);
      expect(errors).toHaveLength(2);
      expect(errors.map((e) => e.row)).toEqual([2, 3]);
    });
  });

  describe('empty input', () => {
    it('returns empty prices and errors for empty input', () => {
      const { prices, errors } = mapPriceRows([], SECURITY_ID);

      expect(prices).toHaveLength(0);
      expect(errors).toHaveLength(0);
    });
  });
});
