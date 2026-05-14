import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { CalculationView } from '@quovibe/shared';

const viewKeys = {
  all: ['settings', 'calculation-view'] as const,
};

export function useCalculationView() {
  return useQuery({
    queryKey: viewKeys.all,
    queryFn: () => apiFetch<CalculationView>('/api/settings/calculation-view'),
    staleTime: Infinity,
  });
}

export function useSaveCalculationView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<CalculationView>) =>
      apiFetch<CalculationView>('/api/settings/calculation-view', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: viewKeys.all });
      const prev = queryClient.getQueryData<CalculationView>(viewKeys.all);
      queryClient.setQueryData<CalculationView>(viewKeys.all, (old) => {
        if (!old) return newData as CalculationView;
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
