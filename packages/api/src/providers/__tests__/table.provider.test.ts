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
