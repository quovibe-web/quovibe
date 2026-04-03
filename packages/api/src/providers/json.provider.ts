import type { QuoteFeedProvider, FetchContext, ProviderResult, FetchedPrice } from './types';
import { safeDecimal, parseFlexibleDate, inDateRange } from './utils';
import { JSONPath } from 'jsonpath-plus';

// ─── Core fetch function ─────────────────────────────────────────────────────

async function fetchPricesFromJson(
  feedUrl: string,
  pathToDate: string,
  pathToClose: string,
  options?: {
    dateFormat?: string;
    factor?: number;
    startDate?: string;
    endDate?: string;
  },
): Promise<ProviderResult> {
  try {
     
    const axios = require('axios');

    const res = await axios.get(feedUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    const data = res.data as object;
    const dates: unknown[] = JSONPath({ path: pathToDate, json: data }) as unknown[];
    const closes: unknown[] = JSONPath({ path: pathToClose, json: data }) as unknown[];

    if (!Array.isArray(dates) || !Array.isArray(closes)) {
      const warn = `JSONPath returned non-array for ${feedUrl}`;
      console.warn(`[prices] JSON provider:`, warn);
      return { prices: [], warning: warn };
    }

    const len = Math.min(dates.length, closes.length);
    const results: FetchedPrice[] = [];

    for (let i = 0; i < len; i++) {
      const dateStr = parseFlexibleDate(dates[i], options?.dateFormat ?? null);
      if (!dateStr) continue;
      if (!inDateRange(dateStr, options?.startDate, options?.endDate)) continue;

      const rawClose = closes[i];
      if (rawClose == null) continue;

      let closeVal = safeDecimal(String(rawClose));
      if (options?.factor != null) {
        closeVal = closeVal.mul(options.factor);
      }

      results.push({ date: dateStr, close: closeVal });
    }

    return { prices: results };
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[prices] JSON fetch failed for ${feedUrl}:`, msg);
    return { prices: [], warning: msg };
  }
}

// ─── Provider class ──────────────────────────────────────────────────────────

export class JsonProvider implements QuoteFeedProvider {
  id = 'GENERIC-JSON';
  displayName = 'JSON API';
  requiresTickerSymbol = false;
  requiresFeedUrl = true;
  requiresFeedProps = ['GENERIC-JSON-DATE', 'GENERIC-JSON-CLOSE'];
  defaultRateLimit = { type: 'per-minute' as const, limit: 60 };

  async fetchHistorical(ctx: FetchContext): Promise<ProviderResult> {
    if (!ctx.security.feedURL) {
      return { prices: [], warning: 'No feedURL for JSON provider' };
    }
    const pathToDate = ctx.feedProps['GENERIC-JSON-DATE'];
    const pathToClose = ctx.feedProps['GENERIC-JSON-CLOSE'];
    if (!pathToDate || !pathToClose) {
      return { prices: [], warning: 'Missing JSONPath config (GENERIC-JSON-DATE / GENERIC-JSON-CLOSE)' };
    }
    return fetchPricesFromJson(ctx.security.feedURL, pathToDate, pathToClose, {
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      dateFormat: ctx.feedProps['DATE_FORMAT'],
      factor: ctx.feedProps['GENERIC-JSON-FACTOR'] ? Number(ctx.feedProps['GENERIC-JSON-FACTOR']) : undefined,
    });
  }

  // No fetchLatest — generic JSON has no standard latest endpoint
}
