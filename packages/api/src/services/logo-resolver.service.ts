import { InstrumentType, normalizeInstrumentType, type LogoResolveRequest } from '@quovibe/shared';

export type LogoErrorCode = 'LOGO_NOT_FOUND' | 'RESOLVER_UPSTREAM_ERROR';

export class LogoResolverError extends Error {
  readonly code: LogoErrorCode;
  constructor(code: LogoErrorCode) {
    super(code);
    this.code = code;
    this.name = 'LogoResolverError';
  }
}

// File-private sentinel: thrown when the fund-family lookup misses so the outer
// dispatcher can distinguish "ETF fell through to equity" from genuine network failure.
class FundFamilyNotFound extends Error {}

const UPSTREAM_ERROR_PATTERNS = [
  /HTTP 5\d\d/i,
  /HTTP 429/i,
  /timeout/i,
  /ECONN/i,
  /ENOTFOUND/i,
  /fetch failed/i,
  /AbortError/i,
];

function isUpstreamError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return UPSTREAM_ERROR_PATTERNS.some(re => re.test(err.message));
}

const TIMEOUT_MS = 8_000;

// Google's default globe (returned at sz=128 when a domain has no real favicon) is
// consistently under 1 KB. Real domain favicons at sz=128 are typically 2 KB+. Bytes
// below this threshold are treated as the placeholder and rejected so the next
// fallback strategy fires instead of silently storing a junk icon.
const MIN_FAVICON_BYTES = 1_500;

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
  // ARK Invest
  'ark': 'ark-invest.com',
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
  // Charles Schwab
  'schwab': 'schwab.com',
  // Global X ETFs (acquired by Mirae Asset 2018)
  'global x': 'globalxetfs.com',
  // ProShares
  'proshares': 'proshares.com',
  // Direxion
  'direxion': 'direxion.com',
  // Goldman Sachs Asset Management
  'goldman sachs': 'gsam.com',
  'gsam': 'gsam.com',
  // abrdn (formerly Aberdeen Standard Investments)
  'abrdn': 'abrdn.com',
  'aberdeen': 'abrdn.com',
  // Nuveen (TIAA affiliate)
  'nuveen': 'nuveen.com',
  // Columbia Threadneedle Investments
  'columbia threadneedle': 'columbiathreadneedle.com',
  'columbia': 'columbiathreadneedle.com',
  // KraneShares
  'kraneshares': 'kraneshares.com',
  // Pacer ETFs
  'pacer': 'paceretfs.com',
  // Innovator ETFs
  'innovator': 'innovatoretfs.com',
  // Mirae Asset
  'mirae asset': 'miraeasset.com',
  // Simplify Asset Management
  'simplify': 'simplify.us',
  // Roundhill Investments
  'roundhill': 'roundhillinvestments.com',
  // Matthews Asia
  'matthews': 'matthewsasia.com',
  // Tabula Investment Management
  'tabula': 'tabula.im',
  // Rize ETF
  'rize': 'rizeetf.com',
  // Nikko Asset Management
  'nikko': 'nikkoam.com',
  // Nomura Asset Management
  'nomura': 'nomura.com',
  // AllianceBernstein
  'alliancebernstein': 'alliancebernstein.com',
  // T. Rowe Price
  't. rowe price': 'troweprice.com',
  't. rowe': 'troweprice.com',
  // John Hancock Investment Management
  'john hancock': 'jhinvestments.com',
  // Hartford Funds
  'hartford': 'hartfordfunds.com',
  // Principal Asset Management
  'principal': 'principalfunds.com',
  // American Century Investments
  'american century': 'americancentury.com',
};

/**
 * Normalise a raw provider/fund name for matching:
 * - lowercase
 * - collapse any run of non-alphanumeric chars (dots, dashes, &, spaces…) into a single space
 * - trim edges
 *
 * Examples:
 *   "J.P. Morgan"            → "j p morgan"
 *   "iShares by BlackRock"   → "ishares by blackrock"
 *   "ARK Investment Mgmt LLC"→ "ark investment mgmt llc"
 */
function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Pre-normalise map keys once so we don't repeat the work on every call.
const NORMALISED_FUND_DOMAINS: Array<[string, string]> = Object.entries(FUND_FAMILY_DOMAINS)
  .map(([k, v]) => [normaliseName(k), v]);

/**
 * Map a fund family name or ETF short name to the issuer's domain.
 *
 * Matching strategy (tried in order for each input):
 *   1. Exact match after normalisation  ("iShares" → "ishares" === key "ishares")
 *   2. Word-boundary prefix match       ("Avantis Investors" → "avantis investors"
 *                                        starts with "avantis ")
 *
 * Word-boundary semantics come from requiring `startsWith(key + ' ')`, which ensures
 * "ark innovation etf" matches key "ark" but "arkema s a etf" does not.
 *
 * Both `family` (fundProfile.family) and `shortName` (quoteType.shortName) are tried;
 * `family` is preferred when both are provided.
 */
