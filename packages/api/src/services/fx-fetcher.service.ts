import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

const ECB_URL = process.env.ECB_RATES_URL
  ?? 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

// ─── ECB XML fetch ────────────────────────────────────────────────────────────

/**
 * Fetches the full ECB euro reference rates XML once and extracts cross-rates
 * for every requested target currency from the `from` base. ECB publishes
 * EUR-based rates; cross-rates compose as `target / from`.
 */
async function fetchAllPairsFromEcb(
  from: string,
  targets: string[],
  startDate?: string,
  endDate?: string,
): Promise<Map<string, { date: string; rate: Decimal }[]>> {
  const out = new Map<string, { date: string; rate: Decimal }[]>();
  if (targets.length === 0) return out;

  try {

    const axios = require('axios');

    const cheerio = require('cheerio');

    const res = await axios.get(ECB_URL, { timeout: 30000 });
    const $ = cheerio.load(res.data as string, { xmlMode: true });

    for (const t of targets) out.set(t, []);

    $('Cube[time]').each((_i: number, dayEl: unknown) => {
      const date = $(dayEl).attr('time') as string;
      if (startDate && date < startDate) return;
      if (endDate && date > endDate) return;

      const rates: Record<string, Decimal> = { EUR: new Decimal(1) };
      $(dayEl).find('Cube[currency]').each((_j: number, rateEl: unknown) => {
        const currency = $(rateEl).attr('currency') as string;
        const rateStr = $(rateEl).attr('rate') as string;
        if (currency && rateStr) rates[currency] = new Decimal(rateStr);
      });

      const fromRate = rates[from];
      if (!fromRate) return;

      for (const target of targets) {
        const toRate = rates[target];
        if (!toRate) continue;
        out.get(target)!.push({ date, rate: toRate.div(fromRate) });
      }
    });

    return out;
  } catch (err) {
    console.warn('[fx] ECB fetch failed:', (err as Error).message);
    return out;
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

// ─── Public: shared currency helpers ─────────────────────────────────────────

export function getBaseCurrency(sqlite: BetterSqlite3.Database): string {
  const baseProp = sqlite.prepare(
    `SELECT value FROM property WHERE name = 'portfolio.currency'`,
  ).get() as { value: string } | undefined;
  return baseProp?.value ?? 'EUR';
}

export function listForeignCurrencies(
  sqlite: BetterSqlite3.Database,
  base: string,
): string[] {
  const rows = sqlite.prepare(`
    SELECT DISTINCT currency FROM security WHERE currency IS NOT NULL AND currency != ?
    UNION
    SELECT DISTINCT currency FROM account WHERE currency IS NOT NULL AND currency != ?
  `).all(base, base) as { currency: string }[];
  return rows.map(r => r.currency);
}

export function hasForeignCurrencies(
  sqlite: BetterSqlite3.Database,
  base: string,
): boolean {
  const row = sqlite.prepare(`
    SELECT 1 AS x FROM (
      SELECT currency FROM security WHERE currency IS NOT NULL AND currency != ?
      UNION ALL
      SELECT currency FROM account WHERE currency IS NOT NULL AND currency != ?
    ) LIMIT 1
  `).get(base, base) as { x: number } | undefined;
  return row !== undefined;
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
    return hasForeignCurrencies(sqlite, getBaseCurrency(sqlite));
  } catch {
    return false;
  }
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
 * (manual button) or a future cron job. Issues exactly one ECB XML download
 * regardless of how many foreign currencies are present; falls back to a
 * per-currency Yahoo fetch only for currencies missing from the ECB feed.
 */
export async function fetchAllExchangeRates(
  sqlite: BetterSqlite3.Database,
  options?: { startDate?: string; endDate?: string },
): Promise<FxFetchSummary> {
  const start = Date.now();
  const baseCurrency = getBaseCurrency(sqlite);
  const targets = listForeignCurrencies(sqlite, baseCurrency);

  const ecbByCurrency = await fetchAllPairsFromEcb(
    baseCurrency, targets, options?.startDate, options?.endDate,
  );

  const results: FetchResult[] = [];
  let totalFetched = 0;

  for (const cur of targets) {
    const pair = `${baseCurrency}/${cur}`;
    let rates = ecbByCurrency.get(cur) ?? [];

    if (rates.length === 0) {
      rates = await fetchFromYahoo(baseCurrency, cur, options?.startDate, options?.endDate);
    }

    if (rates.length === 0) {
      results.push({ pair, fetched: 0, error: `No rates found for ${pair}` });
      continue;
    }

    try {
      saveRates(sqlite, baseCurrency, cur, rates);
      results.push({ pair, fetched: rates.length });
      totalFetched += rates.length;
    } catch (err) {
      results.push({ pair, fetched: 0, error: (err as Error).message });
    }
  }

  return { results, totalFetched, duration: Date.now() - start };
}
