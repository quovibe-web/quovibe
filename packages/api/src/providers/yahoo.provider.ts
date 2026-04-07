import { addDays } from 'date-fns';
import type { QuoteFeedProvider, FetchContext, ProviderResult, LatestQuote, FetchedPrice, SecurityRow } from './types';
import { toYMD, safeDecimal } from './utils';

// ─── Core Yahoo functions ────────────────────────────────────────────────────

async function fetchPricesFromYahoo(
  ticker: string,
  startDate?: string,
  endDate?: string,
): Promise<FetchedPrice[]> {
   
  const mod = require('yahoo-finance2');
  const YahooFinance = mod.default ?? mod;
  const yf = new YahooFinance();
  let result;
  try {
    result = await yf.chart(ticker, {
      period1: startDate ?? '2000-01-01',
      period2: endDate ?? toYMD(addDays(new Date(), 1)), // Yahoo chart API is exclusive, +1 day fetches today
      interval: '1d' as const,
    });
  } catch (err) {
    const msg = (err as Error).message ?? '';
    // "No data found" / "Data doesn't exist" = no prices for this date range (not yet available)
    if (msg.includes('No data found') || msg.includes("Data doesn't exist")) {
      return [];
    }
    throw err;
  }

  return result.quotes
    .filter((r: { close: number | null }) => r.close != null)
    .map((r: { date: Date; close: number; open: number | null; high: number | null; low: number | null; volume: number | null }) => ({
      date: toYMD(r.date),
      close: safeDecimal(r.close),
      open: r.open != null ? safeDecimal(r.open) : undefined,
      high: r.high != null ? safeDecimal(r.high) : undefined,
      low: r.low != null ? safeDecimal(r.low) : undefined,
      volume: r.volume ?? undefined,
    }));
}

async function fetchLatestQuote(ticker: string): Promise<LatestQuote | null> {
  try {
     
    const mod = require('yahoo-finance2');
    const YahooFinance = mod.default ?? mod;
    const yf = new YahooFinance();
    const result = await yf.quote(ticker);
    if (result?.regularMarketPrice == null) return null;
    const price = safeDecimal(result.regularMarketPrice);
    const rawTime = result.regularMarketTime;
    // regularMarketTime is a Date object from yahoo-finance2
    const date = rawTime instanceof Date ? toYMD(rawTime) : toYMD(new Date());
    return {
      price, date,
      open: result.regularMarketOpen != null ? safeDecimal(result.regularMarketOpen) : undefined,
      high: result.regularMarketDayHigh != null ? safeDecimal(result.regularMarketDayHigh) : undefined,
      low: result.regularMarketDayLow != null ? safeDecimal(result.regularMarketDayLow) : undefined,
    };
  } catch {
    return null;
  }
}

// Try primary ticker; if it throws or returns 0 prices and an ISIN is available, retry with ISIN.
async function fetchPricesFromYahooWithFallback(
  row: SecurityRow,
  startDate?: string,
  endDate?: string,
): Promise<FetchedPrice[]> {
  const primary = row.feedTickerSymbol ?? row.tickerSymbol ?? row.name;
  let prices: FetchedPrice[] = [];
  try {
    prices = await fetchPricesFromYahoo(primary, startDate, endDate);
  } catch (err) {
    if (!row.isin) throw err;
    console.warn(`[prices] Yahoo fetch threw for ticker "${primary}", retrying with ISIN "${row.isin}":`, (err as Error).message);
    return await fetchPricesFromYahoo(row.isin, startDate, endDate);
  }
  if (prices.length === 0 && row.isin) {
    console.warn(`[prices] Yahoo returned 0 prices for ticker "${primary}", retrying with ISIN "${row.isin}"`);
    const isinPrices = await fetchPricesFromYahoo(row.isin, startDate, endDate).catch(() => [] as FetchedPrice[]);
    if (isinPrices.length > 0) return isinPrices;
  }
  return prices;
}

async function fetchLatestQuoteWithFallback(row: SecurityRow): Promise<LatestQuote | null> {
  const primary = row.feedTickerSymbol ?? row.tickerSymbol ?? row.name;
  const quote = await fetchLatestQuote(primary);
  if (quote !== null || !row.isin) return quote;
  console.warn(`[prices] Latest quote returned null for ticker "${primary}", retrying with ISIN "${row.isin}"`);
  return await fetchLatestQuote(row.isin);
}

// ─── Provider class ──────────────────────────────────────────────────────────

export class YahooProvider implements QuoteFeedProvider {
  id = 'YAHOO';
  displayName = 'Yahoo Finance';
  requiresTickerSymbol = true;
  requiresFeedUrl = false;
  requiresFeedProps: string[] = [];
  defaultRateLimit = { type: 'none' as const, limit: 0 };

  async fetchHistorical(ctx: FetchContext): Promise<ProviderResult> {
    const prices = await fetchPricesFromYahooWithFallback(ctx.security, ctx.startDate, ctx.endDate);
    return { prices };
  }

  async fetchLatest(ctx: FetchContext): Promise<LatestQuote | null> {
    return fetchLatestQuoteWithFallback(ctx.security);
  }
}
