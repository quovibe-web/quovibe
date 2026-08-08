import { ApiError } from './fetch';

/**
 * Client half of the asynchronous PP-XML import.
 *
 * `POST /api/import/xml` no longer carries the outcome — it answers 202
 * `{ jobId }` as soon as the upload is accepted, and the conversion runs
 * detached on the server. That is deliberate: a large export takes minutes to
 * convert, and any hop between browser and process (a reverse proxy's idle-read
 * timeout is commonly 60 s) will cut a request held open that long. The server
 * then finishes the import against a dead socket — portfolio created, user told
 * it failed.
 *
 * `awaitImportJob` turns the job back into the promise the mutation used to
 * get, including rebuilding the `ApiError` the synchronous route used to throw,
 * so every call site downstream (code→message mapping, inline alerts) is
 * unchanged.
 */

export interface ImportJobBody {
  id: string;
  state: 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt: string | null;
  result?: unknown;
  error?: { code: string; status: number; details?: Record<string, unknown> };
}

export interface AwaitImportJobOptions<T> {
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Injected in tests; defaults to a real fetch of the job endpoint. */
  fetchJob?: (jobId: string) => Promise<ImportJobBody>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Narrows the job's untyped `result` to the caller's shape. */
  parseResult?: (result: unknown) => T;
}

const DEFAULT_POLL_INTERVAL_MS = 1500;
/**
 * Ceiling on how long we keep polling. Sized for the worst realistic case — a
 * multi-hundred-security export converting on slow storage — rather than for a
 * typical one, because the cost of giving up too early is exactly the bug this
 * whole mechanism exists to fix.
 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
/**
 * Consecutive transport failures tolerated before giving up. The server blocks
 * its event loop while SQLite works, so individual polls can fail or stall
 * without the import being in trouble.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 10;

async function defaultFetchJob(jobId: string): Promise<ImportJobBody> {
  const res = await fetch(`/api/import/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body['error'] === 'string' ? body['error'] : `HTTP_${res.status}`;
    throw new ApiError(res.status, code, {});
  }
  return (await res.json()) as ImportJobBody;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until the job settles. Resolves with the job's result on success;
 * throws an `ApiError` carrying the job's own code and would-be status on
 * failure, so call sites keep matching on `err.code` exactly as before.
 */
export async function awaitImportJob<T>(
  jobId: string,
  options: AwaitImportJobOptions<T> = {},
): Promise<T> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchJob = options.fetchJob ?? defaultFetchJob;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const parseResult = options.parseResult ?? ((result: unknown) => result as T);

  const deadline = now() + timeoutMs;
  let consecutiveFailures = 0;

  for (;;) {
    if (now() > deadline) {
      throw new ApiError(504, 'IMPORT_TIMEOUT', {});
    }

    let job: ImportJobBody;
    try {
      job = await fetchJob(jobId);
      consecutiveFailures = 0;
    } catch (err) {
      // A job the server no longer knows about is terminal — it restarted, or
      // the retention window closed. Retrying cannot recover it.
      if (err instanceof ApiError && err.status === 404) throw err;
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw err;
      await sleep(pollIntervalMs);
      continue;
    }

    if (job.state === 'done') return parseResult(job.result);
    if (job.state === 'error') {
      const failure = job.error;
      throw new ApiError(
        failure?.status ?? 500,
        failure?.code ?? 'CONVERSION_FAILED',
        failure?.details ?? {},
      );
    }

    await sleep(pollIntervalMs);
  }
}
