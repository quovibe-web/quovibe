import { Navigate, useLocation } from 'react-router-dom';
import { usePortfolioRegistry } from '@/api/use-portfolios';

export function RootRedirect() {
  const reg = usePortfolioRegistry();
  const { search } = useLocation();
  if (reg.isLoading) return <div />;
  if (!reg.data || !reg.data.initialized || !reg.data.defaultPortfolioId) {
    // error-path redirect: don't preserve search
    return <Navigate to="/welcome" replace />;
  }
  return <Navigate to={`/p/${reg.data.defaultPortfolioId}/dashboard${search}`} replace />;
}
