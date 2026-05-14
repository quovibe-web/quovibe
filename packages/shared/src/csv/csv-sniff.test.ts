// Tests for the Step-1 schema sniff used by the CSV import wizard to block
// advancing past Upload when the parsed file clearly isn't a transaction CSV
// (BUG-47). The heuristic is applied per-column against a small sample set and
// must identify at least one date-like column and one numeric column.
import { describe, it, expect } from 'vitest';
import { sniffLikelyTradeCsv } from './csv-sniff';

describe('sniffLikelyTradeCsv', () => {
  const opts = { dateFormat: 'yyyy-MM-dd' as const, decimalSeparator: '.' as const, thousandSeparator: '' as const };

  it('rejects single-column input (malformed non-delimited text)', () => {
    const result = sniffLikelyTradeCsv(
      ['This is clearly not a CSV'],
      [
        ['just plain English text'],
        ['with no delimiters at all'],
        ['so it parses as one column'],
      ],
      opts,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('SINGLE_COLUMN');
  });

  it('rejects multi-column input with no parseable date column', () => {
    const result = sniffLikelyTradeCsv(
      ['name', 'description', 'amount'],
      [
        ['ACME', 'widget', '100.00'],
        ['BETA', 'gadget', '250.00'],
      ],
      opts,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_DATE_COLUMN');
  });

  it('rejects multi-column input with no parseable numeric column', () => {
    const result = sniffLikelyTradeCsv(
      ['date', 'type', 'note'],
      [
        ['2026-01-02', 'BUY', 'memo one'],
        ['2026-01-03', 'SELL', 'memo two'],
      ],
      opts,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_AMOUNT_COLUMN');
  });

  it('accepts a well-formed trade CSV', () => {
    const result = sniffLikelyTradeCsv(
      ['date', 'type', 'security', 'amount'],
      [
        ['2026-01-02', 'BUY', 'ACME', '100.00'],
        ['2026-01-03', 'SELL', 'ACME', '120.50'],
      ],
      opts,
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(null);
  });

  it('accepts sample rows with locale-specific separators', () => {
    const result = sniffLikelyTradeCsv(
      ['date', 'amount'],
      [
        ['02/01/2026', '1.234,56'],
        ['03/01/2026', '987,65'],
      ],
      { dateFormat: 'dd/MM/yyyy', decimalSeparator: ',', thousandSeparator: '.' },
    );
    expect(result.ok).toBe(true);
  });

  it('tolerates occasional empty cells when majority of sample parses', () => {
    const result = sniffLikelyTradeCsv(
      ['date', 'amount'],
      [
        ['2026-01-02', '100.00'],
        ['2026-01-03', ''],
        ['2026-01-04', '250.00'],
      ],
      opts,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects when no sample rows are available to judge', () => {
    const result = sniffLikelyTradeCsv(['date', 'type', 'amount'], [], opts);
    expect(result.ok).toBe(false);
  });

  // PP CSV exports include the trade time on the Data column. Quovibe's
  // wizard offers date-only formats; the sniff must still recognize the
  // column as a date so the user can advance past Step 1.
  it('accepts PP-style ISO 8601 datetime in the date column', () => {
    const result = sniffLikelyTradeCsv(
      ['Data', 'Tipo', 'Valore'],
      [
        ['2020-09-02T15:42:43', 'Compra', '793,16'],
        ['2020-11-30T11:00', 'Vendi', '-792,42'],
        ['2022-01-07T00:00', 'Compra', '505,76'],
      ],
      { dateFormat: 'yyyy-MM-dd', decimalSeparator: ',', thousandSeparator: '.' },
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(null);
  });
});
