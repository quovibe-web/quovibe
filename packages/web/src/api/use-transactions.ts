import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import { securitiesKeys } from './use-securities';
import { accountsKeys } from './use-accounts';
import type { TransactionDetail } from './types';

export const transactionKeys = {
  all: ['transactions'] as const,
  firstDate: ['transactions', 'first-date'] as const,
  detail: (id: string) => ['transactions', 'detail', id] as const,
  filtered: (filters: Record<string, unknown>, page: number, pageSize: number) =>
    ['transactions', filters, page, pageSize] as const,
};

interface TransactionPage {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
}

export function useFirstTransactionDate() {
  return useQuery({
    queryKey: transactionKeys.firstDate,
    queryFn: () => apiFetch<{ date: string | null }>('/api/transactions/first-date'),
    staleTime: Infinity,
  });
}

export function useTransactionDetail(id: string | null) {
  return useQuery({
    queryKey: transactionKeys.detail(id ?? ''),
    queryFn: () => apiFetch<TransactionDetail>(`/api/transactions/${id}`),
    enabled: !!id,
  });
}

export function useTransactions(
  filters?: Record<string, unknown>,
  page = 1,
  pageSize = 25,
) {
  const queryParams = new URLSearchParams({
    ...(filters as Record<string, string>),
    page: String(page),
    limit: String(pageSize),
  });
  return useQuery({
    queryKey: transactionKeys.filtered(filters ?? {}, page, pageSize),
    queryFn: () => apiFetch<TransactionPage>(`/api/transactions?${queryParams}`),
    placeholderData: keepPreviousData,
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: transactionKeys.all });
  qc.invalidateQueries({ queryKey: securitiesKeys.all });
  qc.invalidateQueries({ queryKey: accountsKeys.all });
  qc.invalidateQueries({ queryKey: ['performance'] });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: unknown) =>
      apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      apiFetch(`/api/transactions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  });
}
