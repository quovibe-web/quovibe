// packages/api/src/services/auto-fetch.ts
import type BetterSqlite3 from 'better-sqlite3';
import { setOnOpened } from './portfolio-db-pool';
import { getSettings } from './settings.service';
import { getPortfolioEntry } from './portfolio-registry';
import { fetchAllPrices } from './prices.service';
import { fetchAllExchangeRates, getBaseCurrency, hasForeignCurrencies } from './fx-fetcher.service';

// quovibe:allow-module-state — one-shot-per-portfolio auto-fetch dedup; keyed by portfolio id, no data held (ADR-016).
const fetchedInProcess = new Set<string>();
// quovibe:allow-module-state — one-shot-per-portfolio FX auto-fetch dedup; keyed by portfolio id, no data held (ADR-016).
const fetchedFxInProcess = new Set<string>();
const STALE_MS = 12 * 60 * 60 * 1000;        // 12 hours

function isStale(sqlite: BetterSqlite3.Database): boolean {
  const row = sqlite.prepare('SELECT MAX(tstamp) AS ts FROM latest_price').get() as { ts: string | null };
  if (!row.ts) return true;                  // no prices yet
  return Date.now() - new Date(row.ts).getTime() > STALE_MS;
}

function hasActiveSecurities(sqlite: BetterSqlite3.Database): boolean {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM security WHERE COALESCE(isRetired, 0) = 0").get() as { n: number };
  return row.n > 0;
}

function needsFxAutoFetch(sqlite: BetterSqlite3.Database): boolean {
  if (!hasForeignCurrencies(sqlite, getBaseCurrency(sqlite))) return false;
  const row = sqlite.prepare('SELECT MAX(date) AS d FROM vf_exchange_rate').get() as { d: string | null };
  if (!row.d) return true;                   // table empty
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return row.d < yesterday;
}

export function wireAutoFetchHook(): void {
  setOnOpened((id, sqlite) => {
    // Demo portfolios are a seeded simulation, not a live portfolio; live Yahoo
    // fetches overwrite the tail of the seeded random walk and create a visible
    // discontinuity where the two series meet.
    if (getPortfolioEntry(id)?.kind === 'demo') return;

    const settings = getSettings();

    if (settings.app.autoFetchPricesOnFirstOpen && !fetchedInProcess.has(id)) {
      fetchedInProcess.add(id);
      if (isStale(sqlite) && hasActiveSecurities(sqlite)) {
        // Fire-and-forget. Errors log but don't propagate — boot must not fail.
        Promise.resolve().then(() => fetchAllPrices(sqlite))
          .catch(err => console.warn('[quovibe] auto fetch failed', { id, err: (err as Error).message }));
      }
    }

    if (settings.app.autoFetchFxOnFirstOpen && !fetchedFxInProcess.has(id)) {
      fetchedFxInProcess.add(id);
      if (needsFxAutoFetch(sqlite)) {
        Promise.resolve().then(() => fetchAllExchangeRates(sqlite))
          .catch(err => console.warn('[quovibe] auto fetch fx failed', { id, err: (err as Error).message }));
      }
    }
  });
}
