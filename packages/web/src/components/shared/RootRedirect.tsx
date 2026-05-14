import { Navigate, useLocation } from 'react-router-dom';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import {
  pickRootRedirectTarget,
  pickTabPortfolio,
  readTabPortfolioId,
} from '@/lib/portfolio-recency';

export function RootRedirect() {
  const reg = usePortfolioRegistry();
  const { search } = useLocation();
  if (reg.isLoading) return <div />;
  if (!reg.data || !reg.data.initialized) {
    // error-path redirect: don't preserve search
    return <Navigate to="/welcome" replace />;
  }
  // Per-tab session anchor wins over global recency; falls back to recency pick when absent or stale.
  const tabId = readTabPortfolioId();
  const tabHit = pickTabPortfolio(tabId, reg.data.portfolios);
  const targetId =
    tabHit?.id
    ?? pickRootRedirectTarget(reg.data.portfolios, reg.data.defaultPortfolioId);
  if (!targetId) {
    // error-path redirect: don't preserve search
    return <Navigate to="/welcome" replace />;
  }
  return <Navigate to={`/p/${targetId}/dashboard${search}`} replace />;
}
