import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstrumentType } from '@quovibe/shared';
import { resolveLogo, findFundDomain, LogoResolverError } from '../logo-resolver.service';

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

// Google's default globe favicon (sz=128, no real favicon for the domain) is ~650 bytes;
// a real one is typically ≥ 2 KB. Tests drive the placeholder detector by buffer size.
function makeFaviconResponse(sizeBytes: number) {
  return {
    ok: true,
    status: 200,
    headers: { get: (_: string) => 'image/png' },
    arrayBuffer: async () => Buffer.alloc(sizeBytes).buffer,
    json: async () => ({}),
  };
}

describe('findFundDomain', () => {
  it('matches exact family name (case-insensitive)', () => {
    expect(findFundDomain('iShares')).toBe('ishares.com');
    expect(findFundDomain('ISHARES')).toBe('ishares.com');
    expect(findFundDomain('Vanguard')).toBe('vanguard.com');
    expect(findFundDomain('Xtrackers')).toBe('dws.com');
  });

  it('returns undefined for unknown provider', () => {
    expect(findFundDomain('Unknown Provider')).toBeUndefined();
    expect(findFundDomain(undefined, undefined)).toBeUndefined();
  });

  it('prefers family over shortName when both are present', () => {
    expect(findFundDomain('Invesco', 'iShares Core MSCI World')).toBe('invesco.com');
  });

  it('falls back to shortName when family is absent', () => {
    expect(findFundDomain(undefined, 'iShares Core MSCI World UCITS ETF')).toBe('ishares.com');
    expect(findFundDomain(undefined, 'Vanguard S&P 500 ETF')).toBe('vanguard.com');
  });

  it('matches verbose family names — word-boundary prefix (e.g. "Avantis Investors")', () => {
    expect(findFundDomain('Avantis Investors')).toBe('avantisinvestors.com');
    expect(findFundDomain('Dimensional Fund Advisors')).toBe('dimensional.com');
    expect(findFundDomain('ARK Investment Management LLC')).toBe('ark-invest.com');
  });

  it('normalises punctuation before matching (dots, dashes, ampersands)', () => {
    expect(findFundDomain('J.P. Morgan Asset Management')).toBe('jpmorgan.com');
    expect(findFundDomain('BNP Paribas Easy')).toBe('bnpparibas-am.com');
    expect(findFundDomain('Legal & General Investment Management')).toBe('lgim.com');
  });

  it('does not false-match on partial word overlap ("Arkema" vs "ARK")', () => {
    expect(findFundDomain(undefined, 'Arkema S.A. ETF')).toBeUndefined();
    expect(findFundDomain(undefined, 'ARK Innovation ETF')).toBe('ark-invest.com');
  });
});

