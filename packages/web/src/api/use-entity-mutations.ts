// packages/web/src/api/use-entity-mutations.ts
//
// Generic create/update/delete factory for portfolio-scoped REST collections.
// Mirrors the optimistic-delete posture from `useDeleteAccount` on the
// create side: every mutation reconciles the cache atomically so the next
// render — even when the caller navigates immediately and the consumer
// remounts — sees fresh data.
//
// The factory is opt-in. Hooks with bespoke needs (file uploads, cross-key
// fan-out invalidation, special error mapping) keep their own implementation.
// New entity collections that follow the standard shape — list at
// `/api/<entity>`, item at `/api/<entity>/:id`, JSON bodies, parent-prefix
// query keys — should use the factory by default.

import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useScopedApi } from './use-scoped-api';

export type EntityListKey = readonly ['portfolios', string, string];
export type EntityItemKey = readonly ['portfolios', string, string, string];

export function entityListKey(portfolioId: string, entity: string): EntityListKey {
  return ['portfolios', portfolioId, entity] as const;
}

export function entityItemKey(portfolioId: string, entity: string, id: string): EntityItemKey {
  return ['portfolios', portfolioId, entity, id] as const;
}

export interface EntityShape {
  id: string;
}

interface BuildFactoryDeps {
  qc: QueryClient;
  portfolioId: string;
  entity: string;
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
}

interface CreateMutationOptions<TItem, TInput> extends Omit<UseMutationOptions<TItem, Error, TInput>, 'mutationFn'> {
  /** Path under `/api/`. Defaults to entity name. */
  path?: string;
}

interface UpdateMutationVariables<TInput> {
  id: string;
  input: TInput;
}

interface UpdateMutationOptions<TItem, TInput>
  extends Omit<UseMutationOptions<TItem, Error, UpdateMutationVariables<TInput>>, 'mutationFn'> {
  path?: string;
  /** HTTP verb. PATCH by default. */
  method?: 'PATCH' | 'PUT';
}

interface DeleteContext<TItem extends EntityShape> {
  snapshots: Array<readonly [readonly unknown[], TItem[] | undefined]>;
}

interface DeleteMutationOptions<TItem extends EntityShape>
  extends Omit<UseMutationOptions<void, Error, string, DeleteContext<TItem>>, 'mutationFn'> {
  path?: string;
}

/**
 * The setQueryData pre-populate is load-bearing: when the caller navigates
 * inside its own onSuccess, the consumer can unmount on the new URL before
 * the in-flight refetch from invalidateQueries resolves. The pre-populate
 * ensures the new mount reads a cache that already contains the new entity.
 *
 * Returning the invalidate promise (rather than fire-and-forget) makes RQ
 * await it before invoking the call-site `onSuccess`, guaranteeing eventual
 * consistency on the rare path where the optimistic shape diverges from the
 * server's view.
 */
export function buildCreateMutationOptions<TItem extends EntityShape, TInput>(
  deps: BuildFactoryDeps,
  options: CreateMutationOptions<TItem, TInput> = {},
): UseMutationOptions<TItem, Error, TInput> {
  const { qc, portfolioId, entity, fetchJson } = deps;
  const path = options.path ?? entity;
  const listKey = entityListKey(portfolioId, entity);
  const { onSuccess: callerOnSuccess, ...rest } = options;
  return {
    ...rest,
    mutationFn: (input: TInput) =>
      fetchJson<TItem>(`/api/${path}`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async (created, variables, onMutateResult, mutationContext) => {
      qc.setQueryData<TItem[]>(listKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        if (prev.some((item) => item.id === created.id)) return prev;
        return [...prev, created];
      });
      await qc.invalidateQueries({ queryKey: listKey });
      if (callerOnSuccess) await callerOnSuccess(created, variables, onMutateResult, mutationContext);
    },
  };
}

