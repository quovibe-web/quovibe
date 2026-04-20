import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { QuovibePreferences } from '@quovibe/shared';

export type UpdatePreferencesInput = Partial<QuovibePreferences>;

// User-level preference writes hit the unscoped sidecar endpoint directly.
// Using apiFetch (not useScopedApi) guarantees no /api/p/:pid prefix — BUG-56
// closed the bug class where a portfolio-scoped endpoint was silently mutating
// user-global state on the /settings page via the pinned-portfolio fallback.
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdatePreferencesInput) =>
      apiFetch<QuovibePreferences>('/api/settings/preferences', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    // Only the `/api/portfolio` GET leaf reads sidecar data (see
    // `routes/portfolio.ts` for the preferences-merge block), so we invalidate
    // just that leaf across every cached portfolio. Prefix-matching on
    // `['portfolios']` would also refetch accounts / securities / performance /
    // transactions / etc., none of which depend on sidecar state.
    onSuccess: () => qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === 'portfolios' && q.queryKey[2] === 'portfolio',
    }),
  });
}
