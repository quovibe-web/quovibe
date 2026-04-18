import { useRef } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import { PortfolioContext } from '@/context/PortfolioContext';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import { pickActivePortfolio } from '@/lib/portfolio-recency';

/**
 * Layout for the user-level /settings surface. `/settings` has no
 * `:portfolioId` in the URL, but `Shell` (sidebar + top bar) needs a
 * PortfolioContext to render. We synthesize one from the most-recently-opened
 * portfolio so the user has a visible escape path back into their portfolio.
 * If no portfolios exist, bounce to /welcome.
 *
 * The active portfolio is pinned for the lifetime of the layout mount so a
 * late registry refetch (e.g. after another tab bumps `lastOpenedAt`) cannot
 * switch which portfolio the context's `active` points at while the page is
 * visible. If the pinned portfolio is deleted we fall back to re-picking.
 */
export function UserSettingsLayout() {
  const registry = usePortfolioRegistry();
  const pinnedIdRef = useRef<string | null>(null);

  if (registry.isLoading) return <div />;

  const portfolios = registry.data?.portfolios ?? [];
  const pinnedStillExists =
    pinnedIdRef.current !== null &&
    portfolios.some((p) => p.id === pinnedIdRef.current);
  if (!pinnedStillExists) {
    pinnedIdRef.current = pickActivePortfolio(portfolios)?.id ?? null;
  }
  const active = pinnedIdRef.current
    ? portfolios.find((p) => p.id === pinnedIdRef.current) ?? null
    : null;

  // error-path redirect: don't preserve search
  if (!active) return <Navigate to="/welcome" replace />;

  return (
    <PortfolioContext.Provider value={{ id: active.id, name: active.name, kind: active.kind }}>
      <Shell>
        <Outlet />
      </Shell>
    </PortfolioContext.Provider>
  );
}
