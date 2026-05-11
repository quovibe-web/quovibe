import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { TaxonomyListItem } from './types';

export const taxonomyKeys = {
  all: (pid: string) => ['portfolios', pid, 'taxonomies'] as const,
  tree: (pid: string, id: string) => ['portfolios', pid, 'taxonomies', 'tree', id] as const,
};

export function useTaxonomies() {
  const api = useScopedApi();
  return useQuery({
    queryKey: taxonomyKeys.all(api.portfolioId),
    queryFn: () => api.fetch<TaxonomyListItem[]>('/api/taxonomies'),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
