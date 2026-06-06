import type { QuoteFeedProvider, FetchContext, ProviderResult, FetchedPrice } from './types';
import { safeDecimal, parseFlexibleDate, inDateRange } from './utils';

// ─── Header constants ────────────────────────────────────────────────────────
// All candidates MUST be lowercase and accent-free: headers are run through
// normalizeHeader() (lowercase + NFD diacritic strip) before matching, so e.g.
// "Último"/"Máxima" are compared as "ultimo"/"maxima". Adding an accented
// candidate here would never match. `substr` candidates use substring matching;
// keep them long enough to avoid cross-column hits (the short FR low token
// 'bas' assumes a price-HISTORY page layout — it would mis-hit a "Basis"/"Base"
// column on screener-style tables, which this provider does not target).
// Genuinely short/ambiguous tokens ('max'/'min') go in `exact` instead.

interface HeaderSpec {
  substr: string[];
  exact?: string[];
}

const DATE_HEADERS: HeaderSpec = {
  substr: ['date', 'datum', 'data', 'fecha', 'dat'],
};
const CLOSE_HEADERS: HeaderSpec = {
  substr: ['close', 'zuletzt', 'kurs', 'schluss', 'chiusura', 'cierre', 'last', 'price', 'preis', 'dernier', 'precio', 'ultimo', 'laatste', 'ostatnio'],
};
const HIGH_HEADERS: HeaderSpec = {
  substr: ['high', 'hoch', 'alto', 'massimo', 'haut', 'hoog', 'maximo', 'maxima'],
  exact: ['max'],
};
const LOW_HEADERS: HeaderSpec = {
  substr: ['low', 'tief', 'bajo', 'minimo', 'bas', 'laag', 'minima'],
  exact: ['min'],
};
const VOLUME_HEADERS: HeaderSpec = {
  substr: ['volume', 'volumen', 'volum', 'vol'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Lowercase, strip combining diacritics (so "Último" → "ultimo"), trim.
function normalizeHeader(h: string): string {
  return h.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function findColIndex(headers: string[], spec: HeaderSpec): number {
  const norm = headers.map(normalizeHeader);
  for (const c of spec.substr) {
    const idx = norm.findIndex(h => h.includes(c));
    if (idx !== -1) return idx;
  }
  if (spec.exact) {
    for (const c of spec.exact) {
      // Strip a single trailing period (PL "Max." / "Min.") then require an exact match,
      // so short tokens can't substring-match longer words like "Maximum".
      const idx = norm.findIndex(h => h.replace(/\.$/, '') === c);
      if (idx !== -1) return idx;
    }
  }
  return -1;
}

function parseNumericCell(cell: string): number | null {
  // Remove thousands separators and normalize decimal
  const clean = cell.trim().replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

// ─── Pure parse ──────────────────────────────────────────────────────────────

export interface ParseTableOptions {
  startDate?: string;
  endDate?: string;
  dateFormat?: string;
  /** Passed through for caller diagnostics (e.g. URL hints); not read by the parser today. */
  feedUrl?: string;
}

export function parseTableHtml(html: string, opts: ParseTableOptions = {}): ProviderResult {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);

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

      const dateStr = parseFlexibleDate(cells[dateIdx]?.trim(), opts.dateFormat ?? null);
      if (!dateStr) return;
      if (!inDateRange(dateStr, opts.startDate, opts.endDate)) return;

      const closeVal = parseNumericCell(cells[closeIdx] ?? '');
      if (closeVal == null) return;

      const highVal = highIdx !== -1 ? parseNumericCell(cells[highIdx] ?? '') : null;
      const lowVal = lowIdx !== -1 ? parseNumericCell(cells[lowIdx] ?? '') : null;
      const volVal = volIdx !== -1 ? parseNumericCell(cells[volIdx] ?? '') : null;

      results.push({
        date: dateStr,
        close: safeDecimal(closeVal),
        high: highVal != null ? safeDecimal(highVal) : undefined,
        low: lowVal != null ? safeDecimal(lowVal) : undefined,
        volume: volVal != null ? volVal : undefined,
      });
    });
  });

  return { prices: results };
}

// ─── Core fetch function ─────────────────────────────────────────────────────

async function fetchPricesFromTable(
  feedUrl: string,
  startDate?: string,
  endDate?: string,
  dateFormat?: string,
): Promise<ProviderResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const axios = require('axios');

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

    const html = res.data as string;

    // Sanity check: if we got a Cloudflare challenge page, bail early
    if (html.includes('cf-browser-verification') || html.includes('challenges.cloudflare.com')) {
      console.warn(`[prices] TABLE: Cloudflare challenge for ${feedUrl} — cannot scrape without a real browser`);
      return { prices: [], warning: 'Cloudflare challenge — site requires a real browser' };
    }

    return parseTableHtml(html, { startDate, endDate, dateFormat, feedUrl });
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
