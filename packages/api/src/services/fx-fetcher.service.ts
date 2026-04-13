import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

const ECB_URL = process.env.ECB_RATES_URL
  ?? 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

// ─── ECB XML fetch ────────────────────────────────────────────────────────────

async function fetchFromEcb(
  from: string,
  to: string,
  startDate?: string,
  endDate?: string,
): Promise<{ date: string; rate: Decimal }[]> {
  try {
     
    const axios = require('axios');
     
    const cheerio = require('cheerio');

    const res = await axios.get(ECB_URL, { timeout: 30000 });
    const $ = cheerio.load(res.data as string, { xmlMode: true });

    const results: { date: string; rate: Decimal }[] = [];

    $('Cube[time]').each((_i: number, dayEl: unknown) => {
      const date = $(dayEl).attr('time') as string;
      if (startDate && date < startDate) return;
      if (endDate && date > endDate) return;

      // ECB provides EUR-based rates
      // Build a map: currency -> rate relative to EUR
      const rates: Record<string, Decimal> = { EUR: new Decimal(1) };
      $(dayEl).find('Cube[currency]').each((_j: number, rateEl: unknown) => {
        const currency = $(rateEl).attr('currency') as string;
        const rateStr = $(rateEl).attr('rate') as string;
        if (currency && rateStr) {
          rates[currency] = new Decimal(rateStr);
        }
      });

      const fromRate = rates[from];
      const toRate = rates[to];
      if (!fromRate || !toRate) return;

      // Cross-rate: toRate / fromRate (both relative to EUR)
      const rate = toRate.div(fromRate);
      results.push({ date, rate });
    });

    return results;
  } catch (err) {
    console.warn('[fx] ECB fetch failed:', (err as Error).message);
    return [];
  }
}

async function fetchFromYahoo(
  from: string,
  to: string,
  startDate?: string,
  endDate?: string,
): Promise<{ date: string; rate: Decimal }[]> {
  try {
     
    const mod = require('yahoo-finance2');
    const YahooFinance = mod.default ?? mod;
    const yf = new YahooFinance();
    const ticker = `${from}${to}=X`;

    const result = await yf.chart(ticker, {
      period1: startDate ?? '2000-01-01',
      period2: endDate ?? new Date().toISOString().slice(0, 10),
      interval: '1d' as const,
    });

    return result.quotes
      .filter((r: { close: number | null }) => r.close != null)
      .map((r: { date: Date; close: number }) => ({
        date: format(r.date, 'yyyy-MM-dd'),
        rate: new Decimal(String(r.close)).toDecimalPlaces(6),
      }));
  } catch (err) {
    console.warn(`[fx] Yahoo FX fetch failed for ${from}/${to}:`, (err as Error).message);
    return [];
  }
}

// ─── Save to DB ───────────────────────────────────────────────────────────────

function saveRates(
  sqlite: BetterSqlite3.Database,
  from: string,
  to: string,
  rates: { date: string; rate: Decimal }[],
): void {
  const insert = sqlite.prepare(`
    INSERT OR REPLACE INTO vf_exchange_rate (date, from_currency, to_currency, rate)
    VALUES (?, ?, ?, ?)
  `);

  const tx = sqlite.transaction(() => {
    for (const r of rates) {
      insert.run(r.date, from, to, r.rate.toString());
    }
  });
  tx();
}

// ─── Public: check if FX fetch is needed ─────────────────────────────────────

/**
 * Returns true if the vf_exchange_rate table is empty AND the portfolio
 * contains foreign currencies that need FX data.
 */
export function needsFxFetch(sqlite: BetterSqlite3.Database): boolean {
  try {
    const count = sqlite.prepare(
      'SELECT COUNT(*) as cnt FROM vf_exchange_rate',
    ).get() as { cnt: number };
    if (count.cnt > 0) return false;

    const baseProp = sqlite.prepare(
      `SELECT value FROM property WHERE name = 'portfolio.currency'`,
    ).get() as { value: string } | undefined;
    const baseCurrency = baseProp?.value ?? 'EUR';

    const rows = sqlite.prepare(`
      SELECT DISTINCT currency FROM security WHERE currency IS NOT NULL
      UNION
      SELECT DISTINCT currency FROM account WHERE currency IS NOT NULL
    `).all() as { currency: string }[];

    return rows.some(r => r.currency !== baseCurrency);
  } catch {
    return false;
  }
}

// ─── Public: fetch exchange rates ─────────────────────────────────────────────

export async function fetchExchangeRates(
  sqlite: BetterSqlite3.Database,
  from: string,
  to: string,
  startDate?: string,
  endDate?: string,
): Promise<{ fetched: number; error?: string }> {
  if (from === to) return { fetched: 0 };

  // Try ECB first
  let rates = await fetchFromEcb(from, to, startDate, endDate);

  // Fallback to Yahoo
  if (rates.length === 0) {
    rates = await fetchFromYahoo(from, to, startDate, endDate);
  }

  if (rates.length === 0) {
    return { fetched: 0, error: `No rates found for ${from}/${to}` };
  }

  try {
    saveRates(sqlite, from, to, rates);
  } catch (err) {
    return { fetched: 0, error: (err as Error).message };
  }

  return { fetched: rates.length };
}

// ─── Public: fetch all exchange rates ─────────────────────────────────────────

export interface FetchResult {
  pair: string;
  fetched: number;
  error?: string;
}

export interface FxFetchSummary {
  results: FetchResult[];
  totalFetched: number;
  duration: number;
}

/**
 * Auto-detects all foreign currencies in the DB and fetches exchange rates
 * for each pair vs base currency. Designed to be called from a route handler
 * (manual button) or a future cron job.
 */
export async function fetchAllExchangeRates(
  sqlite: BetterSqlite3.Database,
  options?: { startDate?: string; endDate?: string },
): Promise<FxFetchSummary> {
  const start = Date.now();

  // Auto-detect all currencies in use
  const rows = sqlite.prepare(`
    SELECT DISTINCT currency FROM security WHERE currency IS NOT NULL
    UNION
    SELECT DISTINCT currency FROM account WHERE currency IS NOT NULL
  `).all() as { currency: string }[];

  const currencies = new Set(rows.map(r => r.currency));
  // Base currency from property table, fallback EUR
  const baseProp = sqlite.prepare(
    `SELECT value FROM property WHERE name = 'portfolio.currency'`
  ).get() as { value: string } | undefined;
  const baseCurrency = baseProp?.value ?? 'EUR';

  currencies.delete(baseCurrency);

  const results: FetchResult[] = [];
  let totalFetched = 0;

  for (const cur of currencies) {
    // ECB publishes EUR-based rates, so fetch EUR→foreign
    // (buildRateMap will invert as needed)
    const pair = `${baseCurrency}/${cur}`;
    const fetchResult = await fetchExchangeRates(
      sqlite, baseCurrency, cur,
      options?.startDate, options?.endDate,
    );
    results.push({ pair, fetched: fetchResult.fetched, error: fetchResult.error });
    totalFetched += fetchResult.fetched;
  }

  return { results, totalFetched, duration: Date.now() - start };
}
