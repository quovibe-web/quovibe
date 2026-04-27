import type BetterSqlite3 from 'better-sqlite3';
import { fetchAllExchangeRates } from './fx-fetcher.service';
import { getPortfolioEntry } from './portfolio-registry';

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

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

  // hoursUntil17 in (0, 24]. When localHour === 24 (some Intl contexts emit
  // '24' at midnight Europe/Berlin), 17 - 24 = -7, +24 = 17, then cap at 6h.
  let hoursUntil17 = 17 - localHour;
  if (hoursUntil17 <= 0) hoursUntil17 += 24;
  const msUntil17 = hoursUntil17 * 60 * 60 * 1000 - localMin * 60 * 1000 - localSec * 1000;

  return Math.min(msUntil17, SIX_HOURS_MS);
}

// quovibe:allow-module-state — scheduler timer handles only, keyed by portfolio id; no data held (ADR-016).
const timers = new Map<string, NodeJS.Timeout>();

export function startFxScheduler(id: string, sqlite: BetterSqlite3.Database): void {
  if (getPortfolioEntry(id)?.kind === 'demo') return;
  stopFxScheduler(id);

  const tick = (): void => {
    Promise.resolve()
      .then(() => fetchAllExchangeRates(sqlite))
      .catch(err => console.warn('[quovibe] fx scheduler fetch failed', { id, err: (err as Error).message }))
      .finally(() => {
        // Re-arm only if we still own this portfolio handle.
        if (timers.has(id)) {
          const next = setTimeout(tick, msUntilNextRefresh());
          timers.set(id, next);
        }
      });
  };

  // Initial tick: schedule at the same cadence (don't fire synchronously —
  // matches the upstream job, which uses a delayed schedule instead of running now).
  const handle = setTimeout(tick, msUntilNextRefresh());
  timers.set(id, handle);
}

export function stopFxScheduler(id: string): void {
  const t = timers.get(id);
  if (!t) return;
  clearTimeout(t);
  timers.delete(id);
}

/** Test helper. Never call from production code. */
export function _schedulerStateForTests(): { size: number; ids: string[] } {
  return { size: timers.size, ids: [...timers.keys()] };
}
