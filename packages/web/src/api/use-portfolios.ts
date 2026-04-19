import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { FreshPortfolioInput } from '@quovibe/shared';
import { apiFetch } from './fetch';

// useCreatePortfolio accepts these four shapes; only the JSON ones go through
// apiFetch — the file branches use FormData against POST /api/portfolios or
// /api/import/xml respectively. The fresh shape mirrors the wire schema in
// @quovibe/shared (Phase 2 createPortfolioSchema) so the dialog can pass its
// react-hook-form state through unchanged.
type CreatePortfolioBody =
  | FreshPortfolioInput
  | { source: 'demo' }
  | { source: 'import-pp-xml'; file: File; name?: string }
  | { source: 'import-quovibe-db'; file: File };

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
    mutationFn: async (
      body: CreatePortfolioBody,
    ): Promise<{ entry: PortfolioRegistryEntry; alreadyExisted?: boolean }> => {
      if (body.source === 'import-quovibe-db') {
        const fd = new FormData();
        fd.append('file', body.file);
        const r = await fetch('/api/portfolios', { method: 'POST', body: fd });
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      }
      if (body.source === 'import-pp-xml') {
        const fd = new FormData();
        fd.append('file', body.file);
        if (body.name) fd.append('name', body.name);
        const r = await fetch('/api/import/xml', { method: 'POST', body: fd });
        const raw = await r.json().catch(() => ({ error: 'UNKNOWN' }));
        if (!r.ok) {
          // Surface the backend's `details` (e.g. Python stack from ppxml2db) in
          // the thrown message so the toast shows something actionable instead of
          // just "CONVERSION_FAILED".
          const code = raw.error ?? `HTTP ${r.status}`;
          const details = typeof raw.details === 'string' && raw.details.length
            ? raw.details.slice(0, 2000)
            : '';
          throw new Error(details ? `${code}: ${details}` : code);
        }
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
      // body is FreshPortfolioInput or { source: 'demo' } — JSON pass-through.
      return apiFetch<{ entry: PortfolioRegistryEntry; alreadyExisted?: boolean }>(
        '/api/portfolios',
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: portfoliosKeys.list() });
    },
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
    meta: { suppressGlobalErrorToast: true },
  });
}

export function useDeletePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/portfolios/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: portfoliosKeys.list() }); },
    meta: { suppressGlobalErrorToast: true },
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
