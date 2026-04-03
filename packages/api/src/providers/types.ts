import Decimal from 'decimal.js';

export interface FetchedPrice {
  date: string;       // YYYY-MM-DD
  close: Decimal;
  high?: Decimal;
  low?: Decimal;
  volume?: number;
}

export interface ProviderResult {
  prices: FetchedPrice[];
  warning?: string;
}

export interface LatestQuote {
  price: Decimal;
  date: string;       // YYYY-MM-DD
}

export interface SecurityRow {
  uuid: string;
  name: string;
  isin: string | null;
  feed: string | null;
  feedURL: string | null;
  tickerSymbol: string | null;
  feedTickerSymbol: string | null;
  currency: string;
  latestFeed: string | null;
  latestFeedURL: string | null;
}

export interface FetchContext {
  security: SecurityRow;
  feedProps: Record<string, string>;
  startDate?: string;
  endDate?: string;
  globalSettings: Record<string, string>;
}

export interface RateLimitConfig {
  type: 'per-minute' | 'per-day' | 'none';
  limit: number;
}

export interface QuoteFeedProvider {
  id: string;
  displayName: string;
  requiresTickerSymbol: boolean;
  requiresFeedUrl: boolean;
  requiresFeedProps: string[];
  defaultRateLimit: RateLimitConfig;
  fetchHistorical(ctx: FetchContext): Promise<ProviderResult>;
  fetchLatest?(ctx: FetchContext): Promise<LatestQuote | null>;
}

export class RateLimitExceededException extends Error {
  constructor(providerId: string) {
    super(`Rate limit exceeded for provider ${providerId}`);
    this.name = 'RateLimitExceededException';
  }
}
