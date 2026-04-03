import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import { taxonomyKeys } from './use-taxonomies';

export function useCreateTaxonomy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; template?: string }) =>
      apiFetch<{ id: string; name: string }>('/api/taxonomies', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all }),
  });
}

export function useDeleteTaxonomy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taxonomyId: string) =>
      apiFetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all }),
  });
}

export function useReorderTaxonomy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taxonomyId, direction }: { taxonomyId: string; direction: 'up' | 'down' }) =>
      apiFetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ direction }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxonomyKeys.all }),
  });
}

export function useCreateCategory(taxonomyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; parentId: string; color?: string }) =>
      apiFetch<{ id: string }>(`/api/taxonomies/${taxonomyId}/categories`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(taxonomyId) });
      qc.invalidateQueries({ queryKey: ['reports', 'assetAllocation'] });
    },
  });
}

export function useUpdateCategory(taxonomyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ catId, ...data }: { catId: string; name?: string; color?: string; parentId?: string; rank?: number }) =>
      apiFetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/categories/${catId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(taxonomyId) });
      qc.invalidateQueries({ queryKey: ['reports', 'assetAllocation'] });
    },
  });
}

export function useDeleteCategory(taxonomyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (catId: string) =>
      apiFetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/categories/${catId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(taxonomyId) });
      qc.invalidateQueries({ queryKey: ['reports', 'assetAllocation'] });
    },
  });
}

export function useCreateAssignment(taxonomyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { itemId: string; itemType: string; categoryId: string; weight?: number }) =>
      apiFetch<{ id: number }>(`/api/taxonomies/${taxonomyId}/assignments`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(taxonomyId) });
      qc.invalidateQueries({ queryKey: ['rebalancing', taxonomyId] });
      qc.invalidateQueries({ queryKey: ['reports', 'assetAllocation'] });
      qc.invalidateQueries({ queryKey: ['securities'] });
    },
  });
}

export function useUpdateAssignment(taxonomyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, ...data }: { assignmentId: number; categoryId?: string; weight?: number }) =>
      apiFetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/assignments/${assignmentId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(taxonomyId) });
      qc.invalidateQueries({ queryKey: ['rebalancing', taxonomyId] });
      qc.invalidateQueries({ queryKey: ['reports', 'assetAllocation'] });
      qc.invalidateQueries({ queryKey: ['securities'] });
    },
  });
}

export function useDeleteAssignment(taxonomyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: number) =>
      apiFetch<{ ok: boolean }>(`/api/taxonomies/${taxonomyId}/assignments/${assignmentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taxonomyKeys.tree(taxonomyId) });
      qc.invalidateQueries({ queryKey: ['rebalancing', taxonomyId] });
      qc.invalidateQueries({ queryKey: ['reports', 'assetAllocation'] });
      qc.invalidateQueries({ queryKey: ['securities'] });
    },
  });
}
