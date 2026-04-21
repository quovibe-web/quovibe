// packages/web/src/api/__tests__/query-client-error.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MutationCache } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '../fetch';

// sonner is mocked at module level
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
// stub i18n so i18n.t(...) returns a deterministic string in the generic-fallback branch.
// For `errors:server.<CODE>` lookups: return a translated string when the code is known,
// otherwise return the key itself (i18next's default miss behavior) so the handler's
// fallback branch is exercised.
vi.mock('@/i18n', () => ({
  default: {
    t: vi.fn((key: string, opts?: Record<string, unknown>) => {
      const KNOWN: Record<string, string> = {
        'server.security_has_transactions':
          'Cannot delete — {{count}} transactions linked',
        'server.INVALID_INPUT': 'Invalid input. Check the fields.',
        'server.Validation error': 'Invalid input. Check the fields.',
        'server.INVALID_FORMAT': 'The XML is not a Portfolio Performance export.',
        'mutation.genericFailure': 'GENERIC_FAIL_STUB',
      };
      const template = KNOWN[key];
      if (!template) return key;
      return Object.entries(opts ?? {}).reduce(
        (s, [k, v]) => s.replace(`{{${k}}}`, String(v)),
        template,
      );
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

    await new Promise(r => setTimeout(r, 20));
    expect(toast.error).not.toHaveBeenCalled();
  });

  test('queryClient exposes the configured MutationCache', async () => {
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();
    expect(cache).toBeInstanceOf(MutationCache);
  });

  test('ApiError with known code is translated via errors:server.<CODE>', async () => {
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();

    const mutation = cache.build(client, {
      mutationFn: async () => {
        throw new ApiError(409, 'security_has_transactions', { count: 15 });
      },
    });
    await mutation.execute(undefined as unknown as never).catch(() => {});

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'Cannot delete — 15 transactions linked',
    );
  });

  test('ApiError with 400 INVALID_INPUT is translated', async () => {
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();

    const mutation = cache.build(client, {
      mutationFn: async () => { throw new ApiError(400, 'INVALID_INPUT'); },
    });
    await mutation.execute(undefined as unknown as never).catch(() => {});

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'Invalid input. Check the fields.',
    );
  });

  test('ApiError with server-emitted "Validation error" key is translated', async () => {
    // The Express error handler emits `{error: "Validation error"}` for ZodErrors,
    // so the human-readable string itself is the lookup key. Regression guard for
    // the taxonomy allocation route (BUG-77/89).
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();

    const mutation = cache.build(client, {
      mutationFn: async () => { throw new ApiError(400, 'Validation error'); },
    });
    await mutation.execute(undefined as unknown as never).catch(() => {});

    expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'Invalid input. Check the fields.',
    );
  });

  test('ApiError with unknown code falls through to raw code in dev', async () => {
    // import.meta.env.DEV is true under vitest by default.
    const client = await freshlyImportedQueryClient();
    const cache = client.getMutationCache();

    const mutation = cache.build(client, {
      mutationFn: async () => { throw new ApiError(500, 'UNDOCUMENTED_CODE'); },
    });
    await mutation.execute(undefined as unknown as never).catch(() => {});

    expect((toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'UNDOCUMENTED_CODE',
    );
  });
});
