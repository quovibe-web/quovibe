import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { RebalancingResponse } from './types';

export const rebalancingKeys = {
  detail: (pid: string, taxonomyId: string, date: string) =>
    ['portfolios', pid, 'rebalancing', taxonomyId, date] as const,
};

export function useRebalancing(taxonomyId: string | undefined, date: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: rebalancingKeys.detail(api.portfolioId, taxonomyId ?? '', date),
    queryFn: () =>
      api.fetch<RebalancingResponse>(
        `/api/taxonomies/${taxonomyId}/rebalancing?date=${date}`,
      ),
    enabled: !!taxonomyId,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateAllocation(taxonomyId: string | undefined, date: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, allocation }: { categoryId: string; allocation: number }) =>
      api.fetch<{ ok: boolean }>(`/api/taxonomies/categories/${categoryId}/allocation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocation }),
      }),
    onSuccess: () => {
      if (taxonomyId) {
        qc.invalidateQueries({ queryKey: rebalancingKeys.detail(api.portfolioId, taxonomyId, date) });
        // Also invalidate the taxonomy tree cache (allocation = category weight)
        qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'taxonomies', taxonomyId] });
      }
    },
  });
}
