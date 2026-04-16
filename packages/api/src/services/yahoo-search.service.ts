import { addDays } from 'date-fns';
import { normalizeInstrumentType, type InstrumentType } from '@quovibe/shared';
import type { SearchResult } from '@quovibe/shared';
import { safeDecimal, toYMD } from '../providers/utils';
import { getYahoo } from '../providers/yahoo-client';

// ─── Internal Yahoo types ────────────────────────────────────────────────────

interface YahooQuote {
  symbol?: string;
  longname?: string | null;
  shortname?: string | null;
  exchange?: string;
  exchDisp?: string | null;
  quoteType?: string;
  sector?: string | null;
  industry?: string | null;
}

// ─── Preview types ───────────────────────────────────────────────────────────

export interface PreviewPrice {
  date: string;
  close: string;
  high?: string;
  low?: string;
  volume?: number;
}

export interface PreviewPricesResult {
  currency: string;
  prices: PreviewPrice[];
}

// ─── In-memory search cache (TTL-based) ──────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 200;
// quovibe:allow-module-state — Yahoo symbol-search cache keyed by user query; portfolio-agnostic (ADR-016).
const searchCache = new Map<string, CacheEntry<SearchResult[]>>();

function getCached(key: string): SearchResult[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: SearchResult[]): void {
  // Evict oldest entries if cache is full
  if (searchCache.size >= CACHE_MAX_SIZE) {
    const firstKey = searchCache.keys().next().value!;
    searchCache.delete(firstKey);
  }
  searchCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Exported for testing
export function clearSearchCache(): void {
  searchCache.clear();
}

export function getSearchCacheSize(): number {
  return searchCache.size;
}

// ─── Yahoo Finance wrapper ───────────────────────────────────────────────────

interface YahooFinanceClient {
  search: (q: string) => Promise<{ quotes?: YahooQuote[] }>;
  chart: (t: string, opts: unknown) => Promise<{
    meta?: { currency?: string | null };
    quotes?: Array<{
      date: Date;
      close: number | null;
      high: number | null;
      low: number | null;
      volume: number | null;
    }>;
  }>;
}

function getYf(): YahooFinanceClient {
  return getYahoo() as unknown as YahooFinanceClient;
}

function mapQuoteToSearchResult(q: YahooQuote): SearchResult {
  const rawType = q.quoteType ?? '';
  return {
    symbol: q.symbol ?? '',
    name: q.longname ?? q.shortname ?? q.symbol ?? '',
    type: normalizeInstrumentType(rawType) as InstrumentType,
    exchange: q.exchange ?? '',
    exchDisp: q.exchDisp ?? null,
    sector: q.sector ?? null,
    industry: q.industry ?? null,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function searchYahoo(query: string): Promise<SearchResult[]> {
  const cacheKey = query.trim().toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const yf = getYf();
    const result = await yf.search(query);
    const items: SearchResult[] = (result.quotes ?? []).map(mapQuoteToSearchResult);
    setCache(cacheKey, items);
    return items;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Re-throw as a structured error the route layer can handle
    throw new YahooSearchError(message);
  }
}

export async function fetchPreviewPrices(ticker: string, startDate?: string): Promise<PreviewPricesResult> {
  try {
    const yf = getYf();
    const chartResult = await yf.chart(ticker, {
      period1: startDate ?? '2000-01-01',
      period2: toYMD(addDays(new Date(), 1)),
      interval: '1d' as const,
    });

    const currency: string = chartResult.meta?.currency ?? '';
    type ChartQuote = NonNullable<typeof chartResult.quotes>[number];
    const prices: PreviewPrice[] = (chartResult.quotes ?? [])
      .filter((r): r is ChartQuote & { close: number } => r.close != null)
      .map((r) => ({
        date: toYMD(r.date),
        close: safeDecimal(r.close).toString(),
        ...(r.high != null ? { high: safeDecimal(r.high).toString() } : {}),
        ...(r.low != null ? { low: safeDecimal(r.low).toString() } : {}),
        ...(r.volume != null ? { volume: r.volume } : {}),
      }));

    return { currency, prices };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new YahooSearchError(message);
  }
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class YahooSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YahooSearchError';
  }
}
