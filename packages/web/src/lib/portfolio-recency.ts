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
