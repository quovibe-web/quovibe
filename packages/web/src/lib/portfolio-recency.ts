import type { PortfolioRegistryEntry } from '@/api/use-portfolios';

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