export function buildUpdateMutationOptions<TItem extends EntityShape, TInput>(
  deps: BuildFactoryDeps,
  options: UpdateMutationOptions<TItem, TInput> = {},
): UseMutationOptions<TItem, Error, UpdateMutationVariables<TInput>> {
  const { qc, portfolioId, entity, fetchJson } = deps;
  const path = options.path ?? entity;
  const method = options.method ?? 'PATCH';
  const listKey = entityListKey(portfolioId, entity);
  const { onSuccess: callerOnSuccess, ...rest } = options;
  return {
    ...rest,
    mutationFn: ({ id, input }) =>
      fetchJson<TItem>(`/api/${path}/${id}`, { method, body: JSON.stringify(input) }),
    onSuccess: async (updated, variables, onMutateResult, mutationContext) => {
      qc.setQueryData<TItem[]>(listKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((item) => (item.id === updated.id ? updated : item));
      });
      qc.setQueryData<TItem>(entityItemKey(portfolioId, entity, updated.id), updated);
      await qc.invalidateQueries({ queryKey: listKey });
      if (callerOnSuccess) await callerOnSuccess(updated, variables, onMutateResult, mutationContext);
    },
  };
}

export function buildDeleteMutationOptions<TItem extends EntityShape>(
  deps: BuildFactoryDeps,
  options: DeleteMutationOptions<TItem> = {},
): UseMutationOptions<void, Error, string, DeleteContext<TItem>> {
  const { qc, portfolioId, entity, fetchJson } = deps;
  const path = options.path ?? entity;
  const listKey = entityListKey(portfolioId, entity);
  const { onMutate: callerOnMutate, onError: callerOnError, onSuccess: callerOnSuccess, ...rest } = options;
  return {
    ...rest,
    mutationFn: (id: string) =>
      fetchJson<void>(`/api/${path}/${id}`, { method: 'DELETE' }),
    onMutate: async (id, mutationContext) => {
      await qc.cancelQueries({ queryKey: listKey });
      const snapshots = qc.getQueriesData<TItem[]>({ queryKey: listKey });
      for (const [key, data] of snapshots) {
        if (Array.isArray(data)) {
          qc.setQueryData(key, data.filter((item) => item.id !== id));
        }
      }
      qc.removeQueries({ queryKey: entityItemKey(portfolioId, entity, id) });
      const ctx: DeleteContext<TItem> = { snapshots };
      if (callerOnMutate) await callerOnMutate(id, mutationContext);
      return ctx;
    },
    onError: (err, id, onMutateResult, mutationContext) => {
      if (onMutateResult?.snapshots) {
        for (const [key, data] of onMutateResult.snapshots) {
          qc.setQueryData(key, data);
        }
      }
      if (callerOnError) callerOnError(err, id, onMutateResult, mutationContext);
    },
    onSuccess: async (data, id, onMutateResult, mutationContext) => {
      await qc.invalidateQueries({ queryKey: listKey });
      if (callerOnSuccess) await callerOnSuccess(data, id, onMutateResult, mutationContext);
    },
  };
}

export interface EntityMutationsApi<TItem extends EntityShape, TCreateInput, TUpdateInput> {
  create: UseMutationResult<TItem, Error, TCreateInput>;
  update: UseMutationResult<TItem, Error, UpdateMutationVariables<TUpdateInput>>;
  remove: UseMutationResult<void, Error, string, DeleteContext<TItem>>;
}

export interface UseEntityMutationsOptions<TItem extends EntityShape, TCreateInput, TUpdateInput> {
  entity: string;
  /** Path under `/api/`; defaults to entity. Use when collection segment differs from the cache key. */
  path?: string;
  create?: CreateMutationOptions<TItem, TCreateInput>;
  update?: UpdateMutationOptions<TItem, TUpdateInput>;
  remove?: DeleteMutationOptions<TItem>;
}

export function useEntityMutations<TItem extends EntityShape, TCreateInput = unknown, TUpdateInput = unknown>(
  options: UseEntityMutationsOptions<TItem, TCreateInput, TUpdateInput>,
): EntityMutationsApi<TItem, TCreateInput, TUpdateInput> {
  const api = useScopedApi();
  const qc = useQueryClient();
  const deps: BuildFactoryDeps = {
    qc,
    portfolioId: api.portfolioId,
    entity: options.entity,
    fetchJson: api.fetch,
  };
  const create = useMutation(
    buildCreateMutationOptions<TItem, TCreateInput>(
      deps,
      { path: options.path, ...(options.create ?? {}) },
    ),
  );
  const update = useMutation(
    buildUpdateMutationOptions<TItem, TUpdateInput>(
      deps,
      { path: options.path, ...(options.update ?? {}) },
    ),
  );
  const remove = useMutation(
    buildDeleteMutationOptions<TItem>(
      deps,
      { path: options.path, ...(options.remove ?? {}) },
    ),
  );
  return { create, update, remove };
}
