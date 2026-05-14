import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import { taxonomyKeys } from './use-taxonomies';

export function useCreateTaxonomy() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; template?: string }) =>
      api.fetch<{ id: string; name: string }>('/api/taxonomies', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all(api.portfolioId) }),
  });
}

export function useDeleteTaxonomy() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taxonomyId: string) =>
      api.fetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all(api.portfolioId) }),
  });
}

export function useReorderTaxonomy() {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taxonomyId, direction }: { taxonomyId: string; direction: 'up' | 'down' }) =>
      api.fetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ direction }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all(api.portfolioId) }),
  });
}

export function useCreateCategory(taxonomyId: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; parentId: string; color?: string }) =>
      api.fetch<{ id: string }>(`/api/taxonomies/${taxonomyId}/categories`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
    },
  });
}

export function useUpdateCategory(taxonomyId: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ catId, ...data }: { catId: string; name?: string; color?: string; parentId?: string; rank?: number }) =>
      api.fetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/categories/${catId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
    },
  });
}

export function useDeleteCategory(taxonomyId: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ catId, renormalize }: { catId: string; renormalize?: boolean }) => {
      const qs = renormalize ? '?renormalize=true' : '';
      return api.fetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/categories/${catId}${qs}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'rebalancing', taxonomyId] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities'] });
    },
  });
}

export function useReorderCategory(taxonomyId: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ catId, direction }: { catId: string; direction: 'up' | 'down' }) =>
      api.fetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/categories/${catId}/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ direction }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
    },
  });
}

export function useCreateAssignment(taxonomyId: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { itemId: string; itemType: string; categoryId: string; weight?: number }) =>
      api.fetch<{ id: number }>(`/api/taxonomies/${taxonomyId}/assignments`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'rebalancing', taxonomyId] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities'] });
    },
  });
}

export function useUpdateAssignment(taxonomyId: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, ...data }: { assignmentId: number; categoryId?: string; weight?: number }) =>
      api.fetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/assignments/${assignmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'rebalancing', taxonomyId] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities'] });
    },
  });
}

export function useDeleteAssignment(taxonomyId: string) {
  const api = useScopedApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: number) =>
      api.fetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/assignments/${assignmentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId) });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'rebalancing', taxonomyId] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities'] });
    },
  });
}
