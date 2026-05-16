import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YahooProvider } from '../yahoo.provider';

// Intercept at the yahoo-client boundary: control what getYahoo() returns per test.
vi.mock('../yahoo-client', () => ({
  getYahoo: vi.fn(),
}));

import { getYahoo } from '../yahoo-client';
const mockGetYahoo = vi.mocked(getYahoo);

function makeChart(returnValue: unknown) {
  const chartFn = vi.fn().mockResolvedValue(returnValue);
  mockGetYahoo.mockReturnValue({ chart: chartFn } as ReturnType<typeof getYahoo>);
  return chartFn;
}

function makeQuote(returnValue: unknown) {
  const quoteFn = vi.fn().mockResolvedValue(returnValue);
  mockGetYahoo.mockReturnValue({ quote: quoteFn } as ReturnType<typeof getYahoo>);
  return quoteFn;
}

function makeCtx(ticker: string, currency: string) {
  return {
    security: {
      uuid: 'test-uuid',
      name: 'Test Security',
      isin: null,
      feed: 'YAHOO',
      feedURL: null,
      tickerSymbol: ticker,
      feedTickerSymbol: null,
      currency,
      latestFeed: null,
      latestFeedURL: null,
    },
    feedProps: {},
    globalSettings: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('YahooProvider', () => {
  const provider = new YahooProvider();

  it('has correct metadata', () => {
    expect(provider.id).toBe('YAHOO');
    expect(provider.requiresTickerSymbol).toBe(true);
    expect(provider.requiresFeedUrl).toBe(false);
    expect(provider.defaultRateLimit.type).toBe('none');
  });

  it('implements fetchHistorical', () => {
    expect(typeof provider.fetchHistorical).toBe('function');
  });

  it('implements fetchLatest', () => {
    expect(typeof provider.fetchLatest).toBe('function');
  });
});

// ─── Minor-unit scale normalisation — fetchHistorical ───────────────────────

describe('YahooProvider — GBp (pence) normalisation via fetchHistorical', () => {
  it('divides close/open/high/low by 100 when meta.currency is GBp', async () => {
    makeChart({
      meta: { currency: 'GBp' },
      quotes: [
        { date: new Date('2024-01-02'), close: 1742, open: 1740, high: 1760, low: 1720, volume: 500000 },
      ],
    });

    const p = new YahooProvider();
    const result = await p.fetchHistorical(makeCtx('ZEG.L', 'GBP'));

    expect(result.prices).toHaveLength(1);
    const bar = result.prices[0];
    expect(bar.close.toNumber()).toBeCloseTo(17.42, 5);
    expect(bar.open?.toNumber()).toBeCloseTo(17.40, 5);
    expect(bar.high?.toNumber()).toBeCloseTo(17.60, 5);
    expect(bar.low?.toNumber()).toBeCloseTo(17.20, 5);
    // Volume is a share count — must NOT be divided
    expect(bar.volume).toBe(500000);
  });

  it('does not scale when meta.currency is USD', async () => {
    makeChart({
      meta: { currency: 'USD' },
      quotes: [
        { date: new Date('2024-01-02'), close: 185.5, open: 183.0, high: 186.0, low: 182.0, volume: 1000000 },
      ],
    });

    const p = new YahooProvider();
    const result = await p.fetchHistorical(makeCtx('AAPL', 'USD'));

    const bar = result.prices[0];
    expect(bar.close.toNumber()).toBeCloseTo(185.5, 5);
    expect(bar.open?.toNumber()).toBeCloseTo(183.0, 5);
  });

  it('does not scale when meta.currency is absent', async () => {
    makeChart({
      meta: {},
      quotes: [
        { date: new Date('2024-01-02'), close: 150.0, open: null, high: null, low: null, volume: null },
      ],
    });

    const p = new YahooProvider();
    const result = await p.fetchHistorical(makeCtx('TEST', 'EUR'));
    expect(result.prices[0].close.toNumber()).toBeCloseTo(150.0, 5);
  });

  it('applies ZAc (JSE cents) scale for ZAR security', async () => {
    makeChart({
      meta: { currency: 'ZAc' },
      quotes: [
        { date: new Date('2024-01-02'), close: 10000, open: null, high: null, low: null, volume: null },
      ],
    });

    const p = new YahooProvider();
    const result = await p.fetchHistorical(makeCtx('TEST.JO', 'ZAR'));
    expect(result.prices[0].close.toNumber()).toBeCloseTo(100.0, 5);
  });

  it('skips GBp scale and logs warning when security.currency is not GBP', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    makeChart({
      meta: { currency: 'GBp' },
      quotes: [
        { date: new Date('2024-01-02'), close: 1742, open: null, high: null, low: null, volume: null },
      ],
    });

    const p = new YahooProvider();
    const result = await p.fetchHistorical(makeCtx('XYZ.L', 'EUR'));
    // Value should be unchanged (no scale applied)
    expect(result.prices[0].close.toNumber()).toBeCloseTo(1742, 5);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipping scale normalisation'));
    warnSpy.mockRestore();
  });
});

// ─── Minor-unit scale normalisation — fetchLatest ───────────────────────────

describe('YahooProvider — GBp normalisation via fetchLatest', () => {
  it('divides regularMarketPrice by 100 when currency is GBp', async () => {
    makeQuote({
      currency: 'GBp',
      regularMarketPrice: 1742,
      regularMarketTime: new Date('2024-01-02T15:00:00Z'),
      regularMarketOpen: 1740,
      regularMarketDayHigh: 1760,
      regularMarketDayLow: 1720,
    });

    const p = new YahooProvider();
    const result = await p.fetchLatest!(makeCtx('ZEG.L', 'GBP'));

    expect(result).not.toBeNull();
    expect(result!.price.toNumber()).toBeCloseTo(17.42, 5);
    expect(result!.open?.toNumber()).toBeCloseTo(17.40, 5);
    expect(result!.high?.toNumber()).toBeCloseTo(17.60, 5);
    expect(result!.low?.toNumber()).toBeCloseTo(17.20, 5);
  });

  it('does not scale latest quote when currency is USD', async () => {
    makeQuote({
      currency: 'USD',
      regularMarketPrice: 185.5,
      regularMarketTime: new Date('2024-01-02T21:00:00Z'),
      regularMarketOpen: null,
      regularMarketDayHigh: null,
      regularMarketDayLow: null,
    });

    const p = new YahooProvider();
    const result = await p.fetchLatest!(makeCtx('AAPL', 'USD'));

    expect(result!.price.toNumber()).toBeCloseTo(185.5, 5);
  });
});
