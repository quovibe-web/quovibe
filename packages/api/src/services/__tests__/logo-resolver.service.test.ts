import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveLogo } from '../logo-resolver.service';

// Spy on quoteSummary at the prototype level so require() and import() both see the stub
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yf2 = require('yahoo-finance2');
const YahooFinance = yf2.default ?? yf2;
const quoteSummarySpy = vi.spyOn(YahooFinance.prototype, 'quoteSummary');

function makeFetchResponse(body: unknown, contentType = 'image/png', ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: (_: string) => contentType },
    arrayBuffer: async () => Buffer.from('fakeimage').buffer,
    json: async () => body,
  };
}

describe('resolveLogo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    // Re-attach spy after restoreAllMocks
    vi.spyOn(YahooFinance.prototype, 'quoteSummary');
  });

  it('resolves account logo by domain directly (no ticker needed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    const result = await resolveLogo({ domain: 'interactivebrokers.com' });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=interactivebrokers.com&sz=128',
      expect.any(Object),
    );
  });

  it('resolves equity logo via Yahoo Finance website + favicon', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
      assetProfile: { website: 'https://www.nvidia.com' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    const result = await resolveLogo({ ticker: 'NVDA', instrumentType: 'EQUITY' });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=www.nvidia.com&sz=128',
      expect.any(Object),
    );
  });

  it('resolves crypto logo via CoinGecko image URL', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeFetchResponse([{ id: 'bitcoin', symbol: 'btc' }], 'application/json'))
      .mockResolvedValueOnce(makeFetchResponse({ image: { large: 'https://cdn.coingecko.com/coins/images/1/large/bitcoin.png' } }, 'application/json'))
      .mockResolvedValueOnce(makeFetchResponse({}, 'image/png')),
    );
    const result = await resolveLogo({ ticker: 'BTC-USD', instrumentType: 'CRYPTO' });
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('falls back to ticker.com favicon when Yahoo Finance returns no website', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({ assetProfile: { website: undefined } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    const result = await resolveLogo({ ticker: 'AAPL', instrumentType: 'EQUITY' });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=aapl.com&sz=128',
      expect.any(Object),
    );
  });

  it('throws when all strategies fail', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    await expect(resolveLogo({ ticker: 'XXXX', instrumentType: 'EQUITY' })).rejects.toThrow('Logo not found');
  });

  it('domain overrides ticker+instrumentType when both provided', async () => {
    const spy = vi.spyOn(YahooFinance.prototype, 'quoteSummary');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    await resolveLogo({ ticker: 'NVDA', instrumentType: 'EQUITY', domain: 'nvidia.com' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=nvidia.com&sz=128',
      expect.any(Object),
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
