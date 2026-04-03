import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';

export function useInitPortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/api/portfolio/init', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
  });
}
