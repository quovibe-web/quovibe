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