export function findFundDomain(family?: string, shortName?: string): string | undefined {
  for (const raw of [family, shortName]) {
    if (!raw) continue;
    const input = normaliseName(raw);
    for (const [key, domain] of NORMALISED_FUND_DOMAINS) {
      if (input === key || input.startsWith(key + ' ')) return domain;
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
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < MIN_FAVICON_BYTES) {
    throw new Error(`Placeholder favicon for ${domain}`);
  }
  const contentType = res.headers.get('content-type') ?? 'image/png';
  return `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`;
}

// Module-scope singleton. Tests spy on `YahooFinance.prototype.quoteSummary`, so the
// shared instance is fully spy-compatible. `require()` (not import) keeps mock
// compatibility with the existing test harness.
const YahooFinance = (() => {
  const mod = require('yahoo-finance2');
  return mod.default ?? mod;
})();
const yf = new YahooFinance();

type FullSummary = {
  quoteType?: { quoteType?: string; shortName?: string };
  fundProfile?: { family?: string };
  assetProfile?: { website?: string };
};

const SUMMARY_MODULES = ['quoteType', 'fundProfile', 'assetProfile'] as const;

async function fetchFullSummary(t: string): Promise<FullSummary> {
  try {
    return await yf.quoteSummary(t, { modules: SUMMARY_MODULES });
  } catch (err) {
    if (err instanceof Error && err.constructor.name === 'FailedYahooValidationError') {
      // Yahoo returned partially-invalid data. Salvage `err.result` so downstream
      // optional-chaining still finds whatever modules did parse.
      return (err as unknown as { result: FullSummary }).result ?? {};
    }
    if (err instanceof Error && err.message.startsWith('Quote not found')) {
      return {};
    }
    throw err;
  }
}

async function resolveEquityFromSummary(
  summary: FullSummary,
  ticker: string,
  baseTicker: string,
  getBaseSummary: () => Promise<FullSummary>,
): Promise<string> {
  let website = summary.assetProfile?.website;
  if (!website && baseTicker !== ticker) {
    const baseSummary = await getBaseSummary();
    website = baseSummary.assetProfile?.website;
  }
  if (!website) throw new Error(`No website for ${ticker}`);
  return fetchByDomain(extractDomain(website));
}

async function resolveFundFromSummary(
  summary: FullSummary,
  ticker: string,
  baseTicker: string,
  getBaseSummary: () => Promise<FullSummary>,
): Promise<string> {
  let domain = findFundDomain(summary.fundProfile?.family, summary.quoteType?.shortName);
  if (!domain && baseTicker !== ticker) {
    const baseSummary = await getBaseSummary();
    domain = findFundDomain(baseSummary.fundProfile?.family, baseSummary.quoteType?.shortName);
  }
  if (!domain) throw new FundFamilyNotFound();
  return fetchByDomain(domain);
}

async function resolveCrypto(ticker: string): Promise<string> {
  // Strip any 3-4 char quote-currency suffix (USD, EUR, GBP, JPY, USDT, ...).
  const symbol = ticker.replace(/-[A-Z]{3,4}$/i, '').toLowerCase();
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
  if (input.domain) {
    return fetchByDomain(input.domain);
  }

  const { ticker, instrumentType } = input as { ticker: string; instrumentType?: InstrumentType };
  const baseTicker = ticker.replace(/\.[A-Z0-9]+$/i, '');

  try {
    // Explicit CRYPTO hint short-circuits Yahoo entirely.
    if (instrumentType === InstrumentType.CRYPTO) {
      return await resolveCrypto(ticker);
    }

    const summary = await fetchFullSummary(ticker);
    const detected = instrumentType ?? normalizeInstrumentType(summary.quoteType?.quoteType ?? '');

    if (detected === InstrumentType.CRYPTO) {
      return await resolveCrypto(ticker);
    }

    // Memoise baseTicker fetch so a fund→equity fall-through reuses the same Yahoo response.
    let baseSummaryCache: FullSummary | undefined;
    const getBaseSummary = async (): Promise<FullSummary> =>
      baseSummaryCache ??= await fetchFullSummary(baseTicker);

    if (detected === InstrumentType.ETF || detected === InstrumentType.FUND) {
      try {
        return await resolveFundFromSummary(summary, ticker, baseTicker, getBaseSummary);
      } catch (err) {
        if (!(err instanceof FundFamilyNotFound)) throw err;
        // fund family not in the map — fall through to equity using the same summaries
      }
    }
    return await resolveEquityFromSummary(summary, ticker, baseTicker, getBaseSummary);
  } catch (primaryErr) {
    try {
      return await fetchByDomain(`${baseTicker.toLowerCase()}.com`);
    } catch (fallbackErr) {
      if (isUpstreamError(primaryErr) || isUpstreamError(fallbackErr)) {
        throw new LogoResolverError('RESOLVER_UPSTREAM_ERROR');
      }
      throw new LogoResolverError('LOGO_NOT_FOUND');
    }
  }
}
