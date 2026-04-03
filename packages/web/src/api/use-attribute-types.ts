import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './fetch';
import type { AttributeTypeItem } from './types';

export function useAttributeTypes() {
  return useQuery({
    queryKey: ['attribute-types', 'security'] as const,
    queryFn: () => apiFetch<AttributeTypeItem[]>('/api/attribute-types'),
    staleTime: 10 * 60 * 1000, // attribute types rarely change
  });
}
