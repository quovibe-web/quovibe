import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { SecurityListItem, SecurityDetailResponse, TestFetchResponse, FetchAllResult, SearchResult, PreviewPricesResponse, PreviewPrice } from './types';
import { taxonomyKeys } from './use-taxonomies';

export const securitiesKeys = {
  all: (includeRetired = false) => ['securities', { includeRetired }] as const,
  detail: (id: string) => ['securities', id] as const,
};

export function useSecurities(includeRetired = false) {
  return useQuery({
    queryKey: securitiesKeys.all(includeRetired),
    queryFn: () =>
      apiFetch<{ data: SecurityListItem[] }>(
        `/api/securities${includeRetired ? '?includeRetired=true' : ''}`
      ).then(r => r.data),
    placeholderData: keepPreviousData,
  });
}

export function useSecurityDetail(id: string) {
  return useQuery({
    queryKey: securitiesKeys.detail(id),
    queryFn: () => apiFetch<SecurityDetailResponse>(`/api/securities/${id}`),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateFeedConfig(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      feed?: string;
      feedUrl?: string;
      pathToDate?: string;
      pathToClose?: string;
      dateFormat?: string;
      factor?: number;
    }) =>
      apiFetch<{ ok: boolean }>(`/api/securities/${id}/feed-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: securitiesKeys.detail(id) }),
  });
}

export function useTestFetchPrices(id: string) {
  return useMutation({
    mutationFn: (body?: {
      feed?: string;
      feedUrl?: string;
      pathToDate?: string;
      pathToClose?: string;
      dateFormat?: string;
      factor?: number;
    }) =>
      apiFetch<TestFetchResponse>(`/api/securities/${id}/prices/test-fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
  });
}

export function useFetchAllPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<FetchAllResult>('/api/prices/fetch-all', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['securities'] });
      qc.invalidateQueries({ queryKey: ['performance'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useFetchPrices(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: 'merge' | 'replace' = 'merge') =>
      apiFetch<{ securityId: string; fetched: number; error?: string }>(
        `/api/securities/${id}/prices/fetch?mode=${mode}`,
        { method: 'PUT' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: securitiesKeys.detail(id) });
      qc.invalidateQueries({ queryKey: ['securities'] });
      qc.invalidateQueries({ queryKey: ['performance'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useCreateSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ id: string }>('/api/securities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['securities'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['performance'] });
      qc.invalidateQueries({ queryKey: ['holdings'] });
    },
  });
}

export function useUpdateSecurity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Record<string, unknown>>(`/api/securities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: securitiesKeys.detail(id) });
      qc.invalidateQueries({ queryKey: ['securities'] });
    },
  });
}

export function useUpdateAttributes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attributes: Array<{ typeId: string; value: string }>) =>
      apiFetch<{ ok: boolean }>(`/api/securities/${id}/attributes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: securitiesKeys.detail(id) }),
  });
}

export function useUpdateTaxonomy(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignments: Array<{ categoryId: string; taxonomyId: string; weight: number | null }>) =>
      apiFetch<{ ok: boolean }>(`/api/securities/${id}/taxonomy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: securitiesKeys.detail(id) });
      qc.invalidateQueries({ queryKey: taxonomyKeys.all });
      qc.invalidateQueries({ queryKey: ['rebalancing'] });
      qc.invalidateQueries({ queryKey: ['reports', 'assetAllocation'] });
    },
  });
}

export function useSecuritySearch(query: string) {
  return useQuery({
    queryKey: ['securities', 'search', query] as const,
    queryFn: () => apiFetch<SearchResult[]>(`/api/securities/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes — search results don't change fast
    placeholderData: keepPreviousData,
  });
}

export function usePreviewPrices(ticker: string | null, startDate?: string) {
  return useQuery({
    queryKey: ['securities', 'preview', ticker, startDate] as const,
    queryFn: () =>
      apiFetch<PreviewPricesResponse>('/api/securities/preview-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, startDate }),
      }),
    enabled: !!ticker,
    staleTime: 10 * 60 * 1000, // 10 minutes — price data for preview is stable
    placeholderData: keepPreviousData,
  });
}


export function useImportPrices(securityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prices: PreviewPrice[]) =>
      apiFetch<{ ok: boolean; count: number }>(`/api/securities/${securityId}/prices/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: securitiesKeys.detail(securityId) }),
  });
}

export class SecurityHasTransactionsError extends Error {
  constructor(public readonly count: number) {
    super('security_has_transactions');
  }
}

export function useDeleteSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/securities/${id}`, { method: 'DELETE' });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({ count: 0 }));
        throw new SecurityHasTransactionsError(body.count ?? 0);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['securities'] }),
  });
}
