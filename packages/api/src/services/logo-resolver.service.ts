import type { LogoResolveRequest } from '@quovibe/shared';

const TIMEOUT_MS = 8_000;

// Lowercase keys for case-insensitive lookup. Values are bare domains (no scheme).
const FUND_FAMILY_DOMAINS: Record<string, string> = {
  // BlackRock / iShares
  'ishares': 'ishares.com',
  'blackrock': 'ishares.com',
  // Vanguard
  'vanguard': 'vanguard.com',
  // State Street Global Advisors / SPDR
  'spdr': 'ssga.com',
  'state street': 'ssga.com',
  // Amundi (includes Lyxor, acquired 2022)
  'amundi': 'amundi.com',
  'lyxor': 'amundi.com',
  // Xtrackers / DWS
  'xtrackers': 'dws.com',
  'dws': 'dws.com',
  // Invesco
  'invesco': 'invesco.com',
  // UBS
  'ubs': 'ubs.com',
  // J.P. Morgan
  'jpmorgan': 'jpmorgan.com',
  'j.p. morgan': 'jpmorgan.com',
  // Fidelity
  'fidelity': 'fidelity.com',
  // Franklin Templeton
  'franklin': 'franklintempleton.com',
  // WisdomTree
  'wisdomtree': 'wisdomtree.com',
  // VanEck
  'vaneck': 'vaneck.com',
  // HSBC
  'hsbc': 'hsbc.com',
  // BNP Paribas Asset Management / BNP Paribas Easy
  'bnp paribas': 'bnpparibas-am.com',
  // Legal & General Investment Management (LGIM)
  'lgim': 'lgim.com',
  'legal & general': 'lgim.com',
  // PIMCO
  'pimco': 'pimco.com',
  // First Trust
  'first trust': 'ftportfolios.com',
  // Ossiam
  'ossiam': 'ossiam.com',
  // HANetf
  'hanetf': 'hanetf.com',
  // 21Shares
  '21shares': '21shares.com',
  // CoinShares
  'coinshares': 'coinshares.com',
  // Bitwise
  'bitwise': 'bitwiseinvestments.com',
  // Deutsche Digital Assets
  'deutsche digital': 'dda.group',
  // ETC Group / ETC Issuance GmbH
  'etc group': 'etc-group.com',
  'etc issuance': 'etc-group.com',
  // ARK Invest — trailing space prevents false match on 'Arkema' etc.
  'ark ': 'ark-invest.com',
  // Avantis Investors
  'avantis': 'avantisinvestors.com',
  // Dimensional Fund Advisors (DFA)
  'dimensional': 'dimensional.com',
  // IndexIQ
  'indexiq': 'indexiq.com',
  // Horizons ETFs
  'horizons': 'horizonsetfs.com',
  // Robeco
  'robeco': 'robeco.com',
  // AXA Investment Managers
  'axa investment': 'axa-im.com',
  'axa im': 'axa-im.com',
  // Fineco Asset Management
  'fineco': 'finecobank.com',
  // Scalable Capital
  'scalable capital': 'scalable.capital',
  // Brinsmere
  'brinsmere': 'brinsmere.co.uk',
  // Bristol Gate Capital Management
  'bristol gate': 'bristolgatecm.com',
  // Brompton Group
  'brompton': 'bromptongroup.com',
  // Brookmont Capital Management
  'brookmont': 'brookmontcapital.com',
  // Davy Global Fund Management
  'davy': 'davy.ie',
};

export function findFundDomain(family?: string, shortName?: string): string | undefined {
  if (family) {
    const normalized = family.toLowerCase();
    const domain = FUND_FAMILY_DOMAINS[normalized];
    if (domain) return domain;
  }
  if (shortName) {
    const normalized = shortName.toLowerCase();
    for (const [key, domain] of Object.entries(FUND_FAMILY_DOMAINS)) {
      if (normalized.startsWith(key)) return domain;
    }
  }
  return undefined;
}

