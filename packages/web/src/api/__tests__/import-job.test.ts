import { describe, it, expect, vi } from 'vitest';
import { awaitImportJob, type ImportJobBody } from '../import-job';
import { ApiError } from '../fetch';

// The conversion is detached from the upload request precisely so that a slow
// import cannot be cut by an idle-read timeout. These cases pin the behaviours
// that make that safe: keep waiting while the job runs, rebuild the server's
// error faithfully, ride out transient poll failures, and give up only on
// genuinely terminal conditions.

const noSleep = (): Promise<void> => Promise.resolve();

function running(): ImportJobBody {
  return { id: 'j1', state: 'running', startedAt: '2026-08-08T00:00:00Z', finishedAt: null };
}

describe('awaitImportJob', () => {
  it('keeps polling while the job is running and resolves with its result', async () => {
    const responses: ImportJobBody[] = [
      running(),
      running(),
      {
        id: 'j1',
        state: 'done',
        startedAt: '2026-08-08T00:00:00Z',
        finishedAt: '2026-08-08T00:03:00Z',
        result: { entry: { id: 'p1' }, summary: { accounts: 1, securities: 2, transactions: 3 } },
      },
    ];
    const fetchJob = vi.fn(() => Promise.resolve(responses.shift()!));

    const result = await awaitImportJob<{ entry: { id: string } }>('j1', {
      fetchJob,
      sleep: noSleep,
    });

    expect(fetchJob).toHaveBeenCalledTimes(3);
    expect(result.entry.id).toBe('p1');
  });

  it("rethrows the job's failure as an ApiError carrying its code and status", async () => {
    const fetchJob = vi.fn(() =>
      Promise.resolve<ImportJobBody>({
        id: 'j1',
        state: 'error',
        startedAt: '2026-08-08T00:00:00Z',
        finishedAt: '2026-08-08T00:01:00Z',
        error: { code: 'DUPLICATE_NAME', status: 409, details: { name: 'Portfolio' } },
      }),
    );

    const err = await awaitImportJob('j1', { fetchJob, sleep: noSleep }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('DUPLICATE_NAME');
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).details?.['name']).toBe('Portfolio');
  });

  it('rides out transient poll failures without failing the import', async () => {
    let call = 0;
    const fetchJob = vi.fn(() => {
      call += 1;
      if (call <= 3) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve<ImportJobBody>({
        id: 'j1',
        state: 'done',
        startedAt: '2026-08-08T00:00:00Z',
        finishedAt: '2026-08-08T00:01:00Z',
        result: { ok: true },
      });
    });

    const result = await awaitImportJob<{ ok: boolean }>('j1', { fetchJob, sleep: noSleep });

    expect(result.ok).toBe(true);
    expect(fetchJob).toHaveBeenCalledTimes(4);
  });

  it('gives up once poll failures stop being transient', async () => {
    const fetchJob = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    await expect(awaitImportJob('j1', { fetchJob, sleep: noSleep })).rejects.toThrow('Failed to fetch');
    // Bounded: it must not retry forever against a server that is gone.
    expect(fetchJob).toHaveBeenCalledTimes(10);
  });

  it('stops immediately on 404 — a job the server forgot cannot be recovered by retrying', async () => {
    const fetchJob = vi.fn(() => Promise.reject(new ApiError(404, 'JOB_NOT_FOUND', {})));

    const err = await awaitImportJob('j1', { fetchJob, sleep: noSleep }).catch((e: unknown) => e);

    expect((err as ApiError).code).toBe('JOB_NOT_FOUND');
    expect(fetchJob).toHaveBeenCalledTimes(1);
  });

  it('surfaces IMPORT_TIMEOUT when the job outlives the deadline', async () => {
    let clock = 0;
    const fetchJob = vi.fn(() => Promise.resolve(running()));

    const err = await awaitImportJob('j1', {
      fetchJob,
      sleep: () => { clock += 1000; return Promise.resolve(); },
      now: () => clock,
      timeoutMs: 3000,
    }).catch((e: unknown) => e);

    expect((err as ApiError).code).toBe('IMPORT_TIMEOUT');
    expect((err as ApiError).status).toBe(504);
  });
});
