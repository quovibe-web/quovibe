import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { QuovibePreferences } from '@quovibe/shared';

export type UpdatePreferencesInput = Partial<QuovibePreferences>;

// Query key shared between read and write so invalidation is co-located.
const prefKeys = {
  all: ['settings', 'preferences'] as const,
};

// Reads the full preferences block from GET /api/settings.
// staleTime: Infinity — preferences only change via this app's own writes.
export function usePreferences() {
  return useQuery({
    queryKey: prefKeys.all,
    queryFn: () =>
      apiFetch<{ preferences: QuovibePreferences }>('/api/settings').then(
        (s) => s.preferences,
      ),
    staleTime: Infinity,
  });
}

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
    onSuccess: (updated) => {
      // Optimistically sync the preferences read-cache so consumers update
      // without waiting for the next query refetch.
      qc.setQueryData<QuovibePreferences>(prefKeys.all, updated);
      // Only the `/api/portfolio` GET leaf reads sidecar data (see
      // `routes/portfolio.ts` for the preferences-merge block), so we invalidate
      // just that leaf across every cached portfolio. Prefix-matching on
      // `['portfolios']` would also refetch accounts / securities / performance /
      // transactions / etc., none of which depend on sidecar state.
      void qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'portfolios' && q.queryKey[2] === 'portfolio',
      });
    },
  });
}
