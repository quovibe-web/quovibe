import { describe, it, expect } from 'vitest';
import { TableProvider, parseTableHtml } from '../table.provider';

// Builds a single-table HTML document: first <tr> = header cells, rest = data rows.
function tableHtml(headerCells: string[], rows: string[][]): string {
  const th = headerCells.map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<html><body><table><tr>${th}</tr>${trs}</table></body></html>`;
}

describe('parseTableHtml', () => {
  it('parses an English investing-style table', () => {
    const html = tableHtml(
      ['Date', 'Price', 'Open', 'High', 'Low', 'Change %'],
      [
        ['2026-06-04', '101.25', '100.0', '102.0', '100.5', '0.5%'],
        ['2026-06-03', '100.50', '99.0', '101.0', '98.5', '-0.2%'],
      ],
    );
    const { prices } = parseTableHtml(html, {});
    expect(prices).toHaveLength(2);
    expect(prices[0].date).toBe('2026-06-04');
    expect(prices[0].close.toString()).toBe('101.25');
    expect(prices[0].high?.toString()).toBe('102');
    expect(prices[0].low?.toString()).toBe('100.5');
    expect(prices[1].date).toBe('2026-06-03'); // row order preserved
    // Note: the 'Open' column in the fixture is intentionally unsupported by this provider — silently ignored.
  });

  const LANG_TABLES: { lang: string; headers: string[] }[] = [
    { lang: 'EN', headers: ['Date', 'Price', 'Open', 'High', 'Low', 'Change %'] },
    { lang: 'DE', headers: ['Datum', 'Zuletzt', 'Eröffn.', 'Hoch', 'Tief', '+/- %'] },
    { lang: 'FR', headers: ['Date', 'Dernier', 'Ouv.', 'Plus Haut', 'Plus Bas', 'Variation %'] },
    { lang: 'IT', headers: ['Data', 'Ultimo', 'Apertura', 'Massimo', 'Minimo', 'Var. %'] },
    { lang: 'ES', headers: ['Fecha', 'Último', 'Apertura', 'Máximo', 'Mínimo', '% var.'] },
    { lang: 'NL', headers: ['Datum', 'Laatste', 'Open', 'Hoog', 'Laag', '+/- %'] },
    { lang: 'PL', headers: ['Data', 'Ostatnio', 'Otwarcie', 'Max.', 'Min.', 'Zmiana%'] },
    { lang: 'PT', headers: ['Data', 'Último', 'Abertura', 'Máxima', 'Mínima', 'Var%'] },
  ];

  it.each(LANG_TABLES)('parses $lang investing.com headers (date+close+high+low)', ({ headers }) => {
    const html = tableHtml(headers, [
      ['2026-06-04', '101.25', '100.0', '102.0', '100.5', '0.5%'],
      ['2026-06-03', '100.50', '99.0', '101.0', '98.5', '-0.2%'],
    ]);
    const { prices } = parseTableHtml(html, {});
    expect(prices).toHaveLength(2);
    expect(prices[0].date).toBe('2026-06-04');
    expect(prices[0].close.toString()).toBe('101.25');
    expect(prices[0].high?.toString()).toBe('102');
    expect(prices[0].low?.toString()).toBe('100.5');
  });

  it('exact-token max/min does not false-match longer words', () => {
    const html = tableHtml(['Date', 'Price', 'Maximum'], [['2026-06-04', '50.00', '999']]);
    const { prices } = parseTableHtml(html, {});
    expect(prices).toHaveLength(1);
    expect(prices[0].high).toBeUndefined(); // "Maximum" must NOT be read as high
  });

  it('exact-token min does not false-match longer words', () => {
    const html = tableHtml(['Date', 'Price', 'Minimum'], [['2026-06-04', '50.00', '1']]);
    const { prices } = parseTableHtml(html, {});
    expect(prices).toHaveLength(1);
    expect(prices[0].low).toBeUndefined(); // "Minimum" must NOT be read as low
  });

  it('warns when tables exist but none has Date+Close', () => {
    const html = tableHtml(['Name', 'Kurs', '+/- %', 'Vol.'], [['ACME', '10', '1%', '100']]);
    const { prices, warning } = parseTableHtml(html, {});
    expect(prices).toHaveLength(0);
    expect(warning).toContain('Found 1 tables');
    expect(warning).toContain('Date');
  });

  it('appends the investing.com history hint on an overview URL', () => {
    const html = tableHtml(['Name', 'Kurs', '+/- %', 'Vol.'], [['ACME', '10', '1%', '100']]);
    const { warning } = parseTableHtml(html, {
      feedUrl: 'https://de.investing.com/rates-bonds/xs2829810923',
    });
    expect(warning).toContain('https://de.investing.com/rates-bonds/xs2829810923-historical-data');
  });

  it('does not double-append when the URL already targets historical-data', () => {
    const html = tableHtml(['Name', 'Kurs', '+/- %', 'Vol.'], [['ACME', '10', '1%', '100']]);
    const { warning } = parseTableHtml(html, {
      feedUrl: 'https://de.investing.com/rates-bonds/xs2829810923-historical-data',
    });
    expect(warning).not.toContain('-historical-data-historical-data');
    expect(warning).not.toContain('use the history page');
  });

  it('warns when no tables are found', () => {
    const { prices, warning } = parseTableHtml('<html><body><p>nope</p></body></html>', {});
    expect(prices).toHaveLength(0);
    expect(warning).toBe('No tables found at this URL.');
  });

  it('warns when a price table has no usable rows', () => {
    const html = tableHtml(['Date', 'Price'], [['not-a-date', 'abc']]);
    const { prices, warning } = parseTableHtml(html, {});
    expect(prices).toHaveLength(0);
    expect(warning).toBe('Found a price table but no usable rows.');
  });
});

describe('TableProvider', () => {
  const provider = new TableProvider();

  it('has correct metadata', () => {
    expect(provider.id).toBe('GENERIC_HTML_TABLE');
    expect(provider.requiresTickerSymbol).toBe(false);
    expect(provider.requiresFeedUrl).toBe(true);
    expect(provider.defaultRateLimit.type).toBe('per-minute');
  });

  it('does not implement fetchLatest', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((provider as any).fetchLatest).toBeUndefined();
  });
});
