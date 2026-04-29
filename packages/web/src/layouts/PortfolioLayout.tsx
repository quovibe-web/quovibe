import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { UUID_V4_RE } from '@quovibe/shared';
import { Shell } from '@/components/layout/Shell';
import { PortfolioContext } from '@/context/PortfolioContext';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import { useSecuritiesAccounts } from '@/api/use-securities-accounts';
import { useEventStream } from '@/api/use-events';
import { appendSearch } from '@/lib/router-helpers';
import { writeTabPortfolioId } from '@/lib/portfolio-recency';

export function PortfolioLayout() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const location = useLocation();
  const registry = usePortfolioRegistry();
  const securitiesAccounts = useSecuritiesAccounts(portfolioId ?? '');
  useEventStream();

  const isValidPortfolioId = !!portfolioId && UUID_V4_RE.test(portfolioId);
  const entry = isValidPortfolioId
    ? registry.data?.portfolios.find((p) => p.id === portfolioId) ?? null
    : null;
  const validatedEntryId = entry?.id ?? null;

  // Persist this tab's last-validated portfolio id. UserSettingsLayout reads
  // it via sessionStorage so /settings anchors on the same portfolio this
  // tab was viewing — global `lastOpenedAt` is shared across tabs and would
  // otherwise let a sibling tab's switcher click silently change which
  // portfolio appears "active" when /settings mounts.
  useEffect(() => {
    if (validatedEntryId) writeTabPortfolioId(validatedEntryId);
  }, [validatedEntryId]);

  if (!isValidPortfolioId) {
    // error-path redirect: don't preserve search
    return <Navigate to="/welcome" replace />;
  }
  if (registry.isLoading || securitiesAccounts.isLoading) {
    return <Suspense fallback={null}><div /></Suspense>;
  }

  // error-path redirect: don't preserve search
  if (!entry) return <Navigate to="/welcome" replace />;

  // BUG-54/55 Phase 5 — universal safety net for N=0 portfolios. Any source
  // that lands a user here without a securities account (legacy fresh
  // portfolios created pre-fix; restored quovibe-db backups taken pre-fix)
  // bounces to /setup, which renders the PortfolioSetupForm and POSTs to
  // /api/p/:pid/setup. /setup itself is a sibling route (not a child of
  // PortfolioLayout) so this redirect can't loop. Preserves location.search
  // per `.claude/rules/frontend.md` redirect-with-search rule.
  if ((securitiesAccounts.data ?? []).length === 0) {
    return (
      <Navigate
        to={appendSearch(`/p/${portfolioId}/setup`, location.search)}
        replace
      />
    );
  }

  return (
    <PortfolioContext.Provider value={{ id: entry.id, name: entry.name, kind: entry.kind }}>
      <Shell>
        <Outlet />
      </Shell>
    </PortfolioContext.Provider>
  );
}
