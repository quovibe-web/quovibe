import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { TaxonomyTreeResponse } from './types';
import { taxonomyKeys } from './use-taxonomies';

export function useTaxonomyTree(taxonomyId: string | undefined) {
  return useQuery({
    queryKey: taxonomyKeys.tree(taxonomyId!),
    queryFn: () => apiFetch<TaxonomyTreeResponse>(`/api/taxonomies/${taxonomyId}`),
    enabled: !!taxonomyId,
    staleTime: 5 * 60 * 1000,
  });
}
