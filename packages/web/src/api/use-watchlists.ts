import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';

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
  all: ['watchlists'] as const,
};

export function useWatchlists() {
  return useQuery({
    queryKey: watchlistKeys.all,
    queryFn: () => apiFetch<Watchlist[]>('/api/watchlists'),
  });
}

export function useCreateWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      apiFetch<Watchlist>('/api/watchlists', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}

export function useUpdateWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string }) =>
      apiFetch(`/api/watchlists/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}

export function useDeleteWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/watchlists/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}

export function useDuplicateWatchlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<Watchlist>(`/api/watchlists/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}

export function useAddWatchlistSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, securityId }: { watchlistId: number; securityId: string }) =>
      apiFetch(`/api/watchlists/${watchlistId}/securities`, {
        method: 'POST',
        body: JSON.stringify({ securityId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}

export function useRemoveWatchlistSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, securityId }: { watchlistId: number; securityId: string }) =>
      apiFetch(`/api/watchlists/${watchlistId}/securities/${securityId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}

export function useReorderWatchlists() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      apiFetch('/api/watchlists/reorder', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}

export function useReorderWatchlistSecurities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, securityIds }: { watchlistId: number; securityIds: string[] }) =>
      apiFetch(`/api/watchlists/${watchlistId}/securities/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ securityIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: watchlistKeys.all }),
  });
}
