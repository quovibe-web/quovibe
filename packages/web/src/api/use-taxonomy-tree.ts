import { useQuery } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { TaxonomyTreeResponse } from './types';
import { taxonomyKeys } from './use-taxonomies';

export function useTaxonomyTree(taxonomyId: string | undefined) {
  const api = useScopedApi();
  return useQuery({
    queryKey: taxonomyKeys.tree(api.portfolioId, taxonomyId!),
    queryFn: () => api.fetch<TaxonomyTreeResponse>(`/api/taxonomies/${taxonomyId}`),
    enabled: !!taxonomyId,
    staleTime: 5 * 60 * 1000,
  });
}
