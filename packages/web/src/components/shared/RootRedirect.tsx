import { Navigate } from 'react-router-dom';
import { usePortfolioRegistry } from '@/api/use-portfolios';

export function RootRedirect() {
  const reg = usePortfolioRegistry();
  if (reg.isLoading) return <div />;
  if (!reg.data || !reg.data.initialized || !reg.data.defaultPortfolioId) {
    return <Navigate to="/welcome" replace />;
  }
  return <Navigate to={`/p/${reg.data.defaultPortfolioId}/dashboard`} replace />;
}
