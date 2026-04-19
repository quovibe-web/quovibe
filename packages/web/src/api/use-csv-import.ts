// packages/web/src/api/use-csv-import.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type {
  CsvImportConfig, CsvParseResult, TradePreviewResult,
  TradeExecuteResult, PriceExecuteResult,
} from '@quovibe/shared';

// ─── Query Keys ───────────────────────────────────

export const csvImportKeys = {
  configs: (pid: string) => ['portfolios', pid, 'csv-import', 'configs'] as const,
};

// ─── Config hooks ─────────────────────────────────

export function useCsvConfigs() {
  const api = useScopedApi();
  return useQuery({
    queryKey: csvImportKeys.configs(api.portfolioId),
    queryFn: () => api.fetch<CsvImportConfig[]>('/api/csv-import/configs'),
  });
}

export function useCreateCsvConfig() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CsvImportConfig>) =>
      api.fetch<CsvImportConfig>('/api/csv-import/configs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: csvImportKeys.configs(api.portfolioId) }),
  });
}

export function useUpdateCsvConfig() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<CsvImportConfig> & { id: string }) =>
      api.fetch<CsvImportConfig>(`/api/csv-import/configs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: csvImportKeys.configs(api.portfolioId) }),
  });
}

export function useDeleteCsvConfig() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.fetch<void>(`/api/csv-import/configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: csvImportKeys.configs(api.portfolioId) }),
  });
}

// ─── Trade Import hooks ───────────────────────────

export function useParseCsvTrades() {
  const api = useScopedApi();
  return useMutation({
    mutationFn: async (file: File): Promise<CsvParseResult> => {
      const formData = new FormData();
      formData.append('file', file);
      const url = api.scopedUrl('/api/csv-import/trades/parse');
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
  });
}

export function usePreviewCsvTrades() {
  const api = useScopedApi();
  return useMutation({
    mutationFn: (data: {
      tempFileId: string;
      columnMapping: Record<string, number>;
      dateFormat: string;
      decimalSeparator: string;
      thousandSeparator: string;
      targetSecuritiesAccountId: string;
    }) =>
      api.fetch<TradePreviewResult>('/api/csv-import/trades/preview', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useExecuteCsvTrades() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      tempFileId: string;
      config: {
        columnMapping: Record<string, number>;
        dateFormat: string;
        decimalSeparator: string;
        thousandSeparator: string;
      };
      targetSecuritiesAccountId: string;
      securityMapping: Record<string, string>;
      newSecurities: Array<{ name: string; isin?: string; ticker?: string; currency: string }>;
      excludedRows: number[];
    }) =>
      api.fetch<TradeExecuteResult>('/api/csv-import/trades/execute', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // Invalidate this portfolio's cached data
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

// ─── Price Import hooks ───────────────────────────

export function useParseCsvPrices() {
  const api = useScopedApi();
  return useMutation({
    mutationFn: async (file: File): Promise<CsvParseResult> => {
      const formData = new FormData();
      formData.append('file', file);
      const url = api.scopedUrl('/api/csv-import/prices/parse');
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
  });
}

export function useExecuteCsvPrices() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      tempFileId: string;
      securityId: string;
      columnMapping: { date: number; close: number; high?: number; low?: number; volume?: number };
      dateFormat: string;
      decimalSeparator: string;
      thousandSeparator: string;
      skipLines: number;
    }) =>
      api.fetch<PriceExecuteResult>('/api/csv-import/prices/execute', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}
