import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { SecurityEventItem } from './types';

export const securityEventKeys = {
  list: (pid: string, securityId: string) =>
    ['portfolios', pid, 'security-events', securityId] as const,
};

export function useSecurityEvents(securityId: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: securityEventKeys.list(api.portfolioId, securityId),
    queryFn: () => api.fetch<SecurityEventItem[]>(`/api/securities/${securityId}/events`),
    enabled: !!securityId,
  });
}

export function useCreateSecurityEvent() {
  const api = useScopedApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { securityId: string; type: string; date: string; details: string }) =>
      api.fetch<SecurityEventItem>(`/api/securities/${data.securityId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: securityEventKeys.list(api.portfolioId, variables.securityId) });
    },
  });
}

export function useDeleteSecurityEvent() {
  const api = useScopedApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ securityId, eventId }: { securityId: string; eventId: string }) =>
      api.fetch<void>(`/api/securities/${securityId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: securityEventKeys.list(api.portfolioId, variables.securityId) });
    },
  });
}
