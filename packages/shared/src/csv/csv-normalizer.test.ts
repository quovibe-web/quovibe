// packages/shared/src/csv/csv-normalizer.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseDate,
  parseNumber,
  parseNumberWithSuffix,
  normalizeTransactionType,
  detectDelimiter,
} from './csv-normalizer';
import { TransactionType } from '../enums';

describe('parseDate', () => {
  it('parses yyyy-MM-dd', () => {
    expect(parseDate('2024-01-15', 'yyyy-MM-dd')).toBe('2024-01-15');
  });

  it('parses dd/MM/yyyy', () => {
    expect(parseDate('15/01/2024', 'dd/MM/yyyy')).toBe('2024-01-15');
  });

  it('parses MM/dd/yyyy', () => {
    expect(parseDate('01/15/2024', 'MM/dd/yyyy')).toBe('2024-01-15');
  });

  it('parses dd.MM.yyyy (German)', () => {
    expect(parseDate('15.01.2024', 'dd.MM.yyyy')).toBe('2024-01-15');
  });

  it('returns null for invalid date', () => {
    expect(parseDate('not-a-date', 'yyyy-MM-dd')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDate('', 'yyyy-MM-dd')).toBeNull();
  });

  it('returns null for out-of-range date', () => {
    expect(parseDate('2024-13-01', 'yyyy-MM-dd')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseDate('  2024-01-15  ', 'yyyy-MM-dd')).toBe('2024-01-15');
  });
});

describe('parseNumber', () => {
  it('parses US format (dot decimal, comma thousand)', () => {
    expect(parseNumber('1,234.56', '.', ',')).toBe(1234.56);
  });

  it('parses EU format (comma decimal, dot thousand)', () => {
    expect(parseNumber('1.234,56', ',', '.')).toBe(1234.56);
  });

  it('parses plain integer', () => {
    expect(parseNumber('100', '.', '')).toBe(100);
  });

  it('parses negative number', () => {
    expect(parseNumber('-1234.56', '.', ',')).toBe(-1234.56);
  });

  it('parses space as thousand separator', () => {
    expect(parseNumber('1 234,56', ',', ' ')).toBe(1234.56);
  });

  it('parses number without thousand separator configured as empty', () => {
    expect(parseNumber('1234.56', '.', '')).toBe(1234.56);
  });

  it('returns null for non-numeric string', () => {
    expect(parseNumber('abc', '.', ',')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseNumber('', '.', ',')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseNumber('  1234.56  ', '.', '')).toBe(1234.56);
  });
});

describe('normalizeTransactionType', () => {
  it('resolves English "Buy"', () => {
    expect(normalizeTransactionType('Buy')).toBe(TransactionType.BUY);
  });

  it('resolves German "Kauf"', () => {
    expect(normalizeTransactionType('Kauf')).toBe(TransactionType.BUY);
  });

  it('resolves Italian "Vendita"', () => {
    expect(normalizeTransactionType('Vendita')).toBe(TransactionType.SELL);
  });

  it('resolves French "Dividende"', () => {
    expect(normalizeTransactionType('Dividende')).toBe(TransactionType.DIVIDEND);
  });

  it('resolves raw enum "DELIVERY_INBOUND"', () => {
    expect(normalizeTransactionType('DELIVERY_INBOUND')).toBe(TransactionType.DELIVERY_INBOUND);
  });

  it('is case-insensitive', () => {
    expect(normalizeTransactionType('SELL')).toBe(TransactionType.SELL);
    expect(normalizeTransactionType('sell')).toBe(TransactionType.SELL);
    expect(normalizeTransactionType('Sell')).toBe(TransactionType.SELL);
  });

  it('returns null for unknown type', () => {
    expect(normalizeTransactionType('TRANSFER')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeTransactionType('')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(normalizeTransactionType('  Buy  ')).toBe(TransactionType.BUY);
  });
});

describe('detectDelimiter', () => {
  it('detects semicolon', () => {
    expect(detectDelimiter('Date;Price;Volume')).toBe(';');
  });

  it('detects comma', () => {
    expect(detectDelimiter('Date,Price,Volume')).toBe(',');
  });

  it('detects tab', () => {
    expect(detectDelimiter('Date\tPrice\tVolume')).toBe('\t');
  });

  it('detects pipe', () => {
    expect(detectDelimiter('Date|Price|Volume')).toBe('|');
  });

  it('defaults to comma for ambiguous input', () => {
    expect(detectDelimiter('single_column')).toBe(',');
  });
});

describe('parseNumberWithSuffix (BUG-161)', () => {
  it('strips K suffix and multiplies by 1e3', () => {
    expect(parseNumberWithSuffix('999K', '.', '')).toBe(999000);
  });
  it('strips M suffix and multiplies by 1e6', () => {
    expect(parseNumberWithSuffix('45.6M', '.', '')).toBe(45600000);
  });
  it('strips B suffix and multiplies by 1e9', () => {
    expect(parseNumberWithSuffix('1.23B', '.', '')).toBe(1230000000);
  });
  it('accepts lowercase suffixes', () => {
    expect(parseNumberWithSuffix('45.6m', '.', '')).toBe(45600000);
  });
  it('handles locale: de-DE-style with thousand sep + comma decimal + K', () => {
    expect(parseNumberWithSuffix('1.234,5K', ',', '.')).toBe(1234500);
  });
  it('returns null for non-numeric body', () => {
    expect(parseNumberWithSuffix('abcM', '.', '')).toBeNull();
  });
  it('parses bare numbers without a suffix', () => {
    expect(parseNumberWithSuffix('1500', '.', '')).toBe(1500);
  });
  it('rejects empty string', () => {
    expect(parseNumberWithSuffix('', '.', '')).toBeNull();
  });
});

describe('parseNumber (regression guard for trade flow)', () => {
  it('returns null for suffix strings — does NOT silently 1000× cost basis', () => {
    expect(parseNumber('45.6M', '.', '')).toBeNull();
    expect(parseNumber('1.23B', '.', '')).toBeNull();
  });
});
