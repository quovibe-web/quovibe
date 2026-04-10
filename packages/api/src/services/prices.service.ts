import type BetterSqlite3 from 'better-sqlite3';
import { addDays } from 'date-fns';
import { convertPriceToDb } from './unit-conversion';
import {
  ProviderRegistry, YahooProvider, TableProvider, JsonProvider, AlphaVantageProvider,
  toYMD, type FetchedPrice, type LatestQuote, type SecurityRow, type FetchContext,
} from '../providers';

// ─── Global registry ─────────────────────────────────────────────────────────

const registry = new ProviderRegistry();
registry.register(new YahooProvider());
registry.register(new TableProvider());
registry.register(new JsonProvider());
registry.register(new AlphaVantageProvider());

export { registry };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FetchResult {
  fetched: number;
  error?: string;
}

export interface FetchAllResult {
  results: (FetchResult & { securityId: string; name: string })[];
  totalFetched: number;
  totalErrors: number;
}

// ─── Environment config ───────────────────────────────────────────────────────

const PRICE_FETCH_MAX_CONCURRENT = parseInt(
  process.env.PRICE_FETCH_MAX_CONCURRENT ?? '5', 10,
);
const PRICE_FETCH_INTERVAL_MS = parseInt(
  process.env.PRICE_FETCH_INTERVAL_MS ?? '1000', 10,
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readGlobalSettings(sqlite: BetterSqlite3.Database): Record<string, string> {
  const rows = sqlite
    .prepare(`SELECT name, value FROM property WHERE name LIKE 'provider.%'`)
    .all() as { name: string; value: string | null }[];
  const settings: Record<string, string> = {};
  for (const r of rows) {
    if (r.value != null) settings[r.name] = r.value;
  }
  return settings;
}

function readFeedProps(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  type: string,
): Record<string, string> {
  const rows = sqlite
    .prepare(`SELECT name, value FROM security_prop WHERE security = ? AND type = ? ORDER BY seq`)
    .all(securityId, type) as { name: string; value: string | null }[];
  const props: Record<string, string> = {};
  for (const r of rows) {
    if (r.value != null) props[r.name] = r.value;
  }
  return props;
}

function writeLatestQuote(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  quote: LatestQuote,
  securityName: string,
): boolean {
  try {
    const dbClose = convertPriceToDb({ close: quote.price });
    sqlite
      .prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)
        ON CONFLICT(security) DO UPDATE SET tstamp = excluded.tstamp, value = excluded.value`)
      .run(securityId, quote.date, dbClose.close);
    console.log(`[prices] Latest quote for ${securityName}: ${quote.price} @ ${quote.date}`);
    return true;
  } catch (err) {
    console.warn(`[prices] Failed to write latest quote for ${securityName}:`, (err as Error).message);
    return false;
  }
}

// ─── Save to DB ───────────────────────────────────────────────────────────────

function savePricesToDb(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  fetchedPrices: FetchedPrice[],
  mode: 'merge' | 'replace' = 'merge',
  skipLatestPriceSync = false,
): void {
  // No early return: always sync latest_price even when fetch returns 0 new prices (fixes BUG 1).
  // latest_price is derived from the global max in the price table after inserts, not from the
  // current batch, so stale or partial batches can never downgrade it (fixes BUG 2).
  // When skipLatestPriceSync=true, the caller has already written a fresher intraday quote to
  // latest_price and we must not overwrite it with the (potentially stale) historical close.

  const insertPrice = sqlite.prepare(`
    INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)
      ON CONFLICT(security, tstamp) DO UPDATE SET value = excluded.value
  `);

  const insertLatest = sqlite.prepare(`
    INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)
      ON CONFLICT(security) DO UPDATE SET tstamp = excluded.tstamp, value = excluded.value
  `);

  const deletePrice = sqlite.prepare(`DELETE FROM price WHERE security = ?`);
  const deleteLatest = sqlite.prepare(`DELETE FROM latest_price WHERE security = ?`);

  const selectGlobalMax = sqlite.prepare(
    `SELECT tstamp, value FROM price WHERE security = ? ORDER BY tstamp DESC LIMIT 1`,
  );

  const sorted = [...fetchedPrices].sort((a, b) => a.date.localeCompare(b.date));

  const tx = sqlite.transaction(() => {
    // Only wipe existing data in replace mode when we have new prices to substitute
    if (mode === 'replace' && fetchedPrices.length > 0) {
      deletePrice.run(securityId);
      deleteLatest.run(securityId);
    }

    for (const p of sorted) {
      const dbPrice = convertPriceToDb({ close: p.close });
      insertPrice.run(securityId, p.date, dbPrice.close);
    }

    if (!skipLatestPriceSync) {
      // Sync latest_price from global max — includes newly inserted rows
      const globalMax = selectGlobalMax.get(securityId) as { tstamp: string; value: number } | undefined;
      if (globalMax) {
        insertLatest.run(securityId, globalMax.tstamp, globalMax.value);
      }
    }
  });

  tx();
}

// ─── Main: fetch single security ─────────────────────────────────────────────

export async function fetchSecurityPrices(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  startDate?: string,
  endDate?: string,
  mode: 'merge' | 'replace' = 'merge',
): Promise<FetchResult> {
  const row = sqlite
    .prepare(`SELECT uuid, name, isin, feed, feedURL, tickerSymbol, feedTickerSymbol, currency, latestFeed, latestFeedURL FROM security WHERE uuid = ?`)
    .get(securityId) as SecurityRow | undefined;

  if (!row || !row.feed) {
    console.warn(`[prices] Security ${securityId} has no feed configured`);
    return { fetched: 0 };
  }

  // Normalize PP feed → YAHOO when a ticker symbol is available
  let effectiveFeed = row.feed;
  if (effectiveFeed === 'PP') {
    if (row.tickerSymbol || row.feedTickerSymbol) {
      effectiveFeed = 'YAHOO';
      console.log(`[prices] Mapped PP feed → YAHOO for ${row.name} (ticker: ${row.feedTickerSymbol ?? row.tickerSymbol})`);
    } else {
      console.warn(`[prices] Security "${row.name}" has PP feed but no ticker symbol`);
      return { fetched: 0, error: `Unsupported feed: PP (no ticker symbol configured)` };
    }
  }

  const provider = registry.get(effectiveFeed);
  if (!provider) {
    console.warn(`[prices] Unsupported feed provider: ${effectiveFeed}`);
    return { fetched: 0, error: `Unsupported feed: ${effectiveFeed}` };
  }

  // Read FEED properties
  const feedProps = readFeedProps(sqlite, securityId, 'FEED');

  // Read global settings (for API keys)
  const globalSettings = readGlobalSettings(sqlite);

  // Auto-determine startDate
  let effectiveStart = startDate;
  if (!effectiveStart && mode === 'merge') {
    const lastPrice = sqlite
      .prepare('SELECT MAX(tstamp) as last FROM price WHERE security = ?')
      .get(securityId) as { last: string | null };
    if (lastPrice.last) {
      effectiveStart = toYMD(addDays(new Date(lastPrice.last), 1));
    }
  }

  const ctx: FetchContext = {
    security: row,
    feedProps,
    startDate: effectiveStart,
    endDate: endDate ?? toYMD(addDays(new Date(), 1)),
    globalSettings,
  };

  // Resolve latest feed provider (latestFeed → fallback to historical feed)
  const latestFeedId = row.latestFeed || effectiveFeed;
  const latestProvider = registry.get(latestFeedId);

  // Fetch latest quote (if provider supports it)
  let latestQuote: LatestQuote | null = null;
  if (latestProvider?.fetchLatest) {
    // Build context for latest feed (may use LATEST_FEED props)
    const latestProps = row.latestFeed
      ? readFeedProps(sqlite, securityId, 'LATEST_FEED')
      : feedProps;
    const latestCtx: FetchContext = { ...ctx, feedProps: latestProps };
    try {
      latestQuote = await latestProvider.fetchLatest(latestCtx);
    } catch {
      // Non-blocking — log and continue
    }
  }

  // Guard: if already up to date, skip historical fetch but sync latest_price
  if (effectiveStart && effectiveStart >= ctx.endDate!) {
    if (latestQuote) {
      writeLatestQuote(sqlite, securityId, latestQuote, row.name);
      savePricesToDb(sqlite, securityId, [], mode, true);
    } else {
      savePricesToDb(sqlite, securityId, [], mode);
    }
    return { fetched: 0 };
  }

  // Acquire rate limit permit
  try {
    await registry.acquirePermit(effectiveFeed);
  } catch {
    return { fetched: 0, error: `Rate limit exceeded for ${provider.displayName}` };
  }

  // Fetch historical prices
  let fetchedPrices: FetchedPrice[] = [];
  let providerWarning: string | undefined;
  try {
    const result = await provider.fetchHistorical(ctx);
    fetchedPrices = result.prices;
    providerWarning = result.warning;
  } catch (err) {
    return { fetched: 0, error: `${provider.displayName} fetch failed: ${(err as Error).message}` };
  }

  // Write latest intraday quote
  let latestQuoteWritten = false;
  if (latestQuote) {
    latestQuoteWritten = writeLatestQuote(sqlite, securityId, latestQuote, row.name);
  }

  // Save historical prices to DB
  try {
    savePricesToDb(sqlite, securityId, fetchedPrices, mode, latestQuoteWritten);
  } catch (err) {
    return { fetched: 0, error: (err as Error).message };
  }

  if (providerWarning) {
    return { fetched: fetchedPrices.length, error: providerWarning };
  }
  return { fetched: fetchedPrices.length };
}

// ─── Test fetch (no DB write) ─────────────────────────────────────────────────

export interface TestFetchConfig {
  feed?: string;
  feedUrl?: string;
  pathToDate?: string;
  pathToClose?: string;
  dateFormat?: string;
  factor?: number;
}

export interface TestFetchResult {
  prices: FetchedPrice[];
  error?: string;
}

export async function testFetchPrices(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  overrideConfig?: TestFetchConfig,
): Promise<TestFetchResult> {
  const row = sqlite
    .prepare(`SELECT uuid, name, isin, feed, feedURL, tickerSymbol, feedTickerSymbol, currency, latestFeed, latestFeedURL FROM security WHERE uuid = ?`)
    .get(securityId) as SecurityRow | undefined;

  if (!row) return { prices: [] };

  const feedProps = readFeedProps(sqlite, securityId, 'FEED');
  const feed = overrideConfig?.feed ?? row.feed;
  if (!feed) return { prices: [] };

  const provider = registry.get(feed);
  if (!provider) return { prices: [], error: `Unsupported feed: ${feed}` };

  // Apply overrides to feedProps and security row
  const effectiveSecurity: SecurityRow = {
    ...row,
    feedURL: overrideConfig?.feedUrl ?? row.feedURL,
  };
  const effectiveProps = { ...feedProps };
  if (overrideConfig?.pathToDate) effectiveProps['GENERIC-JSON-DATE'] = overrideConfig.pathToDate;
  if (overrideConfig?.pathToClose) effectiveProps['GENERIC-JSON-CLOSE'] = overrideConfig.pathToClose;
  if (overrideConfig?.dateFormat) effectiveProps['DATE_FORMAT'] = overrideConfig.dateFormat;
  if (overrideConfig?.factor != null) effectiveProps['GENERIC-JSON-FACTOR'] = String(overrideConfig.factor);

  const globalSettings = readGlobalSettings(sqlite);
  const ctx: FetchContext = {
    security: effectiveSecurity,
    feedProps: effectiveProps,
    globalSettings,
  };

  try {
    const result = await provider.fetchHistorical(ctx);
    return { prices: result.prices, error: result.warning };
  } catch (err) {
    return { prices: [], error: (err as Error).message };
  }
}

export type { FetchedPrice };

// ─── Main: fetch all securities ───────────────────────────────────────────────

export async function fetchAllPrices(
  sqlite: BetterSqlite3.Database,
  maxConcurrent = PRICE_FETCH_MAX_CONCURRENT,
): Promise<FetchAllResult> {
  const rows = sqlite
    .prepare(`SELECT uuid, name, feed FROM security WHERE feed IS NOT NULL AND isRetired = 0`)
    .all() as { uuid: string; name: string; feed: string }[];

  // Sort: per-day rate-limited providers first (e.g. ALPHAVANTAGE), then the rest
  const sorted = [...rows].sort((a, b) => {
    const pa = registry.get(a.feed);
    const pb = registry.get(b.feed);
    const aIsDaily = pa?.defaultRateLimit.type === 'per-day' ? 0 : 1;
    const bIsDaily = pb?.defaultRateLimit.type === 'per-day' ? 0 : 1;
    return aIsDaily - bIsDaily;
  });

  const results: (FetchResult & { securityId: string; name: string })[] = [];

  for (let i = 0; i < sorted.length; i += maxConcurrent) {
    const batch = sorted.slice(i, i + maxConcurrent);
    const settled = await Promise.allSettled(
      batch.map(r => fetchSecurityPrices(sqlite, r.uuid)),
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      const securityId = batch[j].uuid;
      const name = batch[j].name;
      if (s.status === 'fulfilled') {
        results.push({ securityId, name, ...s.value });
      } else {
        results.push({ securityId, name, fetched: 0, error: String(s.reason) });
      }
    }
    if (i + maxConcurrent < sorted.length) {
      await new Promise(resolve => setTimeout(resolve, PRICE_FETCH_INTERVAL_MS));
    }
  }

  return {
    results,
    totalFetched: results.reduce((sum, r) => sum + r.fetched, 0),
    totalErrors: results.filter(r => r.error != null).length,
  };
}
