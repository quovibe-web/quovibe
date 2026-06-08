import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { ManualPriceInput } from '@quovibe/shared';

export interface RawPriceRow {
  date: string;
  value: string;
  open: string | null;
  high: string | null;
  low: string | null;
  volume: number | null;
}

export interface DeriveResult {
  written: number;
  skipped: number;
}

export function manualPricesKey(portfolioId: string, securityId: string): readonly unknown[] {
  return ['portfolios', portfolioId, 'securities', securityId, 'prices', 'raw'];
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

function useInvalidatePrices(api: ReturnType<typeof useScopedApi>) {
  const qc = useQueryClient();
  return () => {
    // A manual price edit ripples into the raw table, the chart + effective
    // latest price, the securities-list price column, and the price-derived
    // perf cards on this page. Invalidate the whole portfolio subtree so none
    // is left stale; refetchType defaults to 'active', so only mounted queries
    // refetch now (off-page dashboard/holdings just go stale until next visit).
    qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
  };
}

export function useRawPrices(securityId: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: manualPricesKey(api.portfolioId, securityId),
    queryFn: () =>
      api.fetch<{ prices: RawPriceRow[] }>(`/api/securities/${securityId}/prices`),
  });
}

export function useCreatePrice(securityId: string) {
  const api = useScopedApi();
  const invalidate = useInvalidatePrices(api);
  return useMutation({
    mutationFn: (input: ManualPriceInput) =>
      api.fetch<{ ok: true }>(`/api/securities/${securityId}/prices`, jsonInit('POST', input)),
    onSuccess: invalidate,
  });
}

export function useEditPrice(securityId: string) {
  const api = useScopedApi();
  const invalidate = useInvalidatePrices(api);
  return useMutation({
    mutationFn: ({ oldDate, input }: { oldDate: string; input: ManualPriceInput }) =>
      api.fetch<{ ok: true }>(
        `/api/securities/${securityId}/prices/${oldDate}`,
        jsonInit('PUT', input),
      ),
    onSuccess: invalidate,
  });
}

export function useDeletePrice(securityId: string) {
  const api = useScopedApi();
  const invalidate = useInvalidatePrices(api);
  return useMutation({
    mutationFn: (date: string) =>
      api.fetch<{ ok: true }>(
        `/api/securities/${securityId}/prices/${date}`,
        jsonInit('DELETE'),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteAllPrices(securityId: string) {
  const api = useScopedApi();
  const invalidate = useInvalidatePrices(api);
  return useMutation({
    mutationFn: () =>
      api.fetch<{ ok: true }>(
        `/api/securities/${securityId}/prices`,
        jsonInit('DELETE', {}),
      ),
    onSuccess: invalidate,
  });
}

export function useDerivePrices(securityId: string) {
  const api = useScopedApi();
  const invalidate = useInvalidatePrices(api);
  return useMutation({
    mutationFn: () =>
      api.fetch<DeriveResult>(
        `/api/securities/${securityId}/prices/derive`,
        jsonInit('POST'),
      ),
    onSuccess: invalidate,
  });
}
