import axios from 'axios';
import { differenceInDays } from 'date-fns';
import type { QuoteFeedProvider, FetchContext, ProviderResult, LatestQuote } from './types';
import { RateLimitExceededException } from './types';
import { safeDecimal, inDateRange } from './utils';

const AV_BASE = 'https://www.alphavantage.co/query';
const DAYS_THRESHOLD = 80;

function getSymbol(ctx: FetchContext): string {
  return ctx.security.feedTickerSymbol ?? ctx.security.tickerSymbol ?? ctx.security.name;
}

function getApiKey(ctx: FetchContext): string | null {
  return ctx.globalSettings['provider.alphavantage.apiKey'] ?? null;
}

function detectJsonError(data: string): { error?: string; rateLimited?: boolean } {
  const trimmed = data.trim();
  if (!trimmed.startsWith('{')) return {};
  try {
    const json = JSON.parse(trimmed);
    if (json['Error Message']) return { error: json['Error Message'] };
    if (json['Note']) return { rateLimited: true };
    if (json['Information']) return { error: json['Information'] };
    return {};
  } catch {
    return {};
  }
}

function parseCsvRows(csv: string, startDate?: string, endDate?: string) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  // Skip header row
  const rows = lines.slice(1);
  const prices: Array<{
    date: string; close: ReturnType<typeof safeDecimal>;
    high: ReturnType<typeof safeDecimal>; low: ReturnType<typeof safeDecimal>;
    volume: number;
  }> = [];

  for (const line of rows) {
    const cols = line.split(',').map(c => c.trim());
    if (cols.length < 6) continue;

    // timestamp may be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS"
    const date = cols[0].substring(0, 10);
    const close = safeDecimal(cols[4]);
    if (close.isZero()) continue; // skip zero-price rows

    if (!inDateRange(date, startDate, endDate)) continue;

    prices.push({
      date,
      close,
      high: safeDecimal(cols[2]),
      low: safeDecimal(cols[3]),
      volume: parseInt(cols[5], 10) || 0,
    });
  }

  return prices;
}

export class AlphaVantageProvider implements QuoteFeedProvider {
  id = 'ALPHAVANTAGE';
  displayName = 'Alpha Vantage';
  requiresTickerSymbol = true;
  requiresFeedUrl = false;
  requiresFeedProps: string[] = [];
  defaultRateLimit = { type: 'per-day' as const, limit: 25 };

  async fetchHistorical(ctx: FetchContext): Promise<ProviderResult> {
    const apiKey = getApiKey(ctx);
    if (!apiKey) {
      return { prices: [], warning: 'Alpha Vantage API key not configured. Set it in Settings → Quote Providers.' };
    }

    const symbol = getSymbol(ctx);

    // Determine compact vs full
    let outputsize = 'full';
    if (ctx.startDate) {
      const daysSince = differenceInDays(new Date(), new Date(ctx.startDate));
      if (daysSince < DAYS_THRESHOLD) {
        outputsize = 'compact';
      }
    }

    const url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}&datatype=csv&outputsize=${outputsize}`;

    const res = await axios.get(url, { timeout: 30000 });
    const data = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

    // Check for JSON error responses
    const jsonCheck = detectJsonError(data);
    if (jsonCheck.rateLimited) {
      throw new RateLimitExceededException('ALPHAVANTAGE');
    }
    if (jsonCheck.error) {
      return { prices: [], warning: jsonCheck.error };
    }

    const prices = parseCsvRows(data, ctx.startDate, ctx.endDate);
    return { prices };
  }

  async fetchLatest(ctx: FetchContext): Promise<LatestQuote | null> {
    const apiKey = getApiKey(ctx);
    if (!apiKey) return null;

    const symbol = getSymbol(ctx);
    const url = `${AV_BASE}?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(symbol)}&interval=1min&apikey=${apiKey}&datatype=csv&outputsize=compact`;

    try {
      const res = await axios.get(url, { timeout: 15000 });
      const data = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

      const jsonCheck = detectJsonError(data);
      if (jsonCheck.rateLimited || jsonCheck.error) return null;

      const rows = parseCsvRows(data);
      if (rows.length === 0) return null;

      // Most recent row is first
      const latest = rows[0];
      return { price: latest.close, date: latest.date };
    } catch {
      return null;
    }
  }
}
