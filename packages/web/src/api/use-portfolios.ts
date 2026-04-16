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
    mutationFn: async (body: {
      source: 'fresh' | 'demo' | 'import-quovibe-db' | 'import-pp-xml';
      name?: string;
      file?: File;
    }): Promise<{ entry: PortfolioRegistryEntry; alreadyExisted?: boolean }> => {
      if (body.source === 'import-quovibe-db') {
        const fd = new FormData();
        if (body.file) fd.append('file', body.file);
        const r = await fetch('/api/portfolios', { method: 'POST', body: fd });
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      }
      if (body.source === 'import-pp-xml') {
        if (!body.file) throw new Error('FILE_REQUIRED');
        const fd = new FormData();
        fd.append('file', body.file);
        if (body.name) fd.append('name', body.name);
        const r = await fetch('/api/import/xml', { method: 'POST', body: fd });
        const raw = await r.json().catch(() => ({ error: 'UNKNOWN' }));
        if (!r.ok) throw new Error(raw.error ?? `HTTP ${r.status}`);
        // POST /api/import/xml returns a flat shape `{ status, id, name, accounts, securities }`.
        // Normalize to the same `{ entry }` envelope the other branches return so callers can
        // read `r.entry.id` uniformly.
        const lifted = raw as {
          status: 'success';
          id: string;
          name: string;
          accounts: number;
          securities: number;
        };
        return {
          entry: {
            id: lifted.id,
            name: lifted.name,
            kind: 'real',
            source: 'import-pp-xml',
            createdAt: new Date().toISOString(),
            lastOpenedAt: null,
          },
        };
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
