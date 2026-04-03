import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { RebalancingResponse } from './types';

export const rebalancingKeys = {
  detail: (taxonomyId: string, date: string) =>
    ['rebalancing', taxonomyId, date] as const,
};

export function useRebalancing(taxonomyId: string | undefined, date: string) {
  return useQuery({
    queryKey: rebalancingKeys.detail(taxonomyId ?? '', date),
    queryFn: () =>
      apiFetch<RebalancingResponse>(
        `/api/taxonomies/${taxonomyId}/rebalancing?date=${date}`,
      ),
    enabled: !!taxonomyId,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateAllocation(taxonomyId: string | undefined, date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, allocation }: { categoryId: string; allocation: number }) =>
      apiFetch<{ ok: boolean }>(`/api/taxonomies/categories/${categoryId}/allocation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocation }),
      }),
    onSuccess: () => {
      if (taxonomyId) {
        qc.invalidateQueries({ queryKey: rebalancingKeys.detail(taxonomyId, date) });
        // Also invalidate the taxonomy tree cache (allocation = category weight)
        qc.invalidateQueries({ queryKey: ['taxonomies', taxonomyId] });
      }
    },
  });
}
