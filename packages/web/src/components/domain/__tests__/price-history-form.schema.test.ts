import { describe, it, expect } from 'vitest';
import {
  buildPriceFormSchema,
  toWirePayload,
  rowToFormValues,
  EMPTY_FORM,
  type PriceFormValues,
} from '../price-history-form.schema';
import type { RawPriceRow } from '@/api/use-manual-prices';

// Identity translator: returns the key so message-content assertions stay stable
// across languages and the test never depends on locale JSON.
const t = (k: string) => k;
const schema = buildPriceFormSchema(t);

function values(overrides: Partial<PriceFormValues> = {}): PriceFormValues {
  return { ...EMPTY_FORM, date: '2025-06-07', value: '12.50', ...overrides };
}

describe('buildPriceFormSchema', () => {
  it('accepts a valid date + value with all OHLCV blank', () => {
    const r = schema.safeParse(values());
    expect(r.success).toBe(true);
  });

  it('rejects a missing value', () => {
    expect(schema.safeParse(values({ value: '' })).success).toBe(false);
  });

  it('rejects value 0', () => {
    expect(schema.safeParse(values({ value: '0' })).success).toBe(false);
  });

  it('rejects a negative value', () => {
    expect(schema.safeParse(values({ value: '-1' })).success).toBe(false);
  });

  it('rejects a non-numeric value', () => {
    expect(schema.safeParse(values({ value: 'abc' })).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(schema.safeParse(values({ date: '2025-6-7' })).success).toBe(false);
  });

  it('rejects an impossible calendar date (month 13)', () => {
    expect(schema.safeParse(values({ date: '2025-13-40' })).success).toBe(false);
  });

  it('rejects an impossible calendar date (Feb 30)', () => {
    expect(schema.safeParse(values({ date: '2025-02-30' })).success).toBe(false);
  });

  it('accepts a leap-year date (2024-02-29)', () => {
    expect(schema.safeParse(values({ date: '2024-02-29' })).success).toBe(true);
  });

  it('accepts blank open', () => {
    expect(schema.safeParse(values({ open: '' })).success).toBe(true);
  });

  it('rejects open 0', () => {
    expect(schema.safeParse(values({ open: '0' })).success).toBe(false);
  });

  it('rejects negative open', () => {
    expect(schema.safeParse(values({ open: '-5' })).success).toBe(false);
  });

  it('rejects a fractional volume', () => {
    expect(schema.safeParse(values({ volume: '1.5' })).success).toBe(false);
  });

  it('accepts an integer volume', () => {
    expect(schema.safeParse(values({ volume: '100' })).success).toBe(true);
  });

  it('accepts blank volume', () => {
    expect(schema.safeParse(values({ volume: '' })).success).toBe(true);
  });

  it('produces the translated message via t() (not a raw code)', () => {
    const r = schema.safeParse(values({ value: '' }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe('priceHistory.form.errors.invalidValue');
    }
  });
});

describe('toWirePayload', () => {
  it("maps blank optionals to undefined", () => {
    const p = toWirePayload(values());
    expect(p.open).toBeUndefined();
    expect(p.high).toBeUndefined();
    expect(p.low).toBeUndefined();
    expect(p.volume).toBeUndefined();
  });

  it('passes value and date through as strings', () => {
    const p = toWirePayload(values({ value: '99.99', date: '2024-01-02' }));
    expect(p.value).toBe('99.99');
    expect(p.date).toBe('2024-01-02');
  });

  it('parses volume to a number', () => {
    const p = toWirePayload(values({ volume: '42' }));
    expect(p.volume).toBe(42);
  });

  it('maps blank volume to undefined', () => {
    const p = toWirePayload(values({ volume: '' }));
    expect(p.volume).toBeUndefined();
  });

  it('carries present OHLC strings through', () => {
    const p = toWirePayload(values({ open: '10', high: '12', low: '9' }));
    expect(p.open).toBe('10');
    expect(p.high).toBe('12');
    expect(p.low).toBe('9');
  });
});

describe('rowToFormValues', () => {
  it('maps null OHLCV to empty strings and volume number to a string', () => {
    const row: RawPriceRow = {
      date: '2025-06-07',
      value: '12.50',
      open: null,
      high: null,
      low: null,
      volume: 100,
    };
    const fv = rowToFormValues(row);
    expect(fv.open).toBe('');
    expect(fv.high).toBe('');
    expect(fv.low).toBe('');
    expect(fv.volume).toBe('100');
    expect(fv.date).toBe('2025-06-07');
    expect(fv.value).toBe('12.50');
  });

  it('round-trips present values: row -> form -> wire preserves OHLCV', () => {
    const row: RawPriceRow = {
      date: '2025-06-07',
      value: '12.50',
      open: '11',
      high: '13',
      low: '10',
      volume: 5000,
    };
    const wire = toWirePayload(rowToFormValues(row));
    expect(wire).toEqual({
      date: '2025-06-07',
      value: '12.50',
      open: '11',
      high: '13',
      low: '10',
      volume: 5000,
    });
  });

  it('null volume maps to empty string then back to undefined', () => {
    const row: RawPriceRow = {
      date: '2025-06-07',
      value: '12.50',
      open: null,
      high: null,
      low: null,
      volume: null,
    };
    const fv = rowToFormValues(row);
    expect(fv.volume).toBe('');
    expect(toWirePayload(fv).volume).toBeUndefined();
  });
});
