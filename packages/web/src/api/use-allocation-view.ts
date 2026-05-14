import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { AllocationView } from '@quovibe/shared';

const viewKeys = {
  all: ['settings', 'allocation-view'] as const,
};

export function useAllocationView() {
  return useQuery({
    queryKey: viewKeys.all,
    queryFn: () => apiFetch<AllocationView>('/api/settings/allocation-view'),
    staleTime: Infinity,
  });
}

export function useSaveAllocationView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<AllocationView>) =>
      apiFetch<AllocationView>('/api/settings/allocation-view', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: viewKeys.all });
      const prev = queryClient.getQueryData<AllocationView>(viewKeys.all);
      queryClient.setQueryData<AllocationView>(viewKeys.all, (old) => {
        if (!old) return newData as AllocationView;
        return { ...old, ...newData };
      });
      return { prev };
    },
    onError: (_err, _data, context) => {
      if (context?.prev) {
        queryClient.setQueryData(viewKeys.all, context.prev);
      }
    },
  });
}
