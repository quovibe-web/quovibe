import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, QueryClient } from '@tanstack/react-query';
import type { FreshPortfolioInput, ImportSummary } from '@quovibe/shared';
import { apiFetch, toApiError } from './fetch';

// useCreatePortfolio accepts these four shapes; only the JSON ones go through
// apiFetch — the file branches use FormData against POST /api/portfolios or
// /api/import/xml respectively. The fresh shape mirrors the wire schema in
// @quovibe/shared (Phase 2 createPortfolioSchema) so the dialog can pass its
// react-hook-form state through unchanged.
type CreatePortfolioBody =
  | FreshPortfolioInput
  | { source: 'demo' }
  | { source: 'import-pp-xml'; file: File; name?: string }
  | { source: 'import-quovibe-db'; file: File; name?: string };

export interface PortfolioRegistryEntry {
  id: string;
  name: string;
  kind: 'real' | 'demo';
  source: 'fresh' | 'demo' | 'import-pp-xml' | 'import-quovibe-db';
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface CreatePortfolioResult {
  entry: PortfolioRegistryEntry;
  summary?: ImportSummary;
  alreadyExisted?: boolean;
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
    mutationFn: async (body: CreatePortfolioBody): Promise<CreatePortfolioResult> => {
      if (body.source === 'import-quovibe-db') {
        const fd = new FormData();
        fd.append('file', body.file);
        if (body.name) fd.append('name', body.name);
        const r = await fetch('/api/portfolios', { method: 'POST', body: fd });
        if (!r.ok) throw await toApiError(r);
        return r.json();
      }
      if (body.source === 'import-pp-xml') {
        const fd = new FormData();
        fd.append('file', body.file);
        if (body.name) fd.append('name', body.name);
        const r = await fetch('/api/import/xml', { method: 'POST', body: fd });
        if (!r.ok) throw await toApiError(r);
        return r.json();
      }
      // body is FreshPortfolioInput or { source: 'demo' } — JSON pass-through.
      return apiFetch<CreatePortfolioResult>(
        '/api/portfolios',
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: portfoliosKeys.list() });
    },
    // BUG-70: without this, a single 409 DUPLICATE_NAME response produced two
    // toasts — the component's `onError` toast plus the MutationCache global
    // fallback (which only knows how to print `error.message`, leaking the
    // raw server code). Suppressing the global toast puts the component in
    // sole charge of the error surface, so it can render a translated message.
    meta: { suppressGlobalErrorToast: true },
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

/**
 * Mutation config for deleting a portfolio. Exported so unit tests can build
 * the mutation against a real QueryClient via cache.build(...) without
 * needing @testing-library/react. The hook below is the production wrapper.
 */
export function deletePortfolioMutationOptions(
  qc: QueryClient,
): UseMutationOptions<void, Error, string> {
  return {
    mutationFn: (id) => apiFetch<void>(`/api/portfolios/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['portfolios', id] });
      qc.removeQueries({ queryKey: ['portfolios', id] });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfoliosKeys.list(), exact: true });
    },
    meta: { suppressGlobalErrorToast: true },
  };
}

export function useDeletePortfolio() {
  const qc = useQueryClient();
  return useMutation(deletePortfolioMutationOptions(qc));
}

/**
 * Pure helper — applies the server-returned `lastOpenedAt` to the registry
 * cache snapshot. Returns the prev reference unchanged when the touched id
 * is absent or its timestamp already matches; React Query dedupes by
 * reference, so this avoids cascading re-renders across every consumer of
 * `usePortfolioRegistry()` on a no-op touch.
 */
export function applyTouchToRegistry(
  prev: PortfolioRegistryResponse | undefined,
  updated: PortfolioRegistryEntry,
): PortfolioRegistryResponse | undefined {
  if (!prev) return prev;
  const idx = prev.portfolios.findIndex((p) => p.id === updated.id);
  if (idx === -1) return prev;
  if (prev.portfolios[idx].lastOpenedAt === updated.lastOpenedAt) return prev;
  const portfolios = prev.portfolios.slice();
  portfolios[idx] = { ...portfolios[idx], lastOpenedAt: updated.lastOpenedAt };
  return { ...prev, portfolios };
}

export function useTouchPortfolio() {
  // Optimistic registry update on success is load-bearing: PortfolioLayout's
  // `shouldTouchPortfolio` check reads `lastOpenedAt` from the same cache, so
  // without an immediate update every sub-page mount within the throttle
  // window would still see the OLD timestamp and refire the touch (the
  // registry's natural refetch is gated by a 5-min staleTime).
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PortfolioRegistryEntry>(`/api/portfolios/${id}`, {
        method: 'PATCH', body: JSON.stringify({ lastOpenedAt: new Date().toISOString() }),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<PortfolioRegistryResponse>(
        portfoliosKeys.list(),
        (prev) => applyTouchToRegistry(prev, updated),
      );
    },
  });
}
