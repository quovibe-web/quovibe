import { Suspense } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { UUID_V4_RE } from '@quovibe/shared';
import { Shell } from '@/components/layout/Shell';
import { PortfolioContext } from '@/context/PortfolioContext';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import { useEventStream } from '@/api/use-events';

export function PortfolioLayout() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const registry = usePortfolioRegistry();
  useEventStream();

  if (!portfolioId || !UUID_V4_RE.test(portfolioId)) {
    return <Navigate to="/welcome" replace />;
  }
  if (registry.isLoading) return <Suspense fallback={null}><div /></Suspense>;

  const entry = registry.data?.portfolios.find((p) => p.id === portfolioId);
  if (!entry) return <Navigate to="/welcome" replace />;

  return (
    <PortfolioContext.Provider value={{ id: entry.id, name: entry.name, kind: entry.kind }}>
      <Shell>
        <Outlet />
      </Shell>
    </PortfolioContext.Provider>
  );
}
