// packages/web/src/api/use-csv-import.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type {
  CsvImportConfig, CsvParseResult, TradePreviewResult,
  TradeExecuteResult, PriceExecuteResult,
} from '@quovibe/shared';

// ─── Query Keys ───────────────────────────────────

export const csvImportKeys = {
  configs: ['csv-import', 'configs'] as const,
};

// ─── Config hooks ─────────────────────────────────

export function useCsvConfigs() {
  return useQuery({
    queryKey: csvImportKeys.configs,
    queryFn: () => apiFetch<CsvImportConfig[]>('/api/import/csv/configs'),
  });
}

export function useCreateCsvConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CsvImportConfig>) =>
      apiFetch<CsvImportConfig>('/api/import/csv/configs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: csvImportKeys.configs }),
  });
}

export function useUpdateCsvConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<CsvImportConfig> & { id: string }) =>
      apiFetch<CsvImportConfig>(`/api/import/csv/configs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: csvImportKeys.configs }),
  });
}

export function useDeleteCsvConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/import/csv/configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: csvImportKeys.configs }),
  });
}

// ─── Trade Import hooks ───────────────────────────

export function useParseCsvTrades() {
  return useMutation({
    mutationFn: async (file: File): Promise<CsvParseResult> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/import/csv/trades/parse', {
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
  return useMutation({
    mutationFn: (data: {
      tempFileId: string;
      columnMapping: Record<string, number>;
      dateFormat: string;
      decimalSeparator: string;
      thousandSeparator: string;
      targetPortfolioId: string;
    }) =>
      apiFetch<TradePreviewResult>('/api/import/csv/trades/preview', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useExecuteCsvTrades() {
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
      targetPortfolioId: string;
      securityMapping: Record<string, string>;
      newSecurities: Array<{ name: string; isin?: string; ticker?: string; currency: string }>;
      excludedRows: number[];
    }) =>
      apiFetch<TradeExecuteResult>('/api/import/csv/trades/execute', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries();  // Invalidate all — transactions, accounts, securities may change
    },
  });
}

// ─── Price Import hooks ───────────────────────────

export function useParseCsvPrices() {
  return useMutation({
    mutationFn: async (file: File): Promise<CsvParseResult> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/import/csv/prices/parse', {
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
      apiFetch<PriceExecuteResult>('/api/import/csv/prices/execute', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries();  // Prices, performance, charts may all need refresh
    },
  });
}
