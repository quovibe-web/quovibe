import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveLogo, findFundDomain } from '../logo-resolver.service';

// Spy on quoteSummary at the prototype level so require() and import() both see the stub
const yf2 = require('yahoo-finance2');
const YahooFinance = yf2.default ?? yf2;

function makeFetchResponse(body: unknown, contentType = 'image/png', ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: (_: string) => contentType },
    arrayBuffer: async () => Buffer.from('fakeimage').buffer,
    json: async () => body,
  };
}

describe('findFundDomain', () => {
  it('matches exact fund family name (case-insensitive)', () => {
    expect(findFundDomain('iShares')).toBe('ishares.com');
    expect(findFundDomain('ISHARES')).toBe('ishares.com');
    expect(findFundDomain('Vanguard')).toBe('vanguard.com');
    expect(findFundDomain('Xtrackers')).toBe('dws.com');
  });

  it('returns undefined for unknown fund family', () => {
    expect(findFundDomain('Unknown Provider')).toBeUndefined();
  });

  it('falls back to shortName prefix match when family is undefined', () => {
    expect(findFundDomain(undefined, 'iShares Core MSCI World UCITS ETF')).toBe('ishares.com');
    expect(findFundDomain(undefined, 'Vanguard S&P 500 ETF')).toBe('vanguard.com');
  });

  it('prefers family over shortName when both are present', () => {
    // family is 'Invesco', shortName starts with 'iShares' — family wins
    expect(findFundDomain('Invesco', 'iShares Core MSCI World')).toBe('invesco.com');
  });

  it('returns undefined when both family and shortName are undefined', () => {
    expect(findFundDomain(undefined, undefined)).toBeUndefined();
  });

  it('does not false-match ETF shortNames that start with "ark" but are not ARK Invest', () => {
    expect(findFundDomain(undefined, 'Arkema S.A. ETF')).toBeUndefined();
    expect(findFundDomain(undefined, 'ARK Innovation ETF')).toBe('ark-invest.com');
  });
});

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

  it('retries Yahoo Finance with base ticker when exchange-suffixed ticker has no website', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary')
      .mockResolvedValueOnce({ assetProfile: { website: undefined } }) // RACE.MI — no website
      .mockResolvedValueOnce({ assetProfile: { website: 'https://www.ferrari.com' } }); // RACE — has website
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    const result = await resolveLogo({ ticker: 'RACE.MI', instrumentType: 'EQUITY' });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=www.ferrari.com&sz=128',
      expect.any(Object),
    );
  });

  it('falls back to base-ticker.com favicon when both Yahoo calls return no website', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({ assetProfile: { website: undefined } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    await resolveLogo({ ticker: 'RACE.MI', instrumentType: 'EQUITY' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=race.com&sz=128',
      expect.any(Object),
    );
  });

  it('throws when all strategies fail', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    await expect(resolveLogo({ ticker: 'XXXX', instrumentType: 'EQUITY' })).rejects.toThrow('Logo not found');
  });

  describe('ETF logo resolution', () => {
    it('resolves ETF logo via fundProfile.family → issuer domain', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        fundProfile: { family: 'iShares' },
        quoteType: { shortName: 'iShares Core MSCI World UCITS ETF' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'SWDA', instrumentType: 'ETF' });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
        expect.any(Object),
      );
    });

    it('resolves ETF logo via shortName prefix when fundProfile.family is missing', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        fundProfile: {},
        quoteType: { shortName: 'Vanguard FTSE All-World UCITS ETF' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'VWRL', instrumentType: 'ETF' });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
        expect.any(Object),
      );
    });

    it('retries with base ticker for exchange-suffixed ETF', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary')
        .mockResolvedValueOnce({ fundProfile: {}, quoteType: {} }) // SWDA.MI — no family
        .mockResolvedValueOnce({                                     // SWDA — has family
          fundProfile: { family: 'iShares' },
          quoteType: { shortName: 'iShares Core MSCI World UCITS ETF' },
        });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'SWDA.MI', instrumentType: 'ETF' });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
        expect.any(Object),
      );
    });

    it('falls back to equity path when fund family is not in the map', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary')
        .mockResolvedValueOnce({ fundProfile: { family: 'Obscure Niche Provider' }, quoteType: {} }) // ETF call — no match
        .mockResolvedValueOnce({ assetProfile: { website: 'https://www.obscurefund.com' } });         // equity fallback
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'OBSCURE', instrumentType: 'ETF' });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=www.obscurefund.com&sz=128',
        expect.any(Object),
      );
    });

    it('resolves FUND instrument type the same as ETF', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        fundProfile: { family: 'Vanguard' },
        quoteType: {},
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'VFIAX', instrumentType: 'FUND' });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
        expect.any(Object),
      );
    });

    it('rethrows Yahoo Finance network errors from resolveFund (does not silently fall to equity)', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockRejectedValue(new Error('network timeout'));
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network timeout')));
      await expect(resolveLogo({ ticker: 'SWDA', instrumentType: 'ETF' })).rejects.toThrow('Logo not found');
    });
  });

  it('resolves without instrumentType (uses Yahoo Finance path)', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
      assetProfile: { website: 'https://www.ferrari.com' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    const result = await resolveLogo({ ticker: 'RACE' });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=www.ferrari.com&sz=128',
      expect.any(Object),
    );
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
