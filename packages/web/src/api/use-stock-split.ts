import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import { securityEventKeys } from './use-security-events';

export interface SplitPreviewTx {
  uuid: string;
  date: string;
  type: string;
  accountName: string | null;
  sharesOld: number;
  sharesNew: number;
}

export interface SplitPreviewQuote {
  date: string;
  valueOld: number;
  valueNew: number;
}

export interface SplitPreviewResponse {
  transactions: SplitPreviewTx[];
  quotes: SplitPreviewQuote[];
  counts: { transactions: number; quotes: number };
  warnings: string[];
}

export interface SplitApplyResponse {
  applied: { transactions: number; quotes: number };
  eventId: number;
}

export interface SplitRequestBody {
  securityId: string;
  exDate: string;
  newShares: number;
  oldShares: number;
  changeTransactions: boolean;
  changeHistoricalQuotes: boolean;
}

// useScopedApi rewrites a leading /api/ into /api/p/<portfolioId>/ — the URLs
// below must therefore NOT carry the portfolio segment themselves.
function splitUrl(securityId: string, suffix = ''): string {
  return `/api/securities/${securityId}/split${suffix}`;
}

export function useStockSplitPreview(): UseMutationResult<
  SplitPreviewResponse,
  Error,
  SplitRequestBody
> {
  const api = useScopedApi();
  return useMutation({
    mutationFn: ({ securityId, ...body }: SplitRequestBody) =>
      api.fetch<SplitPreviewResponse>(splitUrl(securityId, '/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    // The wizard renders preview failures inline next to the ratio fields.
    meta: { suppressGlobalErrorToast: true },
  });
}

export function useApplyStockSplit(): UseMutationResult<
  SplitApplyResponse,
  Error,
  SplitRequestBody
> {
  const api = useScopedApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ securityId, ...body }: SplitRequestBody) =>
      api.fetch<SplitApplyResponse>(splitUrl(securityId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      // A split restates share counts and every historical quote, so holdings,
      // transactions, prices, performance and the security detail all move at
      // once. Nothing is deleted here, so a broad prefix invalidation is safe.
      void queryClient.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
      void queryClient.invalidateQueries({
        queryKey: securityEventKeys.list(api.portfolioId, variables.securityId),
      });
    },
  });
}
