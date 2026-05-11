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

  // PP CSV exports carry an ISO 8601 time tail on the Data column.
  // The detector must pick `yyyy-MM-dd` so the wizard prefills correctly.
  it('detects yyyy-MM-dd from PP-style ISO 8601 datetime samples', () => {
    const result = autodetectCsvFormat(
      ['Data', 'Tipo', 'Valore'],
      [
        ['2020-09-02T15:42:43', 'Compra', '793,16'],
        ['2020-11-30T11:00', 'Vendi', '-792,42'],
        ['2022-01-07T00:00', 'Compra', '505,76'],
      ],
    );
    expect(result.dateFormat).toBe('yyyy-MM-dd');
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

  // 15-column header shape per locale: assert all canonical fields resolve.
  // Each locale's header strings are the verbatim labels emitted by the
  // upstream PP exporter — derived from the project's `messages_*.properties`
  // files, not guessed translations. The normalized alias table is the
  // single source of truth.
  function assertCanonicalMapping(mapping: Record<string, number>) {
    expect(mapping).toMatchObject({
      date: 0, type: 1, amount: 2, currency: 3, grossAmount: 4,
      currencyGrossAmount: 5, fxRate: 6, fees: 7, taxes: 8, shares: 9,
      isin: 10, wkn: 11, ticker: 12, security: 13, note: 14,
    });
  }

  it('matches the German exporter header set', () => {
    const result = autodetectCsvFormat(
      [
        'Datum', 'Typ', 'Wert', 'Buchungswährung', 'Bruttobetrag',
        'Währung Bruttobetrag', 'Wechselkurs', 'Gebühren', 'Steuern',
        'Stück', 'ISIN', 'WKN', 'Ticker-Symbol', 'Wertpapiername', 'Notiz',
      ],
      [],
    );
    assertCanonicalMapping(result.columnMapping);
  });

  it('matches the French exporter header set', () => {
    const result = autodetectCsvFormat(
      [
        'Date', 'Type', 'Valeur', "Devise de l'opération", 'Montant brut',
        'Montant brut en devise', 'Taux de change', 'Frais', 'Impôts / Taxes',
        'Parts', 'ISIN', 'WKN', 'Symbole boursier', 'Nom du titre', 'Note',
      ],
      [],
    );
    assertCanonicalMapping(result.columnMapping);
  });

  it('matches the Spanish exporter header set', () => {
    const result = autodetectCsvFormat(
      [
        'Fecha', 'Tipo', 'Valor', 'Divisa de la transacción', 'Valor bruto',
        'Divisa del importe bruto', 'Tipo de cambio', 'Comisiones', 'Impuestos',
        'Cantidad', 'ISIN', 'WKN', 'Símbolo del ticker', 'Nombre del valor', 'Nota',
      ],
      [],
    );
    assertCanonicalMapping(result.columnMapping);
  });

  it('matches the Dutch exporter header set', () => {
    const result = autodetectCsvFormat(
      [
        'Datum', 'Transactietype', 'Waarde (netto)', 'Transactievaluta',
        'Waarde (bruto)', 'Valuta (bruto)', 'Wisselkoers', 'Kosten',
        'Belasting', 'Aantal', 'ISIN', 'WKN', 'Tickersymbool',
        'Effect', 'Opmerking',
      ],
      [],
    );
    assertCanonicalMapping(result.columnMapping);
  });

  it('matches the Polish exporter header set', () => {
    const result = autodetectCsvFormat(
      [
        'Data', 'Typ', 'Wartość', 'Waluta transakcji', 'Kwota brutto',
        'Kwota waluty brutto', 'Kurs wymiany', 'Opłaty', 'Podatki',
        'Akcje', 'ISIN', 'WKN', 'Symbol giełdowy waloru',
        'Nazwa waloru', 'Uwaga',
      ],
      [],
    );
    assertCanonicalMapping(result.columnMapping);
  });

  it('matches the Portuguese exporter header set', () => {
    const result = autodetectCsvFormat(
      [
        'Data', 'Tipo', 'Valor', 'Moeda da transação', 'Valor bruto',
        'Valor Bruto em Moeda', 'Taxas de Câmbio', 'Comissões', 'Impostos',
        'Quantidade', 'ISIN', 'WKN', 'Símbolo Ticker', 'Nome do Título', 'Nota',
      ],
      [],
    );
    assertCanonicalMapping(result.columnMapping);
  });

  // PP Italian export header set. Two-space `Valuta  Operazione` is the
  // real exporter shape; the normalizer collapses internal whitespace so
  // the alias lookup matches.
  it('matches the full PP Italian header set (Directa export shape)', () => {
    const result = autodetectCsvFormat(
      [
        'Data', 'Tipo', 'Valore', 'Valuta  Operazione', 'Importo Lordo',
        'Importo lordo valuta', 'Tasso di cambio', 'Commissioni', 'Tasse',
        'Azioni', 'ISIN', 'WKN', 'Simbolo Titolo', 'Nome Titolo', 'Note',
      ],
      [],
    );
    expect(result.columnMapping).toMatchObject({
      date: 0,
      type: 1,
      amount: 2,
      currency: 3,
      grossAmount: 4,
      currencyGrossAmount: 5,
      fxRate: 6,
      fees: 7,
      taxes: 8,
      shares: 9,
      isin: 10,
      wkn: 11,
      ticker: 12,
      security: 13,
      note: 14,
    });
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

  it('maps Time header in all 8 languages', () => {
    for (const label of [
      'Time', 'Ora', 'Zeit', 'Heure', 'Hora', 'Tijd', 'Czas', 'Hora',
    ]) {
      const result = autodetectCsvFormat(
        ['Date', label, 'Type', 'Value'],
        [['2026-01-15', '14:30', 'BUY', '1500']],
      );
      expect(result.columnMapping['time']).toBe(1);
    }
  });

  it('maps Date of Quote header in all 8 languages', () => {
    for (const label of [
      'Date of Quote',
      'Data quotazione',
      'Datum der Notierung',
      'Date de cotation',
      'Fecha de cotización',
      'Datum van notering',
      'Data notowania',
      'Data da cotação',
    ]) {
      const result = autodetectCsvFormat(
        [label, 'Close'],
        [['2026-01-15', '191.62']],
      );
      expect(result.columnMapping['dateOfQuote']).toBe(0);
    }
  });
});

describe('autodetectCsvFormat — per-row account columns', () => {
  it('maps "Account" header in 8 languages → field=account', () => {
    for (const label of [
      'Account', 'Konto', 'Conto', 'Compte', 'Cuenta', 'Rekening', 'Konto', 'Conta',
    ]) {
      const result = autodetectCsvFormat(['Date', label], []);
      expect(result.columnMapping['account']).toBe(1);
    }
  });

  it('maps "Securities Account" header in 8 languages → field=securitiesAccount', () => {
    for (const label of [
      'Securities Account', 'Depot', 'Conto Titoli',
      'Compte-titres', 'Cuenta de Valores', 'Effectenrekening',
      'Konto walorów', 'Conta de Títulos',
    ]) {
      const result = autodetectCsvFormat(['Date', label], []);
      expect(result.columnMapping['securitiesAccount']).toBe(1);
    }
  });

  it('maps "Offset Account" header in 8 languages → field=offsetAccount', () => {
    for (const label of [
      'Offset Account', 'Gegenkonto', 'Conto Controparte',
      'Compte de compensation', 'Cuenta de contrapartida', 'Tegenrekening',
      'Konto Przeciwstawne', 'Conta de Contrapartida',
    ]) {
      const result = autodetectCsvFormat(['Date', label], []);
      expect(result.columnMapping['offsetAccount']).toBe(1);
    }
  });

  it('maps "Offset Securities Account" header in 8 languages → field=offsetSecuritiesAccount', () => {
    for (const label of [
      'Offset Securities Account', 'Gegendepot', 'Conto Titoli Controparte',
      'Compte Titres Miroir', 'Cuenta de valores compensados', 'Tegen-Effectenrekening',
      'Konto przeciwstawne walorów', 'Conta de Títulos Compensados',
    ]) {
      const result = autodetectCsvFormat(['Date', label], []);
      expect(result.columnMapping['offsetSecuritiesAccount']).toBe(1);
    }
  });
});
