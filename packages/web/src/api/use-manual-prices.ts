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

function useInvalidatePrices(api: ReturnType<typeof useScopedApi>, securityId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: manualPricesKey(api.portfolioId, securityId) });
    // Refresh chart + latest-price column on SecurityDetail.
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
  const invalidate = useInvalidatePrices(api, securityId);
  return useMutation({
    mutationFn: (input: ManualPriceInput) =>
      api.fetch<{ ok: true }>(`/api/securities/${securityId}/prices`, jsonInit('POST', input)),
    onSuccess: invalidate,
  });
}

export function useEditPrice(securityId: string) {
  const api = useScopedApi();
  const invalidate = useInvalidatePrices(api, securityId);
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
  const invalidate = useInvalidatePrices(api, securityId);
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
  const invalidate = useInvalidatePrices(api, securityId);
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
  const invalidate = useInvalidatePrices(api, securityId);
  return useMutation({
    mutationFn: () =>
      api.fetch<DeriveResult>(
        `/api/securities/${securityId}/prices/derive`,
        jsonInit('POST'),
      ),
    onSuccess: invalidate,
  });
}
