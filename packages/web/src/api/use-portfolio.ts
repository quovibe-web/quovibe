import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { PortfolioResponse } from './types';
import type { UpdateSettingsInput } from '@quovibe/shared';

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

/**
 * Portfolio-scoped DB settings: costMethod, currency, calendar,
 * alphaVantageApiKey, alphaVantageRateLimit. These persist in the portfolio's
 * `property` table (NOT the user sidecar — BUG-56). Each call PATCHes only the
 * keys present in `input`; the server's Zod schema is `.strict()`.
 */
export function useUpdatePortfolioDbSettings() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      api.fetch<{ config: Record<string, string | null> }>('/api/portfolio/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, input) => {
      // Changing costMethod / currency / calendar reshapes every downstream
      // computation (holdings, statement-of-assets, performance, calculation);
      // AV credentials only affect the /portfolio config leaf.
      const computedKeys: ReadonlyArray<keyof UpdateSettingsInput> = ['costMethod', 'currency', 'calendar'];
      const touchesComputation = computedKeys.some((k) => input[k] !== undefined);
      qc.invalidateQueries({
        queryKey: touchesComputation
          ? ['portfolios', api.portfolioId]
          : portfolioKeys.all(api.portfolioId),
      });
    },
  });
}
