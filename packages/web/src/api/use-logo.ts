import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { LogoResolveRequest } from '@quovibe/shared';

export function useResolveLogo() {
  return useMutation({
    mutationFn: (input: LogoResolveRequest) =>
      apiFetch<{ logoUrl: string }>('/api/logo/resolve', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}
