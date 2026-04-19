import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { SetupPortfolioInput } from '@quovibe/shared';
import { apiFetch } from './fetch';

/**
 * Server shape returned by GET /api/p/:pid/securities-accounts
 * (ordered by `_order`). Re-declared client-side: the server already validates
 * the response and consumers treat it as a read-only list.
 */
export interface SecuritiesAccount {
  id: string;
  name: string;
  currency: string | null;
  referenceAccountId: string | null;
}

/**
 * Lists the securities (portfolio-type) accounts for a given portfolio.
 *
 * `enabled: !!portfolioId` so the hook can be called conditionally — e.g.
 * before a route param resolves on the setup page. Uses `apiFetch` with
 * the fully-prefixed URL rather than `useScopedApi`, which would throw
 * when the URL param is not yet available.
 */
export function useSecuritiesAccounts(
  portfolioId: string,
): UseQueryResult<SecuritiesAccount[]> {
  return useQuery({
    queryKey: ['securities-accounts', portfolioId],
    queryFn: () =>
      apiFetch<SecuritiesAccount[]>(
        `/api/p/${portfolioId}/securities-accounts`,
      ),
    enabled: !!portfolioId,
  });
}

/**
 * Seeds the initial securities account(s) and reference cash account(s)
 * for a fresh portfolio via POST /api/p/:pid/setup.
 *
 * `apiFetch` throws `Error(body.error)` on non-2xx — the message is the
 * server's error code string (`INVALID_INPUT`, `ALREADY_SETUP`,
 * `PORTFOLIO_NOT_FOUND`, `DUPLICATE_NAME`). Consumers read
 * `(err as Error).message` directly; do not wrap or re-shape here.
 *
 * On success, invalidate both the securities-accounts list and the
 * accounts-list query key used by `use-accounts.ts` so the UI sees the
 * seeded state immediately.
 */
export function useSetupPortfolio(portfolioId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupPortfolioInput) =>
      apiFetch<{ ok: true }>(`/api/p/${portfolioId}/setup`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['securities-accounts', portfolioId] });
      qc.invalidateQueries({
        queryKey: ['portfolios', portfolioId, 'accounts'],
      });
    },
  });
}
