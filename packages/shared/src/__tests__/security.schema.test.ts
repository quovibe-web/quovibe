import { describe, it, expect } from 'vitest';
import { createSecuritySchema } from '../schemas/security.schema';

describe('createSecuritySchema', () => {
  it('accepts calendar field', () => {
    const result = createSecuritySchema.parse({
      name: 'Test Security',
      currency: 'EUR',
      calendar: 'NYSE',
    });
    expect(result.calendar).toBe('NYSE');
  });

  it('accepts isRetired field', () => {
    const result = createSecuritySchema.parse({
      name: 'Test',
      currency: 'EUR',
      isRetired: true,
    });
    expect(result.isRetired).toBe(true);
  });

  it('rejects empty name', () => {
    expect(() =>
      createSecuritySchema.parse({ name: '', currency: 'EUR' })
    ).toThrow();
  });

  it('rejects blank name (BUG-119)', () => {
    expect(() =>
      createSecuritySchema.parse({ name: '   ', currency: 'EUR' })
    ).toThrow();
  });

  it('trims and accepts surrounding whitespace on name', () => {
    const r = createSecuritySchema.parse({ name: '  Apple Inc  ', currency: 'EUR' });
    expect(r.name).toBe('Apple Inc');
  });

  it('accepts canonical ISIN (BUG-117)', () => {
    const r = createSecuritySchema.parse({
      name: 'Apple', currency: 'EUR', isin: 'US0378331005',
    });
    expect(r.isin).toBe('US0378331005');
  });

  it('uppercases lowercase ISIN (BUG-117)', () => {
    const r = createSecuritySchema.parse({
      name: 'Apple', currency: 'EUR', isin: ' us0378331005 ',
    });
    expect(r.isin).toBe('US0378331005');
  });

  it('rejects malformed ISIN (BUG-117)', () => {
    expect(() => createSecuritySchema.parse({
      name: 'X', currency: 'EUR', isin: 'US123',
    })).toThrow();
    expect(() => createSecuritySchema.parse({
      name: 'X', currency: 'EUR', isin: '1234567890123',
    })).toThrow();
  });

  it('uppercases and trims ticker (BUG-118)', () => {
    const r = createSecuritySchema.parse({
      name: 'Apple', currency: 'EUR', ticker: ' aapl ',
    });
    expect(r.ticker).toBe('AAPL');
  });
});
