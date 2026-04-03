import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { InvestmentsView } from '@quovibe/shared';

const viewKeys = {
  all: ['settings', 'investments-view'] as const,
};

export function useInvestmentsView() {
  return useQuery({
    queryKey: viewKeys.all,
    queryFn: () => apiFetch<InvestmentsView>('/api/settings/investments-view'),
    staleTime: Infinity,
  });
}

export function useSaveInvestmentsView() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<InvestmentsView>) =>
      apiFetch<InvestmentsView>('/api/settings/investments-view', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: viewKeys.all });
      const prev = queryClient.getQueryData<InvestmentsView>(viewKeys.all);
      queryClient.setQueryData<InvestmentsView>(viewKeys.all, (old) => {
        if (!old) return newData as InvestmentsView;
        return {
          ...old,
          ...newData,
          // columns is now a flat string[] — replace entirely when provided
          columns: newData.columns !== undefined ? newData.columns : old.columns,
        };
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
