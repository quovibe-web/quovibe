import { Router, type RequestHandler, type Router as RouterType } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { runImport, isImportInProgress, validateXmlFormat, ImportError } from '../services/import.service';
import { updateAppState, getSettings } from '../services/settings.service';
import { createPortfolio, PortfolioManagerError } from '../services/portfolio-manager';
import {
  startImportJob,
  getImportJob,
  hasActiveImportJob,
  getActiveImportJobId,
  type ImportJobFailure,
  type ImportJobResult,
} from '../services/import-job.service';
import { DATA_DIR, IMPORT_MAX_MB } from '../config';
import { ensureDir } from '../lib/atomic-fs';

// Multer: save uploads to data/tmp (inside DATA_DIR) so boot-recovery's
// sweepStaleTmp reaps orphans after a mid-flight crash. Matches the posture
// of routes/portfolios.ts and ADR-015 §3.15.
const uploadDir = path.join(DATA_DIR, 'tmp');
ensureDir(uploadDir);

const UPLOAD_MAX_BYTES = IMPORT_MAX_MB * 1024 * 1024; // native-ok

const upload = multer({
  // busboy decodes Content-Disposition `filename=` as latin1 by default;
  // browsers send raw UTF-8 bytes, so non-ASCII filenames mojibake (`próbaID`
  // → `prÃ³baID`) on disk and in any surface that echoes file.originalname
  // (display-name fallback, error logs). Switching the charset at the multer
  // config is the class fix — every consumer (filename callback, fileFilter,
  // body fields) sees UTF-8 without per-callsite Buffer round-trips.
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    // The uuid is the collision guard for same-millisecond uploads carrying
    // the same originalname (a `Promise.all` of two identical uploads from
    // DevTools console was the repro vector). Without it, multer overwrites
    // the first file with the second, then the race in the ensuing
    // rename-and-convert pipeline leaks ENOENT+path over the wire.
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}-${file.originalname}`),
  }),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.xml')) {
      cb(new ImportError('INVALID_FILE_FORMAT', 'File must have a .xml extension'));
      return;
    }
    cb(null, true);
  },
});

// Wrap multer so its failures (extension reject, oversize) land as structured
// 400 responses via handleError rather than falling through to the global
// error-handler's 500 branch. Mirrors csv-import.ts `uploadSingle` (BUG-46);
// BUG-09 applies the same posture to the XML surface.
const uploadSingle = (field: string): RequestHandler =>
  (req, res, next) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (!err) { next(); return; }
      if (err instanceof ImportError) { handleError(res, err); return; }
      if (err instanceof multer.MulterError) {
        const mapped = err.code === 'LIMIT_FILE_SIZE'
          ? new ImportError('FILE_TOO_LARGE', `Upload exceeds ${UPLOAD_MAX_BYTES} bytes`)
          : new ImportError('INVALID_FILE_FORMAT', err.message);
        handleError(res, mapped);
        return;
      }
      handleError(res, new ImportError('INVALID_FILE_FORMAT', String((err as Error).message ?? err)));
    });
  };

export const importRouter: RouterType = Router();

/**
 * The conversion pipeline, run detached from the HTTP request that started it.
 * Phase timings are logged unconditionally: the wall-clock split between the
 * ppxml2db subprocess and the destination-DB work is the only way to tell a
 * slow converter from a slow bootstrap in a user's deployment, and neither is
 * reproducible locally.
 */
async function runImportPipeline(xmlPath: string, name: string): Promise<ImportJobResult> {
  const t0 = Date.now(); // native-ok
  // The route validated before handing the path over — see uploadXml.
  const result = await runImport(xmlPath, { skipFormatValidation: true });
  const tConverted = Date.now(); // native-ok

  try {
    const created = await createPortfolio({
      source: 'import-pp-xml',
      name,
      ppxmlTempDbPath: result.tempDbPath,
    });

    // Record the last-import timestamp on the user-level sidecar.
    updateAppState({ lastImport: new Date().toISOString() });

    const tCreated = Date.now(); // native-ok
    console.log(
      `[quovibe] Import completed. New portfolio created: ${created.entry.id} ` +
      `(convert=${tConverted - t0}ms create=${tCreated - tConverted}ms total=${tCreated - t0}ms)`,
    );

    if (!created.summary) {
      // Unreachable via createImportedPpxmlImpl, which always computes one.
      // Guarding rather than asserting keeps the failure a clean job error.
      throw new ImportError('CONVERSION_FAILED', 'Import produced no summary');
    }
    return { entry: created.entry, summary: created.summary };
  } finally {
    // portfolio-manager atomic-COPIES (not moves) the temp DB, and the guard
    // (BUG-92) may throw before the copy runs. Clean up either way so the
    // DUPLICATE_NAME rejection path doesn't orphan the file in os.tmpdir().
    try { fs.unlinkSync(result.tempDbPath); } catch { /* ok */ }
  }
}

/**
 * Wire-safe mapping of a pipeline failure. Mirrors `handleError` exactly — same
 * codes, same statuses, same info-disclosure posture — so a job failure is
 * indistinguishable from the synchronous response the client used to get.
 */
function toJobFailure(err: unknown): ImportJobFailure {
  if (err instanceof ImportError) {
    const status = err.code === 'IMPORT_IN_PROGRESS' ? 409
      : err.code === 'CONVERSION_FAILED' ? 500
      : 400;
    if (err.code === 'FILE_TOO_LARGE') {
      return { code: err.code, status, details: { maxMb: IMPORT_MAX_MB } };
    }
    // CONVERSION_FAILED never carries details (BUG-96 posture): its message
    // path concatenates ppxml2db stderr.
    if (err.code === 'CONVERSION_FAILED') return { code: err.code, status };
    const detail = err.details ?? err.message;
    return { code: err.code, status, ...(detail ? { details: { details: detail } } : {}) };
  }
  if (err instanceof PortfolioManagerError) {
    // BUG-92: duplicate-name collision from the registry guard must map to
    // 409, mirroring POST /api/portfolios. Other PortfolioManagerError codes
    // (INVALID_SOURCE, DEMO_SOURCE_MISSING, …) keep the 400 default.
    const status = err.code === 'DUPLICATE_NAME' ? 409 : 400;
    return {
      code: err.code,
      status,
      ...(err.code === 'DUPLICATE_NAME' && err.conflictingName
        ? { details: { name: err.conflictingName } }
        : {}),
    };
  }
  console.error('[quovibe] Import error:', err);
  return { code: 'CONVERSION_FAILED', status: 500 };
}

// POST /api/import/xml — accept an upload and start a conversion job.
//
// Returns 202 { jobId } once the file has cleared every check that can be made
// without running the converter; the client then polls GET /api/import/jobs/:id.
// Everything up to the 202 is synchronous, so the request completes in
// milliseconds and no idle-read timeout anywhere in the chain can cut it.
//
// The structural validators stay on THIS side of the 202 deliberately: their
// codes (INVALID_XML / ENCRYPTED_FORMAT / INVALID_FORMAT) are documented as
// 400s on this route and are cheap enough to run inline. Only failures that
// require the converter (CONVERSION_FAILED, the ppxml2db user-input
// classifier's INVALID_FORMAT, DUPLICATE_NAME) surface through the job.
const uploadXml: RequestHandler = (req, res) => {
  // In-process guard first (claimed synchronously by startImportJob below),
  // then the cross-process file lock that survives a restart mid-import.
  if (hasActiveImportJob() || isImportInProgress()) {
    // multer has already streamed the upload to disk by the time this handler
    // runs, and the loser of the race never reaches runImport's cleanup — so
    // reap its temp file here or it sits until the next boot sweep.
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* ok */ } }
    res.status(409).json({ error: 'IMPORT_IN_PROGRESS' });
    return;
  }

  if (!req.file) {
    handleError(res, new ImportError('NO_FILE', 'No file received'));
    return;
  }

  // BUG-94: no rename step. multer's fileFilter rejects non-`.xml` extensions
  // (see fileFilter above), so req.file.path already ends in `.xml` and is
  // a valid input for ppxml2db. The previous `req.file.path + '.xml'` rename
  // appended a redundant `.xml` (producing `.xml.xml`) and opened a race
  // window on concurrent same-name uploads: A.rename() succeeds, B.rename()
  // ENOENTs on the source because A moved it — and the raw errno string
  // (including the absolute server path) leaked via handleError's fallback.
  const xmlPath = req.file.path;

  try {
    validateXmlFormat(xmlPath);
  } catch (err) {
    // Rejected before any job exists, so nothing else will reap the upload.
    try { fs.unlinkSync(xmlPath); } catch { /* ok */ }
    handleError(res, err);
    return;
  }

  // Derive a display name: use the provided body.name, else the XML filename stripped.
  const bodyName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const fallback = req.file.originalname.replace(/\.xml$/i, '').slice(0, 100);
  const name = bodyName || fallback || 'Imported Portfolio';

  const job = startImportJob({
    run: () => runImportPipeline(xmlPath, name),
    mapError: toJobFailure,
  });

  res.status(202).json({ jobId: job.id });
};

// GET /api/import/jobs/:jobId — poll a conversion job.
//
// Always 200 for a known job regardless of its state: the HTTP status describes
// the poll, and the job's own outcome (including its would-be status code)
// lives in the body so the client can rebuild the same error it used to get
// synchronously. 404 means the id is unknown or its retention window expired.
const getJob: RequestHandler = (req, res) => {
  const jobId = req.params.jobId;
  const job = typeof jobId === 'string' ? getImportJob(jobId) : undefined;
  if (!job) {
    res.status(404).json({ error: 'JOB_NOT_FOUND' });
    return;
  }
  res.json({
    id: job.id,
    state: job.state,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  });
};

// GET /api/import/status — both import guards + last-import time.
//
// `inProgress` must consult the in-process job registry as well as the
// cross-process file lock, otherwise it under-reports for the entire window
// between the 202 and ppxml2db claiming the lock. `activeJobId` is the
// re-attach handle for a client whose 202 never arrived.
const getStatus: RequestHandler = (_req, res) => {
  const lastImport = getSettings().app.lastImport;
  res.json({
    ready: true,
    inProgress: hasActiveImportJob() || isImportInProgress(),
    activeJobId: getActiveImportJobId(),
    lastImport,
  });
};

// Socket idle timeout for the upload route. It now bounds the UPLOAD only —
// the conversion runs detached in a job — so 120 s is a transfer budget, not a
// conversion budget.
//
// The explicit 'timeout' listeners are load-bearing. Node's http server
// destroys a timed-out socket only when nothing listens for the event
// (`socketOnTimeout` in _http_server), so the previous listener-less
// `setTimeout` calls killed connections with no server-side trace whatsoever —
// the failure was indistinguishable from an upstream proxy cutting the request.
// Listening makes the cut observable and keeps ownership of the response.
importRouter.post('/xml', (req, res, next) => {
  const armed = Date.now(); // native-ok
  const onTimeout = (): void => {
    console.warn(
      `[xml-import] upload socket idle for 120s (${Date.now() - armed}ms since arming) — aborting transfer`, // native-ok
    );
    if (!res.headersSent) res.status(408).json({ error: 'UPLOAD_TIMEOUT' });
    else res.end();
  };
  req.setTimeout(120_000, onTimeout); // native-ok
  res.setTimeout(120_000, onTimeout); // native-ok
  // A client that walks away mid-upload leaves multer's partial temp file
  // behind; boot-recovery's sweepStaleTmp reaps it. Log it so a repeated
  // client-side abort is visible rather than silent.
  res.on('close', () => {
    if (!res.writableEnded) {
      console.warn(`[xml-import] client disconnected after ${Date.now() - armed}ms without a response`); // native-ok
    }
  });
  next();
}, uploadSingle('file'), uploadXml);

importRouter.get('/jobs/:jobId', getJob);

importRouter.get('/status', getStatus);

// ─── Error handler ────────────────────────────────
//
// Mirror of csv-import.ts handleError: only ImportError reaches the wire;
// anything else becomes 500 CONVERSION_FAILED. Codes map to HTTP status as:
//   NO_FILE, INVALID_FILE_FORMAT, FILE_TOO_LARGE,
//   INVALID_XML, INVALID_FORMAT, ENCRYPTED_FORMAT    → 400
//   IMPORT_IN_PROGRESS                               → 409
//   CONVERSION_FAILED                                → 500
//
// Info-disclosure posture (BUG-96) — see `.claude/rules/xml-import.md`:
//   CONVERSION_FAILED NEVER carries `details`. The service layer logs
//   the full ppxml2db stderr (Python traceback + absolute paths +
//   internal SQLite constraint names) server-side; the wire gets a
//   bare `{error:'CONVERSION_FAILED'}`. The non-ImportError fallback
//   below follows the same posture so surprise fs/runtime errors
//   (e.g. the BUG-94 ENOENT vector) can't leak `String(err)` either.
function handleError(res: Parameters<RequestHandler>[1], err: unknown): void {
  if (err instanceof ImportError) {
    const status = err.code === 'IMPORT_IN_PROGRESS' ? 409
      : err.code === 'CONVERSION_FAILED' ? 500
      : 400;
    if (err.code === 'FILE_TOO_LARGE') {
      res.status(status).json({ error: 'FILE_TOO_LARGE', maxMb: IMPORT_MAX_MB });
      return;
    }
    const body: { error: string; details?: string } = { error: err.code };
    if (err.code !== 'CONVERSION_FAILED') {
      if (err.details) body.details = err.details;
      else if (err.message) body.details = err.message;
    }
    res.status(status).json(body);
    return;
  }
  console.error('[xml-import] unhandled:', err);
  res.status(500).json({ error: 'CONVERSION_FAILED' });
}
