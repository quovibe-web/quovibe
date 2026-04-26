import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import { toApiError } from './fetch';
import type { SecurityListItem, SecurityDetailResponse, TestFetchResponse, FetchAllResult, FxFetchSummary, SearchResult, PreviewPricesResponse, PreviewPrice } from './types';
import { taxonomyKeys } from './use-taxonomies';

export const securitiesKeys = {
  all: (pid: string, includeRetired = false) =>
    ['portfolios', pid, 'securities', { includeRetired }] as const,
  detail: (pid: string, id: string) =>
    ['portfolios', pid, 'securities', id] as const,
  search: (pid: string, query: string) =>
    ['portfolios', pid, 'securities', 'search', query] as const,
  preview: (pid: string, ticker: string | null, startDate?: string) =>
    ['portfolios', pid, 'securities', 'preview', ticker, startDate] as const,
};

export function useSecurities(includeRetired = false) {
  const api = useScopedApi();
  return useQuery({
    queryKey: securitiesKeys.all(api.portfolioId, includeRetired),
    queryFn: () =>
      api.fetch<{ data: SecurityListItem[] }>(
        `/api/securities${includeRetired ? '?includeRetired=true' : ''}`,
      ).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
}

export function useSecurityDetail(id: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: securitiesKeys.detail(api.portfolioId, id),
    queryFn: () => api.fetch<SecurityDetailResponse>(`/api/securities/${id}`),
    enabled: !!id,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useUpdateFeedConfig(id: string) {
  const api = useScopedApi();
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
      api.fetch<{ ok: boolean }>(`/api/securities/${id}/feed-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: securitiesKeys.detail(api.portfolioId, id) }),
  });
}

export function useTestFetchPrices(id: string) {
  const api = useScopedApi();
  return useMutation({
    mutationFn: (body?: {
      feed?: string;
      feedUrl?: string;
      pathToDate?: string;
      pathToClose?: string;
      dateFormat?: string;
      factor?: number;
    }) =>
      api.fetch<TestFetchResponse>(`/api/securities/${id}/prices/test-fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
  });
}

export function useFetchAllPrices() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.fetch<FetchAllResult>('/api/prices/fetch-all', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

export function useFetchAllExchangeRates() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.fetch<FxFetchSummary>('/api/prices/fetch-exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

export function useFetchPrices(id: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: 'merge' | 'replace' = 'merge') =>
      api.fetch<{ securityId: string; fetched: number; error?: string }>(
        `/api/securities/${id}/prices/fetch?mode=${mode}`,
        { method: 'PUT' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

export function useCreateSecurity() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.fetch<{ id: string }>('/api/securities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId] });
    },
  });
}

export function useUpdateSecurity(id: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.fetch<Record<string, unknown>>(`/api/securities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities'] });
    },
  });
}

export function useUpdateAttributes(id: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attributes: Array<{ typeId: string; value: string }>) =>
      api.fetch<{ ok: boolean }>(`/api/securities/${id}/attributes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: securitiesKeys.detail(api.portfolioId, id) }),
  });
}

export function useUpdateTaxonomy(id: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignments: Array<{ categoryId: string; taxonomyId: string; weight: number | null }>) =>
      api.fetch<{ ok: boolean }>(`/api/securities/${id}/taxonomy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: securitiesKeys.detail(api.portfolioId, id) });
      qc.invalidateQueries({ queryKey: taxonomyKeys.all(api.portfolioId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'rebalancing'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
    },
  });
}

export function useSecuritySearch(query: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: securitiesKeys.search(api.portfolioId, query),
    queryFn: () => api.fetch<SearchResult[]>(`/api/securities/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes — search results don't change fast
    placeholderData: keepPreviousData,
  });
}

export function usePreviewPrices(ticker: string | null, startDate?: string) {
  const api = useScopedApi();
  return useQuery({
    queryKey: securitiesKeys.preview(api.portfolioId, ticker, startDate),
    queryFn: () =>
      api.fetch<PreviewPricesResponse>('/api/securities/preview-prices', {
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
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prices: PreviewPrice[]) =>
      api.fetch<{ ok: boolean; count: number }>(`/api/securities/${securityId}/prices/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: securitiesKeys.detail(api.portfolioId, securityId) }),
  });
}

export function useDeleteSecurity() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const url = api.scopedUrl(`/api/securities/${id}`);
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw await toApiError(res);
      return res.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities'] }),
  });
}
