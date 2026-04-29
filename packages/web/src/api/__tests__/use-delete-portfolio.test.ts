// packages/web/src/api/__tests__/use-delete-portfolio.test.ts
//
// Regression harness for BUG-138: deleting a portfolio refetched child
// queries under ['portfolios', deletedId, *] and produced 6 console-error
// 404 entries. The hook now cancels + removes the deleted prefix in
// onMutate and invalidates only the bare list with exact:true in onSuccess.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

vi.mock('../fetch', () => ({
  apiFetch: vi.fn(async () => undefined),
  toApiError: vi.fn(async () => new Error('mocked')),
}));

let deletePortfolioMutationOptions: typeof import('../use-portfolios').deletePortfolioMutationOptions;

beforeEach(async () => {
  vi.resetModules();
  ({ deletePortfolioMutationOptions } = await import('../use-portfolios'));
});

function buildMutation(qc: QueryClient) {
  return qc.getMutationCache().build(qc, deletePortfolioMutationOptions(qc));
}

describe('useDeletePortfolio (BUG-138)', () => {
  test('onMutate cancels and removes queries under the deleted-id prefix', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cancelSpy = vi.spyOn(qc, 'cancelQueries');
    const removeSpy = vi.spyOn(qc, 'removeQueries');

    const m = buildMutation(qc);
    await m.execute('deleted-id-1');

    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: ['portfolios', 'deleted-id-1'] });
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['portfolios', 'deleted-id-1'] });
  });

  test('onSuccess invalidates only the bare ["portfolios"] list with exact:true', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const m = buildMutation(qc);
    await m.execute('deleted-id-2');

    const calls = invalidateSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: ['portfolios'], exact: true });
    for (const filter of calls) {
      const key = filter?.queryKey as readonly unknown[] | undefined;
      const exact = (filter as { exact?: boolean })?.exact;
      if (key && key.length === 1 && key[0] === 'portfolios') {
        expect(exact).toBe(true);
      }
    }
  });

  test('pre-seeded child query under the deleted prefix is removed before DELETE resolves', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['portfolios', 'deleted-id-3', 'taxonomies'], [{ id: 't1' }]);
    expect(qc.getQueryData(['portfolios', 'deleted-id-3', 'taxonomies'])).toBeDefined();

    const m = buildMutation(qc);
    await m.execute('deleted-id-3');

    expect(qc.getQueryData(['portfolios', 'deleted-id-3', 'taxonomies'])).toBeUndefined();
  });
});
