import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { SecurityEventItem } from './types';

export const securityEventKeys = {
  list: (securityId: string) => ['security-events', securityId] as const,
};

export function useSecurityEvents(securityId: string) {
  return useQuery({
    queryKey: securityEventKeys.list(securityId),
    queryFn: () => apiFetch<SecurityEventItem[]>(`/api/securities/${securityId}/events`),
    enabled: !!securityId,
  });
}

export function useCreateSecurityEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { securityId: string; type: string; date: string; details: string }) =>
      apiFetch<SecurityEventItem>(`/api/securities/${data.securityId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: securityEventKeys.list(variables.securityId) });
    },
  });
}

export function useDeleteSecurityEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ securityId, eventId }: { securityId: string; eventId: string }) =>
      apiFetch<void>(`/api/securities/${securityId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: securityEventKeys.list(variables.securityId) });
    },
  });
}
