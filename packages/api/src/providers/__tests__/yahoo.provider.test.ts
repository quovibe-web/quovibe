import { describe, it, expect, vi } from 'vitest';
import { YahooProvider } from '../yahoo.provider';
// Mock yahoo-finance2 at the module level
vi.mock('yahoo-finance2', () => {
  const mockYf = {
    chart: vi.fn(),
    quote: vi.fn(),
  };
  return {
    default: class { chart = mockYf.chart; quote = mockYf.quote; },
    __mockYf: mockYf,
  };
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
