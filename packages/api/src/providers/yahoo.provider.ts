import Decimal from 'decimal.js';
import { addDays } from 'date-fns';
import type { QuoteFeedProvider, FetchContext, ProviderResult, LatestQuote, FetchedPrice, SecurityRow } from './types';
import { toYMD, safeDecimal } from './utils';
import { getYahoo } from './yahoo-client';

// ─── Minor-unit normalization ─────────────────────────────────────────────────
// Some exchanges quote prices in minor currency units (pence, cents, agorot).
// Yahoo Finance signals this via a currency code like 'GBp' instead of 'GBP'.
// We normalise to the major unit on the way in so stored prices match the
// security.currency value populated by PP-XML imports ('GBP', 'ZAR', 'ILS').

const MINOR_TO_MAJOR: Record<string, { major: string; divisor: number }> = {
  GBp: { major: 'GBP', divisor: 100 },
  GBX: { major: 'GBP', divisor: 100 },
  ZAc: { major: 'ZAR', divisor: 100 },
  ILA: { major: 'ILS', divisor: 100 },
};

function applyMinorUnitScale(
  value: Decimal,
  yahooCurrency: string | undefined | null,
  securityCurrency: string | undefined | null,
): Decimal {
  if (!yahooCurrency) return value;
  const rule = MINOR_TO_MAJOR[yahooCurrency];
  if (!rule) return value;
  // Guard: only normalise when the security's stored currency is the major unit
  // (e.g. GBP). If security.currency is something unexpected, skip and warn.
  if (securityCurrency && securityCurrency !== rule.major) {
    console.warn(
      `[prices] Yahoo currency '${yahooCurrency}' (minor of ${rule.major}) ` +
      `but security.currency='${securityCurrency}' — skipping scale normalisation`,
    );
    return value;
  }
  return value.div(rule.divisor);
}

// ─── Core Yahoo functions ────────────────────────────────────────────────────

async function fetchPricesFromYahoo(
  ticker: string,
  securityCurrency: string | undefined,
  startDate?: string,
  endDate?: string,
): Promise<FetchedPrice[]> {
  interface YahooChartQuote {
    date: Date;
    close: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
  }
  const yf = getYahoo() as {
    chart: (t: string, opts: unknown) => Promise<{ meta?: { currency?: string }; quotes: YahooChartQuote[] }>;
  };
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

  const yahooCurrency = result.meta?.currency;

  return result.quotes
    .filter((r): r is YahooChartQuote & { close: number } => r.close != null)
    .map((r) => ({
      date: toYMD(r.date),
      close: applyMinorUnitScale(safeDecimal(r.close), yahooCurrency, securityCurrency),
      open: r.open != null ? applyMinorUnitScale(safeDecimal(r.open), yahooCurrency, securityCurrency) : undefined,
      high: r.high != null ? applyMinorUnitScale(safeDecimal(r.high), yahooCurrency, securityCurrency) : undefined,
      low: r.low != null ? applyMinorUnitScale(safeDecimal(r.low), yahooCurrency, securityCurrency) : undefined,
      volume: r.volume ?? undefined,
    }));
}

interface YahooQuoteResponse {
  currency?: string | null;
  regularMarketPrice?: number | null;
  regularMarketTime?: Date;
  regularMarketOpen?: number | null;
  regularMarketDayHigh?: number | null;
  regularMarketDayLow?: number | null;
}

async function fetchLatestQuote(ticker: string, securityCurrency: string | undefined): Promise<LatestQuote | null> {
  try {
    const yf = getYahoo() as { quote: (t: string) => Promise<YahooQuoteResponse | null> };
    const result = await yf.quote(ticker);
    if (result?.regularMarketPrice == null) return null;
    const yahooCurrency = result.currency ?? undefined;
    const scale = (v: Decimal) => applyMinorUnitScale(v, yahooCurrency, securityCurrency);
    const price = scale(safeDecimal(result.regularMarketPrice));
    const rawTime = result.regularMarketTime;
    // regularMarketTime is a Date object from yahoo-finance2
    const date = rawTime instanceof Date ? toYMD(rawTime) : toYMD(new Date());
    return {
      price, date,
      open: result.regularMarketOpen != null ? scale(safeDecimal(result.regularMarketOpen)) : undefined,
      high: result.regularMarketDayHigh != null ? scale(safeDecimal(result.regularMarketDayHigh)) : undefined,
      low: result.regularMarketDayLow != null ? scale(safeDecimal(result.regularMarketDayLow)) : undefined,
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
  const secCurrency = row.currency ?? undefined;
  let prices: FetchedPrice[] = [];
  try {
    prices = await fetchPricesFromYahoo(primary, secCurrency, startDate, endDate);
  } catch (err) {
    if (!row.isin) throw err;
    console.warn(`[prices] Yahoo fetch threw for ticker "${primary}", retrying with ISIN "${row.isin}":`, (err as Error).message);
    return await fetchPricesFromYahoo(row.isin, secCurrency, startDate, endDate);
  }
  if (prices.length === 0 && row.isin) {
    console.warn(`[prices] Yahoo returned 0 prices for ticker "${primary}", retrying with ISIN "${row.isin}"`);
    const isinPrices = await fetchPricesFromYahoo(row.isin, secCurrency, startDate, endDate).catch(() => [] as FetchedPrice[]);
    if (isinPrices.length > 0) return isinPrices;
  }
  return prices;
}

async function fetchLatestQuoteWithFallback(row: SecurityRow): Promise<LatestQuote | null> {
  const primary = row.feedTickerSymbol ?? row.tickerSymbol ?? row.name;
  const secCurrency = row.currency ?? undefined;
  const quote = await fetchLatestQuote(primary, secCurrency);
  if (quote !== null || !row.isin) return quote;
  console.warn(`[prices] Latest quote returned null for ticker "${primary}", retrying with ISIN "${row.isin}"`);
  return await fetchLatestQuote(row.isin, secCurrency);
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
