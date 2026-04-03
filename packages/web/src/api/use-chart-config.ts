import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { ChartConfig } from '@quovibe/shared';

const chartConfigKeys = {
  all: ['settings', 'chart-config'] as const,
};

export function useChartConfig() {
  return useQuery({
    queryKey: chartConfigKeys.all,
    queryFn: () => apiFetch<ChartConfig>('/api/settings/chart-config'),
    staleTime: Infinity,
  });
}

export function useSaveChartConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ChartConfig) =>
      apiFetch<ChartConfig>('/api/settings/chart-config', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: chartConfigKeys.all });
      const prev = queryClient.getQueryData<ChartConfig>(chartConfigKeys.all);
      queryClient.setQueryData<ChartConfig>(chartConfigKeys.all, newData);
      return { prev };
    },
    onError: (_err, _data, context) => {
      if (context?.prev) {
        queryClient.setQueryData(chartConfigKeys.all, context.prev);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(chartConfigKeys.all, data);
      queryClient.invalidateQueries({ queryKey: ['performance'] });
    },
  });
}
