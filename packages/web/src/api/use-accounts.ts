import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from './fetch';
import type { AccountListItem, TransactionListItem, AccountHoldingsResponse } from './types';

export const accountsKeys = {
  all: (includeRetired = false) => ['accounts', { includeRetired }] as const,
  detail: (id: string) => ['accounts', id] as const,
  transactions: (id: string) => ['accounts', id, 'transactions'] as const,
  holdings: (id: string) => ['accounts', id, 'holdings'] as const,
};

export function useAccounts(includeRetired = false) {
  return useQuery({
    queryKey: accountsKeys.all(includeRetired),
    queryFn: () =>
      apiFetch<AccountListItem[]>(
        `/api/accounts${includeRetired ? '?includeRetired=true' : ''}`
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAccountDetail(id: string) {
  return useQuery({
    queryKey: accountsKeys.detail(id),
    queryFn: () => apiFetch<AccountListItem>(`/api/accounts/${id}`),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useAccountTransactions(id: string, page = 1, limit = 25) {
  return useQuery({
    queryKey: [...accountsKeys.transactions(id), page, limit],
    queryFn: () =>
      apiFetch<{ data: TransactionListItem[]; page: number; limit: number; total: number }>(
        `/api/accounts/${id}/transactions?page=${page}&limit=${limit}`,
      ),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; type: string; currency?: string; referenceAccountId?: string }) =>
      apiFetch<AccountListItem>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKeys.all() });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: accountsKeys.all() });
      qc.invalidateQueries({ queryKey: accountsKeys.all(true) });
      qc.invalidateQueries({ queryKey: accountsKeys.detail(id) });
    },
  });
}

export function useDeactivateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<AccountListItem>(`/api/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isRetired: true }),
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: accountsKeys.all() });
      qc.invalidateQueries({ queryKey: accountsKeys.all(true) });
      qc.invalidateQueries({ queryKey: accountsKeys.detail(id) });
    },
  });
}

export function useUpdateAccountLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, logoUrl }: { id: string; logoUrl: string | null }) =>
      apiFetch(`/api/accounts/${id}/logo`, { method: 'PUT', body: JSON.stringify({ logoUrl }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err: Error) => {
      console.error('[useUpdateAccountLogo] failed:', err.message);
      toast.error(`Logo upload failed: ${err.message}`);
    },
  });
}

export function useReactivateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<AccountListItem>(`/api/accounts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isRetired: false }),
      }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: accountsKeys.all() });
      qc.invalidateQueries({ queryKey: accountsKeys.all(true) });
      qc.invalidateQueries({ queryKey: accountsKeys.detail(id) });
    },
  });
}

export function useAccountHoldings(accountId: string) {
  return useQuery({
    queryKey: accountsKeys.holdings(accountId),
    queryFn: () => apiFetch<AccountHoldingsResponse>(`/api/accounts/${accountId}/holdings`),
    enabled: !!accountId,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string } }) =>
      apiFetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: accountsKeys.all() });
      queryClient.invalidateQueries({ queryKey: accountsKeys.all(true) });
      queryClient.invalidateQueries({ queryKey: accountsKeys.detail(variables.id) });
    },
  });
}
