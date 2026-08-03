import type BetterSqlite3 from 'better-sqlite3';
import { fetchAllExchangeRates } from './fx-fetcher.service';
import { getPortfolioEntry } from './portfolio-registry';
import { setOnOpened, setOnEvicted } from './portfolio-db-pool';
import { backfillCrossCurrencyGrossUnits } from '../db/apply-bootstrap';

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Fetch rates, then re-run the cross-currency GROSS_VALUE backfill.
 *
 * The backfill also runs inside `applyBootstrap`, but on a freshly imported
 * portfolio that pass is guaranteed to find an empty rate cache: bootstrap
 * completes before this portfolio has ever been opened through the pool, which
 * is what triggers the first fetch. Without a second pass the trades stay
 * undecorated until the DB is reopened — process restart or pool eviction.
 *
 * Failures are swallowed by design: FX refresh is best-effort background work
 * and must never take down the tick or reject into the pool's open hook.
 */
async function refreshRatesThenBackfill(
  id: string,
  sqlite: BetterSqlite3.Database,
  phase: 'eager' | 'tick',
): Promise<void> {
  try {
    const summary = await fetchAllExchangeRates(sqlite);
    // Per-pair outcome, not just the aggregate. A pair neither upstream can
    // serve (ECB does not publish it, Yahoo has no ticker) is indistinguishable
    // from a blocked egress in the aggregate — and both surface later as
    // "missing rate at period boundary", far from their cause.
    const failed = summary.results.filter(r => r.error !== undefined);
    console.log(
      `[fx] ${phase} refresh: ${summary.totalFetched} rate(s) over ${summary.results.length} pair(s), ${failed.length} unresolved (${summary.duration} ms)`,
    );
    for (const r of failed) {
      console.warn(`[fx]   ${r.pair}: ${r.error}`);
    }
  } catch (err) {
    console.warn(`[fx] ${phase} refresh failed`, { id, err: (err as Error).message });
    return;
  }
  try {
    backfillCrossCurrencyGrossUnits(sqlite);
  } catch (err) {
    console.warn(`[fx] ${phase} post-fetch backfill failed`, { id, err: (err as Error).message });
  }
}

/**
 * Milliseconds until the next refresh tick. Mirrors the upstream
 * `StartupAddon.UpdateExchangeRatesJob` cadence: target the next 17:00 in
 * Europe/Berlin (CET/CEST handled by Intl) but cap at 6h so a tick still
 * fires during the night. The 17:00 anchor matches ECB's ~16:00 CET publish
 * window plus a 1h cushion.
 */
export function msUntilNextRefresh(nowMs: number = Date.now()): number {
  // Use Intl to derive "what is the local Y/M/D/H/M in Europe/Berlin right now".
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(nowMs)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
  );
  const localHour = parseInt(parts.hour, 10);
  const localMin = parseInt(parts.minute, 10);
  const localSec = parseInt(parts.second, 10);

  // When localHour >= 17 (i.e. we're already past or at today's anchor),
  // target tomorrow's 17:00 instead.
  let hoursUntil17 = 17 - localHour;
  if (hoursUntil17 <= 0) hoursUntil17 += 24;
  const msUntil17 = hoursUntil17 * 60 * 60 * 1000 - localMin * 60 * 1000 - localSec * 1000;

  return Math.min(msUntil17, SIX_HOURS_MS);
}

// quovibe:allow-module-state — scheduler timer handles only, keyed by portfolio id; no data held (ADR-016).
const timers = new Map<string, NodeJS.Timeout>();
// quovibe:allow-module-state — one-shot eager-fetch dedup; keyed by portfolio id, no data held (ADR-016).
const eagerFiredInProcess = new Set<string>();

/**
 * Start the per-portfolio FX refresh tick. Idempotent: re-entry replaces the
 * prior timer. Demo portfolios are skipped (live fetches would create a
 * discontinuity at the seeded simulation seam — same posture as auto-fetch).
 *
 * Fires `refreshRatesThenBackfill` eagerly once per portfolio per process, then
 * arms the cadence tick. Mirrors the upstream startup-then-schedule order
 * (`provider.update` runs before `Job.schedule(delay)`). Subsequent re-acquires
 * (after pool eviction + reopen) skip the eager fetch — the scheduled tick
 * handles freshness from then on.
 */
export function startFxScheduler(id: string, sqlite: BetterSqlite3.Database): void {
  if (getPortfolioEntry(id)?.kind === 'demo') return;
  stopFxScheduler(id);

  if (!eagerFiredInProcess.has(id)) {
    eagerFiredInProcess.add(id);
    void refreshRatesThenBackfill(id, sqlite, 'eager');
  }

  let self: NodeJS.Timeout;

  const tick = (): void => {
    refreshRatesThenBackfill(id, sqlite, 'tick')
      .finally(() => {
        // Re-arm only if THIS tick is still the current owner of the slot
        // (a stop+start pair during the in-flight fetch would replace `self`).
        if (timers.get(id) === self) {
          const next = setTimeout(tick, msUntilNextRefresh());
          self = next;
          timers.set(id, next);
        }
      });
  };

  self = setTimeout(tick, msUntilNextRefresh());
  timers.set(id, self);
}

/**
 * Stop the per-portfolio FX refresh tick. No-op if not running.
 */
export function stopFxScheduler(id: string): void {
  const t = timers.get(id);
  if (!t) return;
  clearTimeout(t);
  timers.delete(id);
}

/**
 * Register the FX scheduler with the portfolio-db-pool lifecycle hooks.
 * Called once at app startup (alongside `wireAutoFetchHook`). Pool eviction
 * (manual delete OR idle-over-cap) and pool open (cache-miss acquire) both
 * drive the per-portfolio timer lifecycle here.
 */
export function wireFxScheduler(): void {
  setOnOpened((id, sqlite) => startFxScheduler(id, sqlite));
  setOnEvicted((id) => stopFxScheduler(id));
}

/** Test helper. Never call from production code. */
export function _schedulerStateForTests(): { size: number; ids: string[] } {
  return { size: timers.size, ids: [...timers.keys()] };
}

/** Test helper. Never call from production code. */
export function _resetEagerForTests(): void {
  eagerFiredInProcess.clear();
}
