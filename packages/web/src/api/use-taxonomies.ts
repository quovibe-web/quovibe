import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { TaxonomyListItem } from './types';

export const taxonomyKeys = {
  all: ['taxonomies'] as const,
  tree: (id: string) => ['taxonomies', 'tree', id] as const,
};

export function useTaxonomies() {
  return useQuery({
    queryKey: taxonomyKeys.all,
    queryFn: () => apiFetch<TaxonomyListItem[]>('/api/taxonomies'),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
