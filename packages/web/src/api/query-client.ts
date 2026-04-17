import {
  QueryClient,
  MutationCache,
  type Mutation,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '@/i18n';

/**
 * Module augmentation so `meta.suppressGlobalErrorToast` is typed at every
 * `useMutation({ meta: ... })` call site.
 *
 * Why this lives here: the augmentation is load-bearing only because of the
 * `mutationCache.onError` handler defined below. Keeping both in the same file
 * makes the contract visible at a glance.
 */
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { suppressGlobalErrorToast?: boolean };
  }
}

/**
 * Every failed mutation fires a Sonner toast by default. A hook can opt out by
 * setting `meta: { suppressGlobalErrorToast: true }` on its `useMutation({...})`
 * options — this is used by hooks whose call sites already show a localized toast
 * and do NOT want the global one to fire in addition.
 *
 * IMPORTANT: this lives on `MutationCache.onError` (5-arg callback) rather than
 * `defaultOptions.mutations.onError` (4-arg) because only the cache-level callback
 * receives the `Mutation` instance as argument 4. Without it, `mutation.meta`
 * would not be reachable and the opt-out would silently fail.
 * See `node_modules/.../@tanstack/query-core/src/mutation.ts:276-293`.
 */
const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation: Mutation<unknown, unknown, unknown, unknown>) => {
    if (mutation.meta?.suppressGlobalErrorToast) return;
    const msg =
      error instanceof Error && error.message
        ? error.message
        : i18n.t('mutation.genericFailure', { ns: 'errors' });
    toast.error(msg);
  },
});

export const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
