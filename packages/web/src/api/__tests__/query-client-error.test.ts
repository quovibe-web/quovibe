// packages/web/src/api/__tests__/query-client-error.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';

// sonner is mocked at module level
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
// stub i18n so i18n.t(...) returns a deterministic string in the generic-fallback branch
vi.mock('@/i18n', () => ({
  default: {
    t: vi.fn((key: string) => {
      if (key === 'mutation.genericFailure') return 'GENERIC_FAIL_STUB';
      return key;
    }),
  },
}));

/**
 * Re-imports query-client.ts after each reset so the module is re-evaluated against
 * the freshly-mocked sonner/i18n modules. Returns the singleton queryClient configured
 * by that file in production.
 */
async function freshlyImportedQueryClient() {
  vi.resetModules();
  const mod = await import('../query-client');
  return mod.queryClient;
}

/**
 * Runs a mutation through the real TanStack Query pipeline using cache.build() +
 * mutation.execute(). This exercises the same code path as useMutation in production
 * (mutation.ts:276-282 calls mutationCache.config.onError with the Mutation instance
 * as arg 4), without requiring @testing-library/react or jsdom.
 */
describe('MutationCache global error toast', () => {
  beforeEach(() => {
    (toast.error as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  test('fires toast.error with the server error message on a rejected mutation', async () => {
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();
    const err = new Error('Name must be between 1 and 255 characters');

    const mutation = cache.build(client, {
      mutationFn: async () => { throw err; },
    });
    await mutation.execute(undefined as unknown as never).catch(() => {});

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'Name must be between 1 and 255 characters',
    );
  });

  test('falls back to the i18n generic key when error has no .message', async () => {
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();

    const mutation = cache.build(client, {
      mutationFn: async () => { throw {}; /* non-Error object */ },
    });
    await mutation.execute(undefined as unknown as never).catch(() => {});

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('GENERIC_FAIL_STUB');
  });

  test('opts out via meta.suppressGlobalErrorToast — no toast fires', async () => {
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();

    const mutation = cache.build(client, {
      mutationFn: async () => { throw new Error('kaboom'); },
      meta: { suppressGlobalErrorToast: true },
    });
    await mutation.execute(undefined as unknown as never).catch(() => {});

    // Give the event loop one more tick to confirm no toast is coming.
    await new Promise(r => setTimeout(r, 20));
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('queryClient exposes the configured MutationCache', async () => {
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();
    expect(cache).toBeInstanceOf(MutationCache);
  });
});
