import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
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

interface UpdateSettingsData {
  // DB fields
  currency?: string;
  costMethod?: string;
  calendar?: string;
  alphaVantageApiKey?: string;
  alphaVantageRateLimit?: string;
  // Sidecar fields
  language?: string;
  theme?: 'light' | 'dark' | 'system';
  sharesPrecision?: number;
  quotesPrecision?: number;
  showCurrencyCode?: boolean;
  showPaSuffix?: boolean;
  privacyMode?: boolean;
  activeReportingPeriodId?: string;
  defaultDataSeriesTaxonomyId?: string;
}

export function useUpdateSettings() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSettingsData) =>
      api.fetch('/api/portfolio/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: portfolioKeys.all(api.portfolioId) }),
  });
}