describe('resolveLogo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    const result = await resolveLogo({ ticker: 'NVDA', instrumentType: InstrumentType.EQUITY });
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
    const result = await resolveLogo({ ticker: 'BTC-USD', instrumentType: InstrumentType.CRYPTO });
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('falls back to ticker.com favicon when Yahoo Finance returns no website', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({ assetProfile: { website: undefined } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    const result = await resolveLogo({ ticker: 'AAPL', instrumentType: InstrumentType.EQUITY });
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
    const result = await resolveLogo({ ticker: 'RACE.MI', instrumentType: InstrumentType.EQUITY });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=www.ferrari.com&sz=128',
      expect.any(Object),
    );
  });

  it('falls back to base-ticker.com favicon when both Yahoo calls return no website', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({ assetProfile: { website: undefined } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    await resolveLogo({ ticker: 'RACE.MI', instrumentType: InstrumentType.EQUITY });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=race.com&sz=128',
      expect.any(Object),
    );
  });

  it('classifies as RESOLVER_UPSTREAM_ERROR when network errors hit every strategy', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    await expect(resolveLogo({ ticker: 'XXXX', instrumentType: InstrumentType.EQUITY })).rejects.toMatchObject({
      code: 'RESOLVER_UPSTREAM_ERROR',
    });
  });

  it('classifies as LOGO_NOT_FOUND when sources reply but none had a logo', async () => {
    // Yahoo says the security exists but has no website / no fund family;
    // both Google Favicon paths return placeholders. No upstream/network error class.
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
      quoteType: { quoteType: 'EQUITY' },
      assetProfile: { website: undefined },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFaviconResponse(700)));
    await expect(resolveLogo({ ticker: 'XXXX', instrumentType: InstrumentType.EQUITY })).rejects.toMatchObject({
      code: 'LOGO_NOT_FOUND',
    });
  });

  it('throws a LogoResolverError instance (not a plain Error)', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    await expect(resolveLogo({ ticker: 'XXXX', instrumentType: InstrumentType.EQUITY })).rejects.toBeInstanceOf(
      LogoResolverError,
    );
  });

  describe('ETF logo resolution', () => {
    it('resolves ETF logo via fundProfile.family → issuer domain', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        fundProfile: { family: 'iShares' },
        quoteType: { shortName: 'iShares Core MSCI World UCITS ETF' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'SWDA', instrumentType: InstrumentType.ETF });
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
      const result = await resolveLogo({ ticker: 'VWRL', instrumentType: InstrumentType.ETF });
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
      const result = await resolveLogo({ ticker: 'SWDA.MI', instrumentType: InstrumentType.ETF });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
        expect.any(Object),
      );
    });

    it('falls back to equity path when fund family is not in the map', async () => {
      // Single quoteSummary call returns all three modules; equity fallback reuses the
      // same summary's assetProfile rather than firing a second Yahoo round-trip.
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'ETF' },
        fundProfile: { family: 'Obscure Niche Provider' },
        assetProfile: { website: 'https://www.obscurefund.com' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'OBSCURE', instrumentType: InstrumentType.ETF });
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
      const result = await resolveLogo({ ticker: 'VFIAX', instrumentType: InstrumentType.FUND });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
        expect.any(Object),
      );
    });

    it('rethrows Yahoo Finance network errors from resolveFund (does not silently fall to equity)', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockRejectedValue(new Error('network timeout'));
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network timeout')));
      await expect(resolveLogo({ ticker: 'SWDA', instrumentType: InstrumentType.ETF })).rejects.toMatchObject({
        code: 'RESOLVER_UPSTREAM_ERROR',
      });
    });
  });

  it('resolves without instrumentType (uses Yahoo Finance path)', async () => {
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
      quoteType: { quoteType: 'EQUITY' },
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

  describe('auto-detection from Yahoo quoteType', () => {
    it('ETF without instrumentType auto-detects via quoteType and uses fundProfile', async () => {
      // The user-reported bug: clicking "Fetch logo" in SecurityEditor for an existing
      // ETF sent only { ticker } because detail.instrumentType was undefined. The resolver
      // must auto-detect ETF from Yahoo's quoteType.quoteType and route to the fund path.
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'ETF', shortName: 'iShares Core MSCI World UCITS ETF' },
        fundProfile: { family: 'iShares' },
        assetProfile: { website: undefined },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'SWDA' });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
        expect.any(Object),
      );
    });

    it('MUTUALFUND quoteType maps to fund path', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'MUTUALFUND', shortName: 'Vanguard 500 Index Fund Admiral' },
        fundProfile: { family: 'Vanguard' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      const result = await resolveLogo({ ticker: 'VFIAX' });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.google.com/s2/favicons?domain=vanguard.com&sz=128',
        expect.any(Object),
      );
    });

    it('uses a single Yahoo round-trip for auto-detected EQUITY', async () => {
      const spy = vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'EQUITY' },
        assetProfile: { website: 'https://www.nvidia.com' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      await resolveLogo({ ticker: 'NVDA' });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('uses a single Yahoo round-trip for auto-detected ETF', async () => {
      const spy = vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'ETF', shortName: 'iShares Core MSCI World UCITS ETF' },
        fundProfile: { family: 'iShares' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
      await resolveLogo({ ticker: 'SWDA' });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('extracts partial data from a FailedYahooValidationError', async () => {
    // yahoo-finance2 throws FailedYahooValidationError with a `.result` payload
    // when the response shape is partially invalid. fetchFullSummary must reuse
    // that partial payload instead of failing the whole resolution.
    class FailedYahooValidationError extends Error {
      result: unknown;
      constructor(result: unknown) {
        super('schema validation failed');
        this.result = result;
      }
    }
    vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockRejectedValue(
      new FailedYahooValidationError({
        quoteType: { quoteType: 'ETF', shortName: 'iShares Core MSCI World UCITS ETF' },
        fundProfile: { family: 'iShares' },
      }),
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    const result = await resolveLogo({ ticker: 'SWDA', instrumentType: InstrumentType.ETF });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=ishares.com&sz=128',
      expect.any(Object),
    );
  });

  describe('crypto quote-currency suffix stripping', () => {
    it('strips -EUR suffix correctly', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(makeFetchResponse([{ id: 'bitcoin', symbol: 'btc' }], 'application/json'))
        .mockResolvedValueOnce(makeFetchResponse({ image: { large: 'https://cdn.coingecko.com/coins/images/1/large/bitcoin.png' } }, 'application/json'))
        .mockResolvedValueOnce(makeFetchResponse({}, 'image/png')),
      );
      const result = await resolveLogo({ ticker: 'BTC-EUR', instrumentType: InstrumentType.CRYPTO });
      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('strips -GBP suffix correctly', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(makeFetchResponse([{ id: 'ethereum', symbol: 'eth' }], 'application/json'))
        .mockResolvedValueOnce(makeFetchResponse({ image: { large: 'https://cdn.coingecko.com/coins/images/279/large/ethereum.png' } }, 'application/json'))
        .mockResolvedValueOnce(makeFetchResponse({}, 'image/png')),
      );
      const result = await resolveLogo({ ticker: 'ETH-GBP', instrumentType: InstrumentType.CRYPTO });
      expect(result).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe('placeholder favicon detection', () => {
    it('rejects undersized response from Google Favicon (Google default globe)', async () => {
      // Yahoo says NVDA's website is nonsense.invalid; Google returns its default globe (700 bytes).
      // Outer fallback also tries nvda.com and Google again returns the default globe (700 bytes).
      // With placeholder detection, both paths should be rejected and resolveLogo throws LOGO_NOT_FOUND
      // (not UPSTREAM — every source actually responded; the responses just held no logo).
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'EQUITY' },
        assetProfile: { website: 'https://nonsense.invalid' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFaviconResponse(700)));
      await expect(
        resolveLogo({ ticker: 'NVDA', instrumentType: InstrumentType.EQUITY }),
      ).rejects.toMatchObject({ code: 'LOGO_NOT_FOUND' });
    });

    it('accepts a real favicon (above threshold)', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'EQUITY' },
        assetProfile: { website: 'https://www.nvidia.com' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFaviconResponse(4096)));
      const result = await resolveLogo({ ticker: 'NVDA', instrumentType: InstrumentType.EQUITY });
      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('falls through to outer ticker.com fallback when primary domain returns placeholder', async () => {
      vi.spyOn(YahooFinance.prototype, 'quoteSummary').mockResolvedValue({
        quoteType: { quoteType: 'EQUITY' },
        assetProfile: { website: 'https://nonsense.invalid' },
      });
      // First call (primary domain): placeholder. Second call (ticker.com fallback): real.
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(makeFaviconResponse(700))
        .mockResolvedValueOnce(makeFaviconResponse(4096)),
      );
      const result = await resolveLogo({ ticker: 'NVDA', instrumentType: InstrumentType.EQUITY });
      expect(result).toMatch(/^data:image\/png;base64,/);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('domain overrides ticker+instrumentType when both provided', async () => {
    const spy = vi.spyOn(YahooFinance.prototype, 'quoteSummary');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({}, 'image/png')));
    await resolveLogo({ ticker: 'NVDA', instrumentType: InstrumentType.EQUITY, domain: 'nvidia.com' });
    expect(fetch).toHaveBeenCalledWith(
      'https://www.google.com/s2/favicons?domain=nvidia.com&sz=128',
      expect.any(Object),
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
