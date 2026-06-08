import { describe, it, expect } from 'vitest';
import { manualPriceSchema, deletePricesSchema } from './manual-price.schema';

describe('manualPriceSchema', () => {
  it('accepts a minimal valid price (date + value only)', () => {
    const r = manualPriceSchema.safeParse({ date: '2025-03-14', value: '101.25' });
    expect(r.success).toBe(true);
  });

  it('accepts optional OHLCV', () => {
    const r = manualPriceSchema.safeParse({
      date: '2025-03-14', value: '101.25',
      open: '100', high: '102', low: '99.5', volume: 1500,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a future date (PP allows it)', () => {
    const r = manualPriceSchema.safeParse({ date: '2099-01-01', value: '5' });
    expect(r.success).toBe(true);
  });

  it('rejects a malformed date', () => {
    expect(manualPriceSchema.safeParse({ date: '14/03/2025', value: '1' }).success).toBe(false);
  });

  it('rejects a non-positive value', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: '0' }).success).toBe(false);
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: '-1' }).success).toBe(false);
  });

  it('rejects a non-numeric value', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: 'abc' }).success).toBe(false);
  });

  it('rejects a leading-zero value', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: '00.5' }).success).toBe(false);
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: '001' }).success).toBe(false);
  });

  it('accepts a plain decimal and a plain integer (no over-tightening)', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: '0.5' }).success).toBe(true);
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: '100' }).success).toBe(true);
  });

  it('rejects a negative volume', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-03-14', value: '1', volume: -5 }).success).toBe(false);
  });

  it('rejects an impossible calendar date (month 13)', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-13-40', value: '1' }).success).toBe(false);
  });

  it('rejects an impossible calendar date (Feb 30)', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-02-30', value: '1' }).success).toBe(false);
  });

  it('accepts a leap-year date (2024-02-29)', () => {
    expect(manualPriceSchema.safeParse({ date: '2024-02-29', value: '1' }).success).toBe(true);
  });

  it('accepts 2025-02-28 (non-leap year, last day of Feb)', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-02-28', value: '1' }).success).toBe(true);
  });

  it('accepts 2025-12-31', () => {
    expect(manualPriceSchema.safeParse({ date: '2025-12-31', value: '1' }).success).toBe(true);
  });
});

describe('deletePricesSchema', () => {
  it('accepts an explicit dates array', () => {
    expect(deletePricesSchema.safeParse({ dates: ['2025-03-14', '2025-03-15'] }).success).toBe(true);
  });

  it('accepts an empty body (delete-all sentinel)', () => {
    expect(deletePricesSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an explicit empty array (delete-nothing must not wipe all)', () => {
    expect(deletePricesSchema.safeParse({ dates: [] }).success).toBe(false);
  });

  it('rejects a malformed date in the array', () => {
    expect(deletePricesSchema.safeParse({ dates: ['nope'] }).success).toBe(false);
  });
});
