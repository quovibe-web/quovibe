import { describe, it, expect } from 'vitest';
import { parseEcbCsv, EcbCsvError } from './ecb-csv';

describe('parseEcbCsv', () => {
  it('parses eurofxref-hist format with multiple currencies', () => {
    const csv = `Date,USD,JPY,GBP,
2026-01-02,1.0345,162.91,0.8612,
2026-01-03,1.0398,163.42,0.8634,`;
    const result = parseEcbCsv(csv);
    expect(result).toHaveLength(6); // 3 ccy × 2 dates
    expect(result[0]).toMatchObject({ date: '2026-01-02', from: 'EUR', to: 'USD', rate: '1.0345' });
    expect(result[5]).toMatchObject({ date: '2026-01-03', from: 'EUR', to: 'GBP', rate: '0.8634' });
  });

  it('skips empty cells', () => {
    const csv = `Date,USD,JPY,
2026-01-02,1.0345,,
2026-01-03,,163.42,`;
    const result = parseEcbCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0].to).toBe('USD');
    expect(result[1].to).toBe('JPY');
  });

  it('skips N/A cells (ECB convention for missing rates)', () => {
    const csv = `Date,USD,
2026-01-02,N/A,
2026-01-03,1.10,`;
    const result = parseEcbCsv(csv);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-03');
  });

  it('handles CRLF line endings (Windows downloads)', () => {
    const csv = `Date,USD,\r\n2026-01-02,1.0345,\r\n2026-01-03,1.0398,`;
    const result = parseEcbCsv(csv);
    expect(result).toHaveLength(2);
  });

  it('throws EMPTY_CSV on no body', () => {
    expect(() => parseEcbCsv('')).toThrow(EcbCsvError);
    expect(() => parseEcbCsv('Date,USD,')).toThrow(EcbCsvError);
  });

  it('throws MISSING_DATE_COLUMN on bad header', () => {
    expect(() => parseEcbCsv('USD,JPY\n1.0,2.0')).toThrow(EcbCsvError);
  });

  it('throws INVALID_DATE_FORMAT on non-ISO date', () => {
    expect(() => parseEcbCsv('Date,USD\n01/02/2026,1.0345')).toThrow(EcbCsvError);
  });

  it('rejects non-positive rates silently (skip, not throw)', () => {
    const csv = `Date,USD,JPY,
2026-01-02,0,162.91,
2026-01-03,-1,163.42,`;
    const result = parseEcbCsv(csv);
    // 0 and -1 USD are skipped; JPY rows kept.
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.to === 'JPY')).toBe(true);
  });
});
