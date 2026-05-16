import { useQuery } from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';
import { useEntityMutations, entityListKey } from './use-entity-mutations';
import type { AttributeTypeItem } from './types';
import type {
  CreateAttributeTypeInput,
  UpdateAttributeTypeInput,
} from '@quovibe/shared';

// The factory list key for this entity — 3-tuple ['portfolios', pid, 'attribute-types'].
// useAttributeTypes fetches with ?target=Security but keyed under the same prefix so
// factory invalidations (after create/update/delete) trigger a refetch automatically.
const ENTITY = 'attribute-types';

export function useAttributeTypes() {
  const api = useScopedApi();
  return useQuery({
    queryKey: entityListKey(api.portfolioId, ENTITY),
    queryFn: () => api.fetch<AttributeTypeItem[]>('/api/attribute-types?target=Security'),
    staleTime: 10 * 60 * 1000, // attribute types rarely change
  });
}

export function useCreateAttributeType() {
  const { create } = useEntityMutations<AttributeTypeItem, CreateAttributeTypeInput, UpdateAttributeTypeInput>({
    entity: ENTITY,
    create: {},
  });
  return create;
}

export function useUpdateAttributeType() {
  const { update } = useEntityMutations<AttributeTypeItem, CreateAttributeTypeInput, UpdateAttributeTypeInput>({
    entity: ENTITY,
    update: { method: 'PUT' },
  });
  return update;
}
