import { describe, it, expect } from 'vitest';
import { nonBlankString, isinString, tickerString, currencyCode } from '../schemas/utils';

describe('nonBlankString', () => {
  const helper = nonBlankString(50);

  it('rejects empty string', () => {
    expect(() => helper.parse('')).toThrow();
  });

  it('rejects whitespace-only string', () => {
    expect(() => helper.parse('   ')).toThrow();
    expect(() => helper.parse('\t\n')).toThrow();
  });

  it('trims surrounding whitespace', () => {
    expect(helper.parse('  hello  ')).toBe('hello');
  });

  it('honors max length cap', () => {
    expect(() => helper.parse('a'.repeat(51))).toThrow();
    expect(helper.parse('a'.repeat(50))).toBe('a'.repeat(50));
  });

  it('default max is 200', () => {
    const def = nonBlankString();
    expect(def.parse('a'.repeat(200))).toHaveLength(200);
    expect(() => def.parse('a'.repeat(201))).toThrow();
  });
});

describe('isinString', () => {
  it('accepts canonical ISIN', () => {
    expect(isinString.parse('US0378331005')).toBe('US0378331005');
  });

  it('uppercases and trims', () => {
    expect(isinString.parse(' us0378331005 ')).toBe('US0378331005');
  });

  it('rejects too-short', () => {
    expect(() => isinString.parse('US123')).toThrow();
  });

  it('rejects too-long', () => {
    expect(() => isinString.parse('US03783310050')).toThrow();
  });

  it('rejects non-letter prefix', () => {
    expect(() => isinString.parse('1234567890123')).toThrow();
  });

  it('rejects non-digit check digit', () => {
    expect(() => isinString.parse('US037833100A')).toThrow();
  });
});

describe('tickerString', () => {
  it('uppercases and trims', () => {
    expect(tickerString.parse(' aapl ')).toBe('AAPL');
  });

  it('rejects empty', () => {
    expect(() => tickerString.parse('')).toThrow();
    expect(() => tickerString.parse('   ')).toThrow();
  });

  it('caps at 32 chars', () => {
    expect(() => tickerString.parse('A'.repeat(33))).toThrow();
  });
});

describe('currencyCode', () => {
  it('accepts ISO 4217', () => {
    expect(currencyCode.parse('EUR')).toBe('EUR');
    expect(currencyCode.parse(' USD ')).toBe('USD');
  });

  it('rejects lowercase', () => {
    expect(() => currencyCode.parse('eur')).toThrow();
  });

  it('rejects wrong length', () => {
    expect(() => currencyCode.parse('EU')).toThrow();
    expect(() => currencyCode.parse('EURO')).toThrow();
  });
});
