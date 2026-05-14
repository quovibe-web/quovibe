import type { PortfolioRegistryEntry } from '@/api/use-portfolios';

// sessionStorage key holding this tab's last-validated portfolio id.
// Per-tab scope keeps the value isolated from sibling tabs that may have
// touched a different portfolio's `lastOpenedAt` server-side.
const TAB_PORTFOLIO_KEY = 'qv:tabPortfolioId';

/** PortfolioLayout writes here on every successful mount. */
export function writeTabPortfolioId(id: string): void {
  sessionStorage.setItem(TAB_PORTFOLIO_KEY, id);
}

/** UserSettingsLayout reads here to anchor `/settings` on this tab's portfolio. */
export function readTabPortfolioId(): string | null {
  return sessionStorage.getItem(TAB_PORTFOLIO_KEY);
}

/**
 * Compare two registry entries so `Array.sort()` yields:
 *   lastOpenedAt DESC NULLS LAST, createdAt DESC as tiebreak.
 * Used by Welcome's "recent portfolios" panel and UserSettingsLayout's
 * "which portfolio is active while on /settings" choice.
 */
export function sortByRecency(
  a: PortfolioRegistryEntry,
  b: PortfolioRegistryEntry,
): number {
  const aKey = a.lastOpenedAt ?? '';
  const bKey = b.lastOpenedAt ?? '';
  if (aKey !== bKey) {
    if (!aKey) return 1;
    if (!bKey) return -1;
    return bKey.localeCompare(aKey);
  }
  return b.createdAt.localeCompare(a.createdAt);
}

/** The portfolio to treat as "active" when the URL has no `:portfolioId` param. */
export function pickActivePortfolio(
  portfolios: PortfolioRegistryEntry[],
): PortfolioRegistryEntry | null {
  if (portfolios.length === 0) return null;
  return [...portfolios].sort(sortByRecency)[0];
}

/**
 * Resolve a tab-local portfolio id (sessionStorage-backed) against the
 * registry. Returns the matching entry if the id is present AND still
 * exists. Otherwise returns null so callers can fall back to
 * `pickActivePortfolio`. Stale ids (deleted portfolios) and absent ids
 * are both handled by the same membership check.
 */
export function pickTabPortfolio(
  tabId: string | null,
  portfolios: PortfolioRegistryEntry[],
): PortfolioRegistryEntry | null {
  if (!tabId) return null;
  return portfolios.find((p) => p.id === tabId) ?? null;
}

/**
 * Throttle window for the `lastOpenedAt` server bump. Switching between
 * sub-pages of the same portfolio MUST NOT spam `PATCH /api/portfolios/:id`
 * — the value only needs to be fresh enough that "recency" picks up the
 * portfolio after a tab close + reopen. Five minutes matches the registry
 * query staleTime and the precedent set by other server-touch debounces.
 */
export const PORTFOLIO_TOUCH_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Decide whether to fire `PATCH /api/portfolios/:id { lastOpenedAt }`.
 * Returns true when the portfolio has never been touched OR the recorded
 * timestamp is older than the throttle window. Pure — `now` is injected so
 * tests don't need fake-timers.
 */
export function shouldTouchPortfolio(
  lastOpenedAt: string | null | undefined,
  now: number,
  throttleMs = PORTFOLIO_TOUCH_THROTTLE_MS,
): boolean {
  if (!lastOpenedAt) return true;
  const lastMs = Date.parse(lastOpenedAt);
  if (!Number.isFinite(lastMs)) return true;
  return now - lastMs >= throttleMs;
}

/**
 * Decide where the root redirect (`/`) should land when the registry is
 * loaded. Prefers the most-recently-opened real portfolio so a tab close +
 * reopen restores the user's last context. Falls back to `defaultPortfolioId`
 * when no entry has a `lastOpenedAt` (fresh install, imported backups with
 * no recency record). Returns null to signal `/welcome`.
 *
 * `kind === 'demo'` portfolios are skipped at the recency step so a quick
 * "Try the Demo" peek does not silently displace the user's real default.
 * The defaultPortfolioId fallback respects the user's explicit choice
 * including demo entries.
 */
export function pickRootRedirectTarget(
  portfolios: PortfolioRegistryEntry[],
  defaultPortfolioId: string | null,
): string | null {
  const realRecent = portfolios
    .filter((p) => p.kind === 'real' && p.lastOpenedAt !== null)
    .sort(sortByRecency)[0];
  if (realRecent) return realRecent.id;
  if (defaultPortfolioId && portfolios.some((p) => p.id === defaultPortfolioId)) {
    return defaultPortfolioId;
  }
  // No recency signal AND no valid default → caller renders /welcome.
  return null;
}
