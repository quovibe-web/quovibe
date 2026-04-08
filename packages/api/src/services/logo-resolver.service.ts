import type { LogoResolveRequest } from '@quovibe/shared';

const TIMEOUT_MS = 8_000;

// Lowercase keys for case-insensitive lookup. Values are bare domains (no scheme).
const FUND_FAMILY_DOMAINS: Record<string, string> = {
  'ishares': 'ishares.com',
  'vanguard': 'vanguard.com',
  'spdr': 'ssga.com',
  'invesco': 'invesco.com',
  'amundi': 'amundi.com',
  'xtrackers': 'dws.com',
  'dws': 'dws.com',
  'lyxor': 'amundi.com',
  'wisdomtree': 'wisdomtree.com',
  'vaneck': 'vaneck.com',
  'schwab': 'schwab.com',
  'fidelity': 'fidelity.com',
  'jpmorgan': 'jpmorgan.com',
  'pimco': 'pimco.com',
  'ark': 'ark-invest.com',
  'global x': 'globalxetfs.com',
  'franklin': 'franklintempleton.com',
  'proshares': 'proshares.com',
  'direxion': 'direxion.com',
  'bnp paribas': 'bnpparibas-am.com',
  'hsbc': 'hsbc.com',
  'ubs': 'ubs.com',
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
    // For all other types (EQUITY, ETF, FUND, etc.) or when instrumentType is unknown,
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
