import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { PortfolioResponse } from './types';

export const portfolioKeys = {
  all: ['portfolio'] as const,
};

export function usePortfolio() {
  return useQuery({
    queryKey: portfolioKeys.all,
    queryFn: () => apiFetch<PortfolioResponse>('/api/portfolio'),
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSettingsData) =>
      apiFetch('/api/portfolio/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: portfolioKeys.all }),
  });
}
