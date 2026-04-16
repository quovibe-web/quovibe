import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useScopedApi } from './use-scoped-api';
import type { AccountListItem, TransactionListItem, AccountHoldingsResponse } from './types';

export const accountsKeys = {
  all: (pid: string, includeRetired = false) =>
    ['portfolios', pid, 'accounts', { includeRetired }] as const,
  detail: (pid: string, id: string) =>
    ['portfolios', pid, 'accounts', id] as const,
  transactions: (pid: string, id: string) =>
    ['portfolios', pid, 'accounts', id, 'transactions'] as const,
  holdings: (pid: string, id: string) =>
    ['portfolios', pid, 'accounts', id, 'holdings'] as const,
};

export function useAccounts(includeRetired = false) {
  const api = useScopedApi();
  return useQuery({
    queryKey: accountsKeys.all(api.portfolioId, includeRetired),
    queryFn: () =>
      api.fetch<AccountListItem[]>(
        `/api/accounts${includeRetired ? '?includeRetired=true' : ''}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAccountDetail(id: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: accountsKeys.detail(api.portfolioId, id),
    queryFn: () => api.fetch<AccountListItem>(`/api/accounts/${id}`),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useAccountTransactions(id: string, page = 1, limit = 25) {
  const api = useScopedApi();
  return useQuery({
    queryKey: [...accountsKeys.transactions(api.portfolioId, id), page, limit],
    queryFn: () =>
      api.fetch<{ data: TransactionListItem[]; page: number; limit: number; total: number }>(
        `/api/accounts/${id}/transactions?page=${page}&limit=${limit}`,
      ),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useCreateAccount() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; type: string; currency?: string; referenceAccountId?: string }) =>
      api.fetch<AccountListItem>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'accounts'] });
    },
  });
}

export function useDeleteAccount() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.fetch<void>(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'accounts'] });
    },
  });
}

export function useDeactivateAccount() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.fetch<AccountListItem>(`/api/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isRetired: true }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'accounts'] });
    },
  });
}

export function useUpdateAccountLogo() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, logoUrl }: { id: string; logoUrl: string | null }) =>
      api.fetch(`/api/accounts/${id}/logo`, { method: 'PUT', body: JSON.stringify({ logoUrl }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'accounts'] });
    },
    onError: (err: Error) => {
      console.error('[useUpdateAccountLogo] failed:', err.message);
      toast.error(`Logo upload failed: ${err.message}`);
    },
  });
}

export function useReactivateAccount() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.fetch<AccountListItem>(`/api/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isRetired: false }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'accounts'] });
    },
  });
}

export function useAccountHoldings(accountId: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: accountsKeys.holdings(api.portfolioId, accountId),
    queryFn: () => api.fetch<AccountHoldingsResponse>(`/api/accounts/${accountId}/holdings`),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateAccount() {
  const api = useScopedApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string } }) =>
      api.fetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'accounts'] });
    },
  });
}
