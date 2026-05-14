import {
  QueryClient,
  MutationCache,
  type Mutation,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '@/i18n';
import type { ApiError } from './fetch';

/**
 * Structural check rather than `instanceof ApiError`. Module duplication (HMR,
 * vi.resetModules, pnpm dedupe edge cases) can produce two distinct ApiError
 * class objects in the same process, at which point `instanceof` returns false
 * for errors constructed against the "other" copy. The shape-check keeps the
 * handler working across all of those cases.
 */
export function isApiError(err: unknown): err is ApiError {
  return (
    err instanceof Error &&
    (err as { name?: string }).name === 'ApiError' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

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
 * When an `ApiError` reaches the global handler, we look up a translation under
 * `errors:server.<CODE>`. i18next with `returnNull: false` (default) returns the
 * key itself on miss, so we sniff that to decide whether to fall back. Keys and
 * interpolation variables are enumerated in `locales/*\/errors.json` under
 * `server.*`; see `.claude/rules/xml-import.md` and `.claude/rules/csv-import.md`
 * for the authoritative code list.
 */
export function translateServerCode(err: ApiError): string {
  const key = `server.${err.code}`;
  const translated = i18n.t(key, { ns: 'errors', ...(err.details ?? {}) });
  if (translated && translated !== key) return translated;
  // Unknown code: in dev surface the raw code to speed debugging; in prod fall
  // back to the generic "something went wrong" so users never see identifiers.
  if (import.meta.env.DEV) {
    // CONVERSION_FAILED leaks a ~2 KB Python traceback in `details.details`;
    // truncate so toast rendering and error-reporting stay bounded.
    const raw = err.details?.['details'];
    if (typeof raw === 'string' && raw.length > 0) {
      return `${err.code}: ${raw.slice(0, 500)}`;
    }
    return err.code;
  }
  return i18n.t('mutation.genericFailure', { ns: 'errors' });
}

/**
 * Resolve any unknown error to a user-facing string. Use at call sites that
 * opt out of the global MutationCache toast via `suppressGlobalErrorToast`
 * and own a localized toast — never pass `err.message` through as-is, because
 * on an `ApiError` `message` is the raw wire CODE (e.g. `DEMO_SOURCE_MISSING`),
 * not a readable sentence.
 */
export function resolveErrorMessage(err: unknown): string {
  if (isApiError(err)) return translateServerCode(err);
  if (err instanceof Error) return err.message;
  return String(err);
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
    let msg: string;
    if (isApiError(error)) {
      msg = translateServerCode(error);
    } else if (error instanceof Error && error.message) {
      msg = error.message;
    } else {
      msg = i18n.t('mutation.genericFailure', { ns: 'errors' });
    }
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
