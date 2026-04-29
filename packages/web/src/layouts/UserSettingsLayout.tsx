import { useRef } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import { PortfolioContext } from '@/context/PortfolioContext';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import {
  pickActivePortfolio,
  pickTabPortfolio,
  readTabPortfolioId,
} from '@/lib/portfolio-recency';

/**
 * Layout for the user-level /settings surface. `/settings` has no
 * `:portfolioId` in the URL, but `Shell` (sidebar + top bar) needs a
 * PortfolioContext to render.
 *
 * Resolution order for the active portfolio:
 *   1. sessionStorage `qv:tabPortfolioId` — this tab's last-validated
 *      portfolio (written by PortfolioLayout). Per-tab, so a sibling tab
 *      bumping a different portfolio's `lastOpenedAt` cannot leak in.
 *   2. `pickActivePortfolio` (global lastOpenedAt recency) — fallback for
 *      brand-new tabs opening /settings directly via bookmark/URL.
 *   3. `/welcome` — registry is empty.
 *
 * The chosen id is pinned for the lifetime of the layout mount so a late
 * registry refetch (e.g. after another tab bumps `lastOpenedAt`) cannot
 * switch the active portfolio while the page is visible. If the pinned
 * portfolio is deleted, the membership re-check forces a re-pick.
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
    pinnedIdRef.current =
      pickTabPortfolio(readTabPortfolioId(), portfolios)?.id
      ?? pickActivePortfolio(portfolios)?.id
      ?? null;
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
