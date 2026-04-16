// packages/api/src/services/auto-fetch.ts
import type BetterSqlite3 from 'better-sqlite3';
import { setOnOpened } from './portfolio-db-pool';
import { getSettings } from './settings.service';
import { fetchAllPrices } from './prices.service';

const fetchedInProcess = new Set<string>();
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

export function wireAutoFetchHook(): void {
  setOnOpened((id, sqlite) => {
    if (!getSettings().app.autoFetchPricesOnFirstOpen) return;
    if (fetchedInProcess.has(id)) return;
    fetchedInProcess.add(id);
    if (!isStale(sqlite) || !hasActiveSecurities(sqlite)) return;
    // Fire-and-forget. Errors log but don't propagate — boot must not fail.
    Promise.resolve().then(() => fetchAllPrices(sqlite))
      .catch(err => console.warn('[quovibe] auto fetch failed', { id, err: (err as Error).message }));
  });
}
