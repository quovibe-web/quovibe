import type { LogoResolveRequest } from '@quovibe/shared';

const TIMEOUT_MS = 8_000;

function withTimeout(): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Clear timer if signal is aborted externally before timeout fires
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

async function fetchToBase64(url: string): Promise<string> {
  const res = await fetch(url, { signal: withTimeout() });
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
  return fetchToBase64(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
}

function getYf() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('yahoo-finance2');
  const YahooFinance = mod.default ?? mod;
  return new YahooFinance();
}

async function resolveEquity(ticker: string): Promise<string> {
  const yf = getYf();
  const summary = await yf.quoteSummary(ticker, { modules: ['assetProfile'] });
  const website = summary.assetProfile?.website;
  if (!website) throw new Error(`No website for ${ticker}`);
  return fetchByDomain(extractDomain(website));
}

async function resolveCrypto(ticker: string): Promise<string> {
  const symbol = ticker.replace(/-USD$/i, '').toLowerCase();
  const listRes = await fetch('https://api.coingecko.com/api/v3/coins/list', { signal: withTimeout() });
  if (!listRes.ok) throw new Error('CoinGecko list unavailable');
  const list = await listRes.json() as Array<{ id: string; symbol: string }>;
  const coin = list.find(c => c.symbol.toLowerCase() === symbol);
  if (!coin) throw new Error(`Coin not found: ${symbol}`);
  const coinRes = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
    { signal: withTimeout() },
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

  const { ticker, instrumentType } = input as { ticker: string; instrumentType: string };

  // Strip exchange suffix (e.g. RACE.MI → race, SWDA.MI → swda) for fallback domain
  const baseTicker = ticker.replace(/\.[A-Z0-9]+$/i, '');

  try {
    if (instrumentType === 'CRYPTO') {
      return await resolveCrypto(ticker);
    }
    return await resolveEquity(ticker);
  } catch {
    // Fallback: base ticker (exchange suffix stripped) + .com
    try {
      return await fetchByDomain(`${baseTicker.toLowerCase()}.com`);
    } catch {
      throw new Error('Logo not found');
    }
  }
}
