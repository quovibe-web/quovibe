// packages/web/src/api/use-fx-rates.ts
//
// React Query hooks for the FX-rates surface introduced in Plan Task 15.
// Wraps GET / POST / PATCH / DELETE on `/api/p/:pid/fx-rates*` plus the
// multipart ECB CSV bulk import. Mutations broad-invalidate the portfolio
// prefix because every downstream calculation (TTWROR, IRR, MVE,
// statement of assets, performance chart, …) folds FX rates into its
// output.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import { toApiError } from './fetch';

// ─── Types ────────────────────────────────────────────────────────────

export interface FxPairSummary {
  from: string;
  to: string;
  count: number;
  minDate: string;
  maxDate: string;
}

export type FxRateSource = 'ECB' | 'MANUAL' | 'IMPORT';

export interface FxRateRow {
  date: string;
  rate: string;
  source: FxRateSource;
}

export interface FxImportResult {
  inserted: number;
  skipped: number;
}

// ─── Query keys ───────────────────────────────────────────────────────

export const fxRateKeys = {
  pairs: (pid: string) => ['portfolios', pid, 'fx-rates'] as const,
  forPair: (pid: string, from: string, to: string) =>
    ['portfolios', pid, 'fx-rates', from, to] as const,
};

// ─── Queries ──────────────────────────────────────────────────────────

export function useFxPairs() {
  const api = useScopedApi();
  return useQuery({
    queryKey: fxRateKeys.pairs(api.portfolioId),
    queryFn: () => api.fetch<{ pairs: FxPairSummary[] }>('/api/fx-rates'),
  });
}

export function useFxRatesForPair(from: string | null, to: string | null) {
  const api = useScopedApi();
  return useQuery({
    queryKey: fxRateKeys.forPair(api.portfolioId, from ?? '', to ?? ''),
    queryFn: () =>
      api.fetch<FxRateRow[]>(`/api/fx-rates/${from}/${to}`),
    enabled: Boolean(from && to),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────

export function useCreateFxRate() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string; date: string; rate: string }) =>
      api.fetch<FxRateRow & { from: string; to: string }>('/api/fx-rates', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      // FX changes ripple into TTWROR / IRR / MVE / statement / chart;
      // broad-invalidate the portfolio prefix and let React Query refetch
      // the observers that are mounted right now.
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

export function useUpdateFxRate() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string; date: string; rate: string }) =>
      api.fetch<FxRateRow & { from: string; to: string }>(
        `/api/fx-rates/${input.from}/${input.to}/${input.date}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ rate: input.rate }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

export function useDeleteFxRate() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string; date: string }) =>
      api.fetch<void>(
        `/api/fx-rates/${input.from}/${input.to}/${input.date}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

export function useImportEcbCsv() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<FxImportResult> => {
      // Multipart upload — bypass apiFetch's JSON Content-Type and let the
      // browser set the multipart boundary itself. Mirrors the established
      // pattern in `use-csv-import.ts`.
      const formData = new FormData();
      formData.append('file', file);
      const url = api.scopedUrl('/api/fx-rates/import-csv');
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw await toApiError(res);
      return res.json() as Promise<FxImportResult>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}
