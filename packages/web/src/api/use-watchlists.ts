import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';

export interface WatchlistSecurity {
  id: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  currency: string;
  latestPrice: number | null;
  latestPriceDate: string | null;
  previousClose: number | null;
  logoUrl: string | null;
}

export interface Watchlist {
  id: number;
  name: string;
  order: number;
  securities: WatchlistSecurity[];
}

export const watchlistKeys = {
  all: (pid: string) => ['portfolios', pid, 'watchlists'] as const,
};

export function useWatchlists() {
  const api = useScopedApi();
  return useQuery({
    queryKey: watchlistKeys.all(api.portfolioId),
    queryFn: () => api.fetch<Watchlist[]>('/api/watchlists'),
  });
}

export function useCreateWatchlist() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      api.fetch<Watchlist>('/api/watchlists', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}

export function useUpdateWatchlist() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string }) =>
      api.fetch(`/api/watchlists/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}

export function useDeleteWatchlist() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.fetch(`/api/watchlists/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}

export function useDuplicateWatchlist() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api.fetch<Watchlist>(`/api/watchlists/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}

export function useAddWatchlistSecurity() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, securityId }: { watchlistId: number; securityId: string }) =>
      api.fetch(`/api/watchlists/${watchlistId}/securities`, {
        method: 'POST',
        body: JSON.stringify({ securityId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}

export function useRemoveWatchlistSecurity() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, securityId }: { watchlistId: number; securityId: string }) =>
      api.fetch(`/api/watchlists/${watchlistId}/securities/${securityId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}

export function useReorderWatchlists() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      api.fetch('/api/watchlists/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}

export function useReorderWatchlistSecurities() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, securityIds }: { watchlistId: number; securityIds: string[] }) =>
      api.fetch(`/api/watchlists/${watchlistId}/securities/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ securityIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all(api.portfolioId) }),
  });
}
