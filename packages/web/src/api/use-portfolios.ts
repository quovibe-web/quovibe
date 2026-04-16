import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';

export interface PortfolioRegistryEntry {
  id: string;
  name: string;
  kind: 'real' | 'demo';
  source: 'fresh' | 'demo' | 'import-pp-xml' | 'import-quovibe-db';
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface PortfolioRegistryResponse {
  initialized: boolean;
  defaultPortfolioId: string | null;
  portfolios: PortfolioRegistryEntry[];
}

export const portfoliosKeys = {
  list: () => ['portfolios'] as const,
};

export function usePortfolioRegistry() {
  return useQuery({
    queryKey: portfoliosKeys.list(),
    queryFn: () => apiFetch<PortfolioRegistryResponse>('/api/portfolios'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreatePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { source: 'fresh' | 'demo' | 'import-quovibe-db'; name?: string; file?: File }) => {
      if (body.source === 'import-quovibe-db') {
        const fd = new FormData();
        if (body.file) fd.append('file', body.file);
        return fetch('/api/portfolios', { method: 'POST', body: fd }).then(async (r) => {
          if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
          return r.json();
        });
      }
      return apiFetch<{ entry: PortfolioRegistryEntry; alreadyExisted?: boolean }>(
        '/api/portfolios',
        { method: 'POST', body: JSON.stringify({ source: body.source, ...(body.name && { name: body.name }) }) },
      );
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: portfoliosKeys.list() }); },
  });
}

export function useRenamePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<PortfolioRegistryEntry>(`/api/portfolios/${id}`, {
        method: 'PATCH', body: JSON.stringify({ name }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: portfoliosKeys.list() }); },
  });
}

export function useDeletePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/portfolios/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: portfoliosKeys.list() }); },
  });
}

export function useTouchPortfolio() {
  // Fire-and-forget; no invalidation needed — registry updates on the next natural refetch.
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PortfolioRegistryEntry>(`/api/portfolios/${id}`, {
        method: 'PATCH', body: JSON.stringify({ lastOpenedAt: new Date().toISOString() }),
      }),
  });
}
