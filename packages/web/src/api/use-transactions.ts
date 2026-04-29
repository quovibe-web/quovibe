import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { TransactionDetail } from './types';

export const transactionKeys = {
  all: (pid: string) => ['portfolios', pid, 'transactions'] as const,
  firstDate: (pid: string) => ['portfolios', pid, 'transactions', 'first-date'] as const,
  detail: (pid: string, id: string) =>
    ['portfolios', pid, 'transactions', 'detail', id] as const,
  filtered: (pid: string, filters: Record<string, unknown>, page: number, pageSize: number) =>
    ['portfolios', pid, 'transactions', filters, page, pageSize] as const,
};

interface TransactionPage {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
}

export function useFirstTransactionDate() {
  const api = useScopedApi();
  return useQuery({
    queryKey: transactionKeys.firstDate(api.portfolioId),
    queryFn: () => api.fetch<{ date: string | null }>('/api/transactions/first-date'),
    staleTime: Infinity,
  });
}

export function useTransactionDetail(id: string | null) {
  const api = useScopedApi();
  return useQuery({
    queryKey: transactionKeys.detail(api.portfolioId, id ?? ''),
    queryFn: () => api.fetch<TransactionDetail>(`/api/transactions/${id}`),
    enabled: !!id,
  });
}

export function useTransactions(
  filters?: Record<string, unknown>,
  page = 1,
  pageSize = 25,
) {
  const api = useScopedApi();
  const queryParams = new URLSearchParams({
    ...(filters as Record<string, string>),
    page: String(page),
    limit: String(pageSize),
  });
  return useQuery({
    queryKey: transactionKeys.filtered(api.portfolioId, filters ?? {}, page, pageSize),
    queryFn: () => api.fetch<TransactionPage>(`/api/transactions?${queryParams}`),
    placeholderData: keepPreviousData,
  });
}

// Imperative one-shot fetch for CSV export. Bypasses pagination via
// `limit=all` so the export covers the full filtered dataset, not just
// the page currently in memory (BUG-60).
export function useExportTransactions() {
  const api = useScopedApi();
  return async (filters?: Record<string, unknown>) => {
    const queryParams = new URLSearchParams({
      ...(filters as Record<string, string>),
      limit: 'all',
    });
    const result = await api.fetch<TransactionPage>(`/api/transactions?${queryParams}`);
    return result.data;
  };
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, pid: string) {
  // Invalidate all portfolio-scoped derived data. A single key prefix catches
  // transactions, securities, accounts, performance, reports, holdings, etc.
  qc.invalidateQueries({ queryKey: ['portfolios', pid] });
}

export function useCreateTransaction() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      api.fetch('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => invalidateAll(qc, api.portfolioId),
  });
}

export function useUpdateTransaction() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      api.fetch(`/api/transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(qc, api.portfolioId),
    meta: { suppressGlobalErrorToast: true },
  });
}

export function useDeleteTransaction() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.fetch(`/api/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc, api.portfolioId),
  });
}
