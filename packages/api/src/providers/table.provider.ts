import type { QuoteFeedProvider, FetchContext, ProviderResult, FetchedPrice } from './types';
import { safeDecimal, parseFlexibleDate, inDateRange } from './utils';

// ─── Header constants ────────────────────────────────────────────────────────

const DATE_HEADERS = ['date', 'datum', 'data', 'fecha', 'dat'];
const CLOSE_HEADERS = ['close', 'zuletzt', 'kurs', 'schluss', 'chiusura', 'cierre', 'last', 'price', 'preis', 'dernier', 'precio'];
const HIGH_HEADERS = ['high', 'hoch', 'alto', 'massimo'];
const LOW_HEADERS = ['low', 'tief', 'bajo', 'minimo'];
const VOLUME_HEADERS = ['volume', 'volumen', 'volum', 'vol'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findColIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.findIndex(h => h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseNumericCell(cell: string): number | null {
  // Remove thousands separators and normalize decimal
  const clean = cell.trim().replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

// ─── Core fetch function ─────────────────────────────────────────────────────

async function fetchPricesFromTable(
  feedUrl: string,
  startDate?: string,
  endDate?: string,
  dateFormat?: string,
): Promise<ProviderResult> {
  try {
     
    const axios = require('axios');
     
    const cheerio = require('cheerio');

    const res = await axios.get(feedUrl, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });
    const $ = cheerio.load(res.data as string);

    // Sanity check: if we got a Cloudflare challenge page, bail early
    const html = res.data as string;
    if (html.includes('cf-browser-verification') || html.includes('challenges.cloudflare.com')) {
      console.warn(`[prices] TABLE: Cloudflare challenge for ${feedUrl} — cannot scrape without a real browser`);
      return { prices: [], warning: 'Cloudflare challenge — site requires a real browser' };
    }

    const results: FetchedPrice[] = [];

    $('table').each((_i: number, table: unknown) => {
      const headers: string[] = [];
      $(table).find('tr').first().find('th, td').each((_j: number, cell: unknown) => {
        headers.push($(cell).text());
      });

      const dateIdx = findColIndex(headers, DATE_HEADERS);
      const closeIdx = findColIndex(headers, CLOSE_HEADERS);
      if (dateIdx === -1 || closeIdx === -1) return; // not a price table

      const highIdx = findColIndex(headers, HIGH_HEADERS);
      const lowIdx = findColIndex(headers, LOW_HEADERS);
      const volIdx = findColIndex(headers, VOLUME_HEADERS);

      $(table).find('tr').slice(1).each((_j: number, row: unknown) => {
        const cells: string[] = [];
        $(row).find('td').each((_k: number, cell: unknown) => {
          cells.push($(cell).text());
        });
        if (cells.length === 0) return;

        const dateStr = parseFlexibleDate(cells[dateIdx]?.trim(), dateFormat ?? null);
        if (!dateStr) return;
        if (!inDateRange(dateStr, startDate, endDate)) return;

        const closeVal = parseNumericCell(cells[closeIdx] ?? '');
        if (closeVal == null) return;

        results.push({
          date: dateStr,
          close: safeDecimal(closeVal),
          high: highIdx !== -1 && cells[highIdx]
            ? (parseNumericCell(cells[highIdx]) != null
              ? safeDecimal(parseNumericCell(cells[highIdx])!)
              : undefined)
            : undefined,
          low: lowIdx !== -1 && cells[lowIdx]
            ? (parseNumericCell(cells[lowIdx]) != null
              ? safeDecimal(parseNumericCell(cells[lowIdx])!)
              : undefined)
            : undefined,
          volume: volIdx !== -1 && cells[volIdx]
            ? (parseNumericCell(cells[volIdx]) ?? undefined)
            : undefined,
        });
      });
    });

    return { prices: results };
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[prices] TABLE fetch failed for ${feedUrl}:`, msg);
    return { prices: [], warning: msg };
  }
}

// ─── Provider class ──────────────────────────────────────────────────────────

export class TableProvider implements QuoteFeedProvider {
  id = 'GENERIC_HTML_TABLE';
  displayName = 'HTML Table';
  requiresTickerSymbol = false;
  requiresFeedUrl = true;
  requiresFeedProps: string[] = [];
  defaultRateLimit = { type: 'per-minute' as const, limit: 60 };

  async fetchHistorical(ctx: FetchContext): Promise<ProviderResult> {
    if (!ctx.security.feedURL) {
      return { prices: [], warning: 'No feedURL for TABLE provider' };
    }
    return fetchPricesFromTable(
      ctx.security.feedURL,
      ctx.startDate,
      ctx.endDate,
      ctx.feedProps['DATE_FORMAT'],
    );
  }

  // No fetchLatest — HTML scraping doesn't give real-time data
}