async function fetchToBase64(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') ?? 'image/png';
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

function extractDomain(website: string): string {
  return website.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
}

async function fetchByDomain(domain: string): Promise<string> {
  return fetchToBase64(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
}

function getYf() {
  const mod = require('yahoo-finance2');
  const YahooFinance = mod.default ?? mod;
  return new YahooFinance();
}

async function resolveEquity(ticker: string, baseTicker: string): Promise<string> {
  const yf = getYf();
  let website: string | undefined;

  const summary = await yf.quoteSummary(ticker, { modules: ['assetProfile'] });
  website = summary.assetProfile?.website;

  // Exchange-specific listings (e.g. RACE.MI) often have sparse assetProfile.
  // Retry with the base ticker (no exchange suffix) to get the primary listing's data.
  if (!website && baseTicker !== ticker) {
    const baseSummary = await yf.quoteSummary(baseTicker, { modules: ['assetProfile'] });
    website = baseSummary.assetProfile?.website;
  }

  if (!website) throw new Error(`No website for ${ticker}`);
  return fetchByDomain(extractDomain(website));
}

async function resolveFund(ticker: string, baseTicker: string): Promise<string> {
  const yf = getYf();

  const tryFundDomain = async (t: string): Promise<string | undefined> => {
    const summary = await yf.quoteSummary(t, { modules: ['fundProfile', 'quoteType'] });
    const family = (summary.fundProfile as { family?: string } | undefined)?.family;
    const shortName = (summary.quoteType as { shortName?: string } | undefined)?.shortName;
    const domain = findFundDomain(family, shortName);
    return domain;
  };

  let domain = await tryFundDomain(ticker);

  if (!domain && baseTicker !== ticker) {
    domain = await tryFundDomain(baseTicker);
  }

  if (!domain) throw new Error(`No fund family found for ${ticker}`);
  return fetchByDomain(domain);
}

async function resolveCrypto(ticker: string): Promise<string> {
  const symbol = ticker.replace(/-USD$/i, '').toLowerCase();
  const listRes = await fetch('https://api.coingecko.com/api/v3/coins/list', { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!listRes.ok) throw new Error('CoinGecko list unavailable');
  const list = await listRes.json() as Array<{ id: string; symbol: string }>;
  const coin = list.find(c => c.symbol.toLowerCase() === symbol);
  if (!coin) throw new Error(`Coin not found: ${symbol}`);
  const coinRes = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!coinRes.ok) throw new Error('CoinGecko coin detail unavailable');
  const data = await coinRes.json() as { image: { large: string } };
  return fetchToBase64(data.image.large);
}

export async function resolveLogo(input: LogoResolveRequest): Promise<string> {
  // Domain path (accounts, or explicit domain override)
  if (input.domain) {
    return fetchByDomain(input.domain);
  }

  const { ticker, instrumentType } = input as { ticker: string; instrumentType?: string };

  // Strip exchange suffix (e.g. RACE.MI → race, SWDA.MI → swda) for fallback domain
  const baseTicker = ticker.replace(/\.[A-Z0-9]+$/i, '');

  try {
    if (instrumentType === 'CRYPTO') {
      return await resolveCrypto(ticker);
    }
    if (instrumentType === 'ETF' || instrumentType === 'FUND') {
      try {
        return await resolveFund(ticker, baseTicker);
      } catch (err) {
        // Only fall through if the fund family was simply not in the map.
        // Re-throw on other errors (e.g. network) so the outer catch handles them cleanly.
        if (!(err instanceof Error) || !err.message.startsWith('No fund family found')) {
          throw err;
        }
      }
    }
    // For EQUITY and all other types (or when instrumentType is unknown),
    // try Yahoo Finance assetProfile → company website → Google Favicon
    return await resolveEquity(ticker, baseTicker);
  } catch {
    // Fallback: base ticker (exchange suffix stripped) + .com
    try {
      return await fetchByDomain(`${baseTicker.toLowerCase()}.com`);
    } catch {
      throw new Error('Logo not found');
    }
  }
}
