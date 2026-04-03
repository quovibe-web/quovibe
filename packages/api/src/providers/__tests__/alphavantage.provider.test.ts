import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlphaVantageProvider } from '../alphavantage.provider';
import type { FetchContext, SecurityRow } from '../types';

// Mock axios
vi.mock('axios', () => {
  const fn = vi.fn();
  return { default: { get: fn }, get: fn };
});

import axios from 'axios';
const mockGet = vi.mocked(axios.get);

const HISTORICAL_CSV = `timestamp,open,high,low,close,volume
2026-03-12,150.00,152.00,149.00,151.50,1000000
2026-03-11,148.00,150.50,147.50,150.00,900000
2026-03-10,0.00,0.00,0.00,0.00,0`;

const INTRADAY_CSV = `timestamp,open,high,low,close,volume
2026-03-12 15:59:00,151.00,151.50,150.80,151.20,50000
2026-03-12 15:58:00,150.80,151.10,150.70,151.00,30000`;

const ERROR_JSON = '{"Error Message": "Invalid API call"}';
const RATE_LIMIT_JSON = '{"Note": "Thank you for using Alpha Vantage! Our standard API call frequency is limited."}';

function makeCtx(overrides?: Partial<SecurityRow>): FetchContext {
  return {
    security: {
      uuid: 'sec-1', name: 'Test Stock', isin: null, feed: 'ALPHAVANTAGE',
      feedURL: null, tickerSymbol: 'AAPL', feedTickerSymbol: null,
      currency: 'USD', latestFeed: null, latestFeedURL: null,
      ...overrides,
    },
    feedProps: {},
    globalSettings: { 'provider.alphavantage.apiKey': 'demo-key' },
  };
}

describe('AlphaVantageProvider', () => {
  const provider = new AlphaVantageProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct metadata', () => {
    expect(provider.id).toBe('ALPHAVANTAGE');
    expect(provider.requiresTickerSymbol).toBe(true);
    expect(provider.requiresFeedUrl).toBe(false);
    expect(provider.defaultRateLimit).toEqual({ type: 'per-day', limit: 25 });
  });

  describe('fetchHistorical', () => {
    it('parses CSV response correctly', async () => {
      mockGet.mockResolvedValueOnce({ data: HISTORICAL_CSV });
      const result = await provider.fetchHistorical(makeCtx());
      // Zero-price row (2026-03-10) should be skipped
      expect(result.prices).toHaveLength(2);
      expect(result.prices[0].date).toBe('2026-03-12');
      expect(result.prices[0].close.toString()).toBe('151.5');
      expect(result.prices[0].high?.toString()).toBe('152');
      expect(result.prices[0].low?.toString()).toBe('149');
      expect(result.prices[0].volume).toBe(1000000);
    });

    it('returns error on missing API key', async () => {
      const ctx = makeCtx();
      ctx.globalSettings = {};
      const result = await provider.fetchHistorical(ctx);
      expect(result.warning).toContain('API key');
      expect(result.prices).toHaveLength(0);
    });

    it('handles AV JSON error response', async () => {
      mockGet.mockResolvedValueOnce({ data: ERROR_JSON });
      const result = await provider.fetchHistorical(makeCtx());
      expect(result.warning).toContain('Invalid API call');
      expect(result.prices).toHaveLength(0);
    });

    it('throws RateLimitExceededException on rate limit response', async () => {
      mockGet.mockResolvedValueOnce({ data: RATE_LIMIT_JSON });
      await expect(provider.fetchHistorical(makeCtx())).rejects.toThrow('Rate limit');
    });

    it('uses feedTickerSymbol if available', async () => {
      mockGet.mockResolvedValueOnce({ data: HISTORICAL_CSV });
      await provider.fetchHistorical(makeCtx({ feedTickerSymbol: 'AAPL.US' }));
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('symbol=AAPL.US'),
        expect.anything(),
      );
    });

    it('uses compact outputsize when startDate is recent', async () => {
      mockGet.mockResolvedValueOnce({ data: HISTORICAL_CSV });
      const ctx = makeCtx();
      ctx.startDate = '2026-03-01'; // ~12 days ago, < 80
      await provider.fetchHistorical(ctx);
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('outputsize=compact'),
        expect.anything(),
      );
    });
  });

  describe('fetchLatest', () => {
    it('parses intraday CSV and returns most recent row', async () => {
      mockGet.mockResolvedValueOnce({ data: INTRADAY_CSV });
      const result = await provider.fetchLatest!(makeCtx());
      expect(result).not.toBeNull();
      expect(result!.price.toString()).toBe('151.2');
      expect(result!.date).toBe('2026-03-12');
    });
  });
});
