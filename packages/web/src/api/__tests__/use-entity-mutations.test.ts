// packages/web/src/api/__tests__/use-entity-mutations.test.ts
//
// Coverage for the create/update/delete factory in `use-entity-mutations.ts`.
// Pins the create-side cache pre-populate (setQueryData so a post-create
// navigate that remounts the consumer reads fresh data) and the delete-side
// optimistic remove + snapshot rollback + item-key eviction.
//
// Tests build mutations from options against a real QueryClient — no React
// renderer required, mirroring the use-delete-portfolio.test.ts pattern.

import { describe, test, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  buildCreateMutationOptions,
  buildUpdateMutationOptions,
  buildDeleteMutationOptions,
  entityListKey,
  entityItemKey,
} from '../use-entity-mutations';

interface Item { id: string; name: string }

type FetchJson = <T>(url: string, init?: RequestInit) => Promise<T>;

function buildDeps(qc: QueryClient, fetchJson: FetchJson) {
  return { qc, portfolioId: 'pid-1', entity: 'widgets', fetchJson };
}

function fetchReturning<R>(value: R) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => value);
  return fn as unknown as FetchJson & typeof fn;
}

function fetchRejecting(error: Error) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => { throw error; });
  return fn as unknown as FetchJson & typeof fn;
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('buildCreateMutationOptions', () => {
  test('pre-populates the list cache via setQueryData on success', async () => {
    const qc = newClient();
    const listKey = entityListKey('pid-1', 'widgets');
    qc.setQueryData<Item[]>(listKey, [{ id: 'a', name: 'A' }]);

    const fetchJson = fetchReturning<Item>({ id: 'b', name: 'B' });
    const opts = buildCreateMutationOptions<Item, { name: string }>(buildDeps(qc, fetchJson));

    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ name: 'B' });

    expect(qc.getQueryData<Item[]>(listKey)).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });

  test('does not duplicate when server returns an id already present in cache', async () => {
    const qc = newClient();
    const listKey = entityListKey('pid-1', 'widgets');
    qc.setQueryData<Item[]>(listKey, [{ id: 'a', name: 'A' }]);

    const fetchJson = fetchReturning<Item>({ id: 'a', name: 'A-stale' });
    const opts = buildCreateMutationOptions<Item, { name: string }>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ name: 'A-stale' });

    const list = qc.getQueryData<Item[]>(listKey);
    expect(list).toHaveLength(1);
    expect(list?.[0].id).toBe('a');
  });

  test('skips setQueryData when the list cache is empty (no observer subscribed yet)', async () => {
    const qc = newClient();
    const listKey = entityListKey('pid-1', 'widgets');

    const fetchJson = fetchReturning<Item>({ id: 'b', name: 'B' });
    const opts = buildCreateMutationOptions<Item, { name: string }>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ name: 'B' });

    expect(qc.getQueryData<Item[]>(listKey)).toBeUndefined();
  });

  test('awaits invalidateQueries before resolving (so call-site navigate waits)', async () => {
    const qc = newClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const fetchJson = fetchReturning<Item>({ id: 'b', name: 'B' });
    const callerOnSuccess = vi.fn();
    const opts = buildCreateMutationOptions<Item, { name: string }>(
      buildDeps(qc, fetchJson),
      { onSuccess: callerOnSuccess },
    );
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ name: 'B' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: entityListKey('pid-1', 'widgets') });
    expect(callerOnSuccess).toHaveBeenCalledTimes(1);
    expect(invalidateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      callerOnSuccess.mock.invocationCallOrder[0],
    );
  });

  test('POST URL uses entity name by default', async () => {
    const qc = newClient();
    const fetchJson = fetchReturning<Item>({ id: 'b', name: 'B' });
    const opts = buildCreateMutationOptions<Item, { name: string }>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ name: 'B' });

    expect(fetchJson).toHaveBeenCalledWith('/api/widgets', {
      method: 'POST',
      body: JSON.stringify({ name: 'B' }),
    });
  });
});

describe('buildUpdateMutationOptions', () => {
  test('updates the list cache and item cache atomically', async () => {
    const qc = newClient();
    const listKey = entityListKey('pid-1', 'widgets');
    const itemKey = entityItemKey('pid-1', 'widgets', 'a');
    qc.setQueryData<Item[]>(listKey, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);

    const fetchJson = fetchReturning<Item>({ id: 'a', name: 'A2' });
    const opts = buildUpdateMutationOptions<Item, { name: string }>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ id: 'a', input: { name: 'A2' } });

    expect(qc.getQueryData<Item[]>(listKey)).toEqual([
      { id: 'a', name: 'A2' },
      { id: 'b', name: 'B' },
    ]);
    expect(qc.getQueryData<Item>(itemKey)).toEqual({ id: 'a', name: 'A2' });
  });

  test('uses PATCH by default', async () => {
    const qc = newClient();
    const fetchJson = fetchReturning<Item>({ id: 'a', name: 'A2' });
    const opts = buildUpdateMutationOptions<Item, { name: string }>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ id: 'a', input: { name: 'A2' } });

    expect(fetchJson).toHaveBeenCalledWith('/api/widgets/a', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'A2' }),
    });
  });

  test('honours method: PUT override', async () => {
    const qc = newClient();
    const fetchJson = fetchReturning<Item>({ id: 'a', name: 'A2' });
    const opts = buildUpdateMutationOptions<Item, { name: string }>(
      buildDeps(qc, fetchJson),
      { method: 'PUT' },
    );
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute({ id: 'a', input: { name: 'A2' } });

    expect(fetchJson).toHaveBeenCalledWith('/api/widgets/a', {
      method: 'PUT',
      body: JSON.stringify({ name: 'A2' }),
    });
  });
});

describe('buildDeleteMutationOptions', () => {
  test('onMutate optimistically removes the deleted id from every list variant', async () => {
    const qc = newClient();
    const listKey = entityListKey('pid-1', 'widgets');
    qc.setQueryData<Item[]>(listKey, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);

    const fetchJson = fetchReturning<void>(undefined as void);
    const opts = buildDeleteMutationOptions<Item>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute('b');

    expect(qc.getQueryData<Item[]>(listKey)).toEqual([{ id: 'a', name: 'A' }]);
  });

  test('removes the deleted item-key prefix so detail observers do not refetch a 404', async () => {
    const qc = newClient();
    const listKey = entityListKey('pid-1', 'widgets');
    const itemKey = entityItemKey('pid-1', 'widgets', 'b');
    qc.setQueryData<Item[]>(listKey, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    qc.setQueryData<Item>(itemKey, { id: 'b', name: 'B' });

    const fetchJson = fetchReturning<void>(undefined as void);
    const opts = buildDeleteMutationOptions<Item>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await m.execute('b');

    expect(qc.getQueryData<Item>(itemKey)).toBeUndefined();
  });

  test('rolls back optimistic state on server error', async () => {
    const qc = newClient();
    const listKey = entityListKey('pid-1', 'widgets');
    const initial: Item[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    qc.setQueryData<Item[]>(listKey, initial);

    const fetchJson = fetchRejecting(new Error('boom'));
    const opts = buildDeleteMutationOptions<Item>(buildDeps(qc, fetchJson));
    const m = qc.getMutationCache().build(qc, opts);
    await expect(m.execute('b')).rejects.toThrow('boom');

    expect(qc.getQueryData<Item[]>(listKey)).toEqual(initial);
  });
});
