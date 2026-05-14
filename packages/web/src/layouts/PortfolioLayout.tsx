import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { UUID_V4_RE } from '@quovibe/shared';
import { Shell } from '@/components/layout/Shell';
import { PortfolioContext } from '@/context/PortfolioContext';
import { usePortfolioRegistry, useTouchPortfolio } from '@/api/use-portfolios';
import { useSecuritiesAccounts } from '@/api/use-securities-accounts';
import { useEventStream } from '@/api/use-events';
import { appendSearch } from '@/lib/router-helpers';
import { shouldTouchPortfolio, writeTabPortfolioId } from '@/lib/portfolio-recency';

export function PortfolioLayout() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const location = useLocation();
  const registry = usePortfolioRegistry();
  const securitiesAccounts = useSecuritiesAccounts(portfolioId ?? '');
  const touch = useTouchPortfolio();
  useEventStream();

  const isValidPortfolioId = !!portfolioId && UUID_V4_RE.test(portfolioId);
  const entry = isValidPortfolioId
    ? registry.data?.portfolios.find((p) => p.id === portfolioId) ?? null
    : null;
  const validatedEntryId = entry?.id ?? null;
  const entryLastOpenedAt = entry?.lastOpenedAt ?? null;

  // Persist this tab's last-validated portfolio id. UserSettingsLayout reads
  // it via sessionStorage so /settings anchors on the same portfolio this
  // tab was viewing — global `lastOpenedAt` is shared across tabs and would
  // otherwise let a sibling tab's switcher click silently change which
  // portfolio appears "active" when /settings mounts.
  useEffect(() => {
    if (validatedEntryId) writeTabPortfolioId(validatedEntryId);
  }, [validatedEntryId]);

  // Bump the server-side `lastOpenedAt` whenever the user lands on a
  // portfolio via direct URL / bookmark / tab restore. The throttle
  // (`shouldTouchPortfolio`) reads from the registry cache, which
  // `useTouchPortfolio`'s optimistic update keeps fresh.
  const touchMutate = touch.mutate;
  useEffect(() => {
    if (!validatedEntryId) return;
    if (!shouldTouchPortfolio(entryLastOpenedAt, Date.now())) return;
    touchMutate(validatedEntryId);
  }, [validatedEntryId, entryLastOpenedAt, touchMutate]);

  // Baseline document.title for the current portfolio; preserves any
  // more-specific page-scoped title already set for this portfolio so SPA
  // route transitions don't flicker the page segment off for one frame.
  useEffect(() => {
    if (!entry) return;
    const prefix = `${entry.name} · `;
    const baseline = `${prefix}quovibe`;
    if (document.title.startsWith(prefix) && document.title !== baseline) return;
    document.title = baseline;
  }, [entry?.name]);

  if (!isValidPortfolioId) {
    // error-path redirect: don't preserve search
    return <Navigate to="/welcome" replace />;
  }
  if (registry.isLoading) {
    // Registry not yet loaded — entry unknown, can't render Shell because
    // its consumers (TopBar PortfolioSwitcher, etc.) read PortfolioContext.
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
  // per `.claude/rules/frontend.md` redirect-with-search rule. The check is
  // gated on `securitiesAccounts.data` being defined so that an in-flight
  // fetch does not falsely trigger the setup redirect (data ?? [] is empty
  // while loading — the Shell-with-skeleton branch below covers this).
  if (securitiesAccounts.data && securitiesAccounts.data.length === 0) {
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
        {/*
          Remount the entire portfolio-scoped subtree on pid change. Many
          downstream query hooks set `placeholderData: keepPreviousData`,
          which keeps serving the prior portfolio's data while the new
          fetch is in flight. On SPA navigation (switcher click / Link)
          the URL flips synchronously while query observers are still
          mounted, producing a brief render of A's data under B's URL —
          a cross-portfolio render flash. Forcing an unmount via the
          key resets every observer below and falls into the loading
          branch (skeletons). The siblings inside Shell (Sidebar, TopBar,
          PortfolioSwitcher) are intentionally NOT remounted so drawer
          state, sidebar collapse, and scroll position survive a switch.
          Complementary fix: PortfolioSwitcher.pick passes `flushSync: true`
          to navigate so React commits the route change synchronously,
          collapsing the ~40 ms async-commit lag during which the prior
          portfolio's painted pixels would otherwise survive on screen.
          When `securitiesAccounts` is still in flight on a first-time pid
          visit, Shell stays rendered (TopBar / PortfolioSwitcher / Sidebar
          all read from PortfolioContext which is set to the new entry) and
          a skeleton fills the Outlet area. Tearing down Shell during the
          fetch was the root cause of the residual "stale TopBar header
          while URL = new pid" window — that branch returned a bare
          `<div/>`, unmounting every layout sibling.
        */}
        {securitiesAccounts.isLoading ? (
          <div className="p-6 animate-pulse">
            <div className="h-8 w-48 mb-4 rounded bg-muted" />
            <div className="h-64 w-full rounded bg-muted" />
          </div>
        ) : (
          <Outlet key={portfolioId} />
        )}
      </Shell>
    </PortfolioContext.Provider>
  );
}
