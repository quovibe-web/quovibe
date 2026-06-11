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

  it('rejects a grouped volume "1.234" (no thousands grouping, never stripped)', () => {
    expect(schema.safeParse(values({ volume: '1.234' })).success).toBe(false);
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

  // Comma decimal separator (es/it/de/fr/nl/pl/pt users type "23,23"). Display
  // uses the locale comma, so input must accept it too. Comma + dot are the only
  // decimal separators across the 8 shipped locales, so a literal comma->dot
  // replace is locale-agnostic and safe.
  it('accepts a comma decimal value', () => {
    expect(schema.safeParse(values({ value: '23,23' })).success).toBe(true);
  });

  it('accepts a comma decimal in open/high/low', () => {
    expect(
      schema.safeParse(values({ open: '10,5', high: '12,75', low: '9,1' })).success,
    ).toBe(true);
  });

  it('rejects a grouped value with both separators (no thousands grouping)', () => {
    // "1.234,56" -> "1.234.56" -> rejected (not silently corrupted to 1234.56).
    expect(schema.safeParse(values({ value: '1.234,56' })).success).toBe(false);
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

  it('defensively ignores a grouped/decimal volume rather than truncating it', () => {
    // A direct caller bypassing schema validation must not get parseInt("1.234")=1.
    expect(toWirePayload(values({ volume: '1.234' })).volume).toBeUndefined();
    expect(toWirePayload(values({ volume: '1.5' })).volume).toBeUndefined();
  });

  it('carries present OHLC strings through', () => {
    const p = toWirePayload(values({ open: '10', high: '12', low: '9' }));
    expect(p.open).toBe('10');
    expect(p.high).toBe('12');
    expect(p.low).toBe('9');
  });

  it('normalizes comma decimals to dot form on the wire', () => {
    const p = toWirePayload(values({ value: '23,23', open: '10,5', high: '12,75', low: '9,1' }));
    expect(p.value).toBe('23.23');
    expect(p.open).toBe('10.5');
    expect(p.high).toBe('12.75');
    expect(p.low).toBe('9.1');
  });

  it('leaves an already-dot value untouched (edit round-trip is corruption-safe)', () => {
    // Regression guard: row.value arrives dot-form ("18.18") from the API; a
    // locale-aware group-strip would mangle this to "1818" on a no-op edit.
    const wire = toWirePayload(rowToFormValues({
      date: '2026-04-15', value: '18.18', open: null, high: null, low: null, volume: null,
    }));
    expect(wire.value).toBe('18.18');
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
