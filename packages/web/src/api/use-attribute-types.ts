import { useQuery } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import type { AttributeTypeItem } from './types';

export function useAttributeTypes() {
  const api = useScopedApi();
  return useQuery({
    queryKey: ['portfolios', api.portfolioId, 'attribute-types', 'security'] as const,
    queryFn: () => api.fetch<AttributeTypeItem[]>('/api/attribute-types'),
    staleTime: 10 * 60 * 1000, // attribute types rarely change
  });
}
