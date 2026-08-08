import { randomUUID } from 'crypto';
import type { PortfolioEntry, ImportSummary } from '@quovibe/shared';

/**
 * In-process registry for long-running PP-XML imports.
 *
 * Why this exists: converting a large export (hundreds of securities, hundreds
 * of thousands of price rows) takes minutes end-to-end — ppxml2db, then the
 * atomic copy, then `applyBootstrap` on the destination DB. Holding a single
 * HTTP request open for that long is not survivable: every hop between the
 * browser and the process has its own idle-read timeout (a reverse proxy's is
 * commonly 60 s, Node's own socket timeout was 120 s here), and when one of
 * them cuts the connection the server keeps working and completes the import
 * against a socket nobody is reading. The user sees a generic failure while the
 * portfolio is silently created.
 *
 * The fix is to stop tying import completion to connection liveness: the upload
 * request returns as soon as the file is accepted and validated, and the client
 * polls for the outcome. No hop can time out a request that finishes in
 * milliseconds.
 *
 * Single-process by design. The API runs one Node process per deployment and
 * the file lock in `import.service.ts` remains the cross-process guard; this
 * registry is the in-process one, claimed synchronously at accept time so two
 * concurrent uploads cannot both reach the converter.
 */

export type ImportJobState = 'running' | 'done' | 'error';

/**
 * Terminal failure of a job, shaped so the client can rebuild the same
 * `ApiError` it would have received from a synchronous response. `status` is
 * the HTTP status the pre-job route used for this code, preserved so the
 * client's code→message mapping needs no special case.
 *
 * `details` carries only sanitized extras (`maxMb`, the colliding `name`, a
 * user-actionable validation string). Raw server strings — subprocess stderr,
 * filesystem paths, stringified exceptions — never reach it; see
 * `.claude/rules/xml-import.md` for the info-disclosure posture.
 */
export interface ImportJobFailure {
  code: string;
  status: number;
  details?: Record<string, unknown>;
}

export interface ImportJobResult {
  entry: PortfolioEntry;
  summary: ImportSummary;
}

export interface ImportJob {
  id: string;
  state: ImportJobState;
  startedAt: string;
  finishedAt: string | null;
  result: ImportJobResult | null;
  error: ImportJobFailure | null;
}

export interface StartImportJobInput {
  run: () => Promise<ImportJobResult>;
  /** Maps a thrown value to the wire-safe failure shape. */
  mapError: (err: unknown) => ImportJobFailure;
}

/**
 * How long a terminal job stays readable. Long enough that a client which lost
 * its connection mid-import can still collect the outcome after reconnecting,
 * short enough that the map cannot grow without bound across a long uptime.
 */
const JOB_RETENTION_MS = 30 * 60 * 1000; // native-ok

// quovibe:allow-module-state — import jobs outliving their request IS the
// feature; a per-request scope cannot express it. Keyed by an opaque job id
// only the uploader holds, never by portfolio, so it is not the cross-request
// leak ADR-016 targets: the payload is the registry entry + counts the client
// would have received synchronously, and no portfolio DB handle or row data is
// retained. Evicted after JOB_RETENTION_MS.
const jobs = new Map<string, ImportJob>();
// quovibe:allow-module-state — process-wide single-import mutex; holds an id, no data (ADR-016).
let activeJobId: string | null = null;

/** Drops terminal jobs past their retention window. */
function sweep(): void {
  const cutoff = Date.now() - JOB_RETENTION_MS; // native-ok
  for (const [id, job] of jobs) {
    if (job.finishedAt === null) continue;
    if (Date.parse(job.finishedAt) < cutoff) jobs.delete(id);
  }
}

/** True while a job is running. Cleared as soon as the job reaches a terminal state. */
export function hasActiveImportJob(): boolean {
  return activeJobId !== null;
}

/**
 * Id of the running job, if any. Exposed on `GET /api/import/status` so a
 * client that lost its 202 — the upload response itself was cut, after the
 * server had already accepted the file — can re-attach to the import instead of
 * reporting a failure the server disagrees with.
 */
export function getActiveImportJobId(): string | null {
  return activeJobId;
}

export function getImportJob(id: string): ImportJob | undefined {
  sweep();
  return jobs.get(id);
}

/**
 * Registers a job and kicks off `run` without awaiting it. The active-job slot
 * is claimed synchronously — before this function returns — so a second request
 * arriving in the same tick sees `hasActiveImportJob() === true`.
 */
export function startImportJob(input: StartImportJobInput): ImportJob {
  sweep();
  const job: ImportJob = {
    id: randomUUID(),
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(job.id, job);
  activeJobId = job.id;

  const settle = (): void => {
    job.finishedAt = new Date().toISOString();
    if (activeJobId === job.id) activeJobId = null;
  };

  const fail = (err: unknown): void => {
    job.state = 'error';
    // A throwing mapper must not strand the active-job slot — that would wedge
    // every later import behind a permanent 409.
    try {
      job.error = input.mapError(err);
    } catch (mapErr) {
      console.error('[import-job] mapError threw:', mapErr, 'for:', err);
      job.error = { code: 'CONVERSION_FAILED', status: 500 };
    }
    settle();
  };

  // `Promise.resolve().then(run)` rather than `run()` so a runner that throws
  // synchronously lands on the same failure path instead of escaping the caller.
  void Promise.resolve()
    .then(() => input.run())
    .then((result) => {
      job.state = 'done';
      job.result = result;
      settle();
    }, fail);

  return job;
}
