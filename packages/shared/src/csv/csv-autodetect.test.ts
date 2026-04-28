// packages/shared/src/csv/csv-autodetect.test.ts
import { describe, it, expect } from 'vitest';
import { autodetectCsvFormat } from './csv-autodetect';

describe('autodetectCsvFormat — date format', () => {
  it('detects yyyy-MM-dd from samples', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Close'],
      [
        ['2024-01-15', '150.50'],
        ['2024-01-16', '151.25'],
        ['2024-01-17', '149.00'],
      ],
    );
    expect(result.dateFormat).toBe('yyyy-MM-dd');
  });

  it('detects dd/MM/yyyy when the first component is unambiguously > 12', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Close'],
      [
        ['15/01/2024', '150.50'],
        ['16/01/2024', '151.25'],
        ['25/01/2024', '149.00'],
      ],
    );
    expect(result.dateFormat).toBe('dd/MM/yyyy');
  });

  it('detects MM/dd/yyyy when the second component is unambiguously > 12 (US format)', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Close'],
      [
        ['01/15/2024', '150.50'],
        ['01/16/2024', '151.25'],
        ['02/25/2024', '149.00'],
      ],
    );
    expect(result.dateFormat).toBe('MM/dd/yyyy');
  });

  it('detects dd.MM.yyyy (German)', () => {
    const result = autodetectCsvFormat(
      ['Datum', 'Kurs'],
      [
        ['15.01.2024', '150,50'],
        ['16.01.2024', '151,25'],
        ['25.01.2024', '149,00'],
      ],
    );
    expect(result.dateFormat).toBe('dd.MM.yyyy');
  });

  it('returns null when no column looks like a date', () => {
    const result = autodetectCsvFormat(
      ['Foo', 'Bar'],
      [
        ['hello', 'world'],
        ['xyz', 'abc'],
      ],
    );
    expect(result.dateFormat).toBeNull();
  });
});

describe('autodetectCsvFormat — number format', () => {
  it('detects comma decimal (German/Italian/French)', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Value'],
      [
        ['2024-01-15', '150,50'],
        ['2024-01-16', '151,25'],
        ['2024-01-17', '1.234,56'],
      ],
    );
    expect(result.decimalSeparator).toBe(',');
    expect(result.thousandSeparator).toBe('.');
  });

  it('detects dot decimal (English) without thousand sep', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Value'],
      [
        ['2024-01-15', '150.50'],
        ['2024-01-16', '151.25'],
        ['2024-01-17', '149.00'],
      ],
    );
    expect(result.decimalSeparator).toBe('.');
    expect(result.thousandSeparator).toBe('');
  });

  it('detects dot decimal with comma thousand (US large-number)', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Value'],
      [
        ['2024-01-15', '1,500.50'],
        ['2024-01-16', '12,345.67'],
        ['2024-01-17', '149.00'],
      ],
    );
    expect(result.decimalSeparator).toBe('.');
    expect(result.thousandSeparator).toBe(',');
  });

  it('returns null when no column looks numeric', () => {
    const result = autodetectCsvFormat(
      ['Foo', 'Bar'],
      [['hello', 'world']],
    );
    expect(result.decimalSeparator).toBeNull();
  });
});

describe('autodetectCsvFormat — header column mapping', () => {
  it('matches English headers to internal fields', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Type', 'Security Name', 'Shares', 'Value', 'Fees', 'Taxes', 'ISIN', 'Ticker'],
      [],
    );
    expect(result.columnMapping).toEqual({
      date: 0, type: 1, security: 2, shares: 3, amount: 4,
      fees: 5, taxes: 6, isin: 7, ticker: 8,
    });
  });

  it('matches German headers (Datum, Typ, Wertpapier, Stück, Wert)', () => {
    const result = autodetectCsvFormat(
      ['Datum', 'Typ', 'Wertpapier', 'Stück', 'Wert'],
      [],
    );
    expect(result.columnMapping['date']).toBe(0);
    expect(result.columnMapping['type']).toBe(1);
    expect(result.columnMapping['security']).toBe(2);
    expect(result.columnMapping['shares']).toBe(3);
    expect(result.columnMapping['amount']).toBe(4);
  });

  it('matches Italian headers (Data, Tipo, Strumento, Quote, Valore)', () => {
    const result = autodetectCsvFormat(
      ['Data', 'Tipo', 'Strumento', 'Quote', 'Valore'],
      [],
    );
    expect(result.columnMapping['date']).toBe(0);
    expect(result.columnMapping['type']).toBe(1);
    expect(result.columnMapping['security']).toBe(2);
    expect(result.columnMapping['shares']).toBe(3);
    expect(result.columnMapping['amount']).toBe(4);
  });

  it('matches PP cross-currency headers (Exchange Rate, Gross Amount, Currency Gross Amount)', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Exchange Rate', 'Gross Amount', 'Currency Gross Amount'],
      [],
    );
    expect(result.columnMapping['fxRate']).toBe(1);
    expect(result.columnMapping['grossAmount']).toBe(2);
    expect(result.columnMapping['currencyGrossAmount']).toBe(3);
  });

  it('is case-insensitive and strips surrounding whitespace', () => {
    const result = autodetectCsvFormat(
      ['  DATE  ', 'type', 'Security'],
      [],
    );
    expect(result.columnMapping['date']).toBe(0);
    expect(result.columnMapping['type']).toBe(1);
    expect(result.columnMapping['security']).toBe(2);
  });

  it('strips diacritics in headers (Stück → stuck → shares)', () => {
    const result = autodetectCsvFormat(
      ['Stück'],
      [],
    );
    expect(result.columnMapping['shares']).toBe(0);
  });

  it('returns empty mapping when no headers are recognized', () => {
    const result = autodetectCsvFormat(
      ['Foo', 'Bar', 'Baz'],
      [],
    );
    expect(result.columnMapping).toEqual({});
  });

  it('does not map the same field to two columns (first-wins)', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Datum'],
      [],
    );
    expect(result.columnMapping['date']).toBe(0);
    // Second "Datum" column is dropped — first match wins so the
    // user's alphabetical ordering doesn't accidentally clobber English
    // headers when both are present.
    const datumCol = Object.values(result.columnMapping).filter((v) => v === 1).length;
    expect(datumCol).toBe(0);
  });
});

describe('autodetectCsvFormat — PP-parity columns (BUG-125)', () => {
  it('maps WKN header alias', () => {
    const result = autodetectCsvFormat(
      ['Date', 'Type', 'Security Name', 'WKN', 'Value'],
      [['2026-01-15', 'BUY', 'Apple Inc', 'A0YEDG', '1500']],
    );
    expect(result.columnMapping['wkn']).toBe(3);
  });

  it('maps Time header in 4 languages', () => {
    for (const [, label] of [
      ['en', 'Time'],
      ['it', 'Ora'],
      ['de', 'Zeit'],
      ['fr', 'Heure'],
    ] as const) {
      const result = autodetectCsvFormat(
        ['Date', label, 'Type', 'Value'],
        [['2026-01-15', '14:30', 'BUY', '1500']],
      );
      expect(result.columnMapping['time']).toBe(1);
    }
  });

  it('maps Date of Quote header in 3 languages', () => {
    for (const label of ['Date of Quote', 'Data quotazione', 'Datum der Notierung']) {
      const result = autodetectCsvFormat(
        [label, 'Close'],
        [['2026-01-15', '191.62']],
      );
      expect(result.columnMapping['dateOfQuote']).toBe(0);
    }
  });
});
