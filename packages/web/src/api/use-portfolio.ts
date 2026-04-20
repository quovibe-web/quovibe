import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { PortfolioResponse } from './types';

export const portfolioKeys = {
  all: (pid: string) => ['portfolios', pid, 'portfolio'] as const,
};

export function usePortfolio() {
  const api = useScopedApi();
  return useQuery({
    queryKey: portfolioKeys.all(api.portfolioId),
    queryFn: () => api.fetch<PortfolioResponse>('/api/portfolio'),
    placeholderData: keepPreviousData,
  });
}

// User-level preference writes moved to useUpdatePreferences (BUG-56).
// DB-side portfolio settings (costMethod, currency, calendar, alphaVantage)
// have no frontend writer today; they're seeded during bootstrap/import.
// Re-introduce a portfolio-scoped hook under the sharper name
// useUpdatePortfolioDbSettings if a caller appears.
