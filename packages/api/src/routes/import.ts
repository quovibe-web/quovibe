import { Router, type RequestHandler, type Router as RouterType } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { runImport, isImportInProgress, ImportError } from '../services/import.service';
import { updateAppState, getSettings } from '../services/settings.service';
import { createPortfolio, PortfolioManagerError } from '../services/portfolio-manager';
import { DATA_DIR, IMPORT_MAX_MB } from '../config';
import { ensureDir } from '../lib/atomic-fs';

// Multer: save uploads to data/tmp (inside DATA_DIR) so boot-recovery's
// sweepStaleTmp reaps orphans after a mid-flight crash. Matches the posture
// of routes/portfolios.ts and ADR-015 §3.15.
const uploadDir = path.join(DATA_DIR, 'tmp');
ensureDir(uploadDir);

const UPLOAD_MAX_BYTES = IMPORT_MAX_MB * 1024 * 1024; // native-ok

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
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

// POST /api/import/xml — create a NEW portfolio from the uploaded XML
const uploadXml: RequestHandler = async (req, res) => {
  // Check lock before even processing the file
  if (isImportInProgress()) {
    res.status(409).json({ error: 'IMPORT_IN_PROGRESS' });
    return;
  }

  if (!req.file) {
    handleError(res, new ImportError('NO_FILE', 'No file received'));
    return;
  }

  // Rename multer's temp file to .xml extension (ppxml2db needs the .xml extension)
  const xmlPath = req.file.path + '.xml';
  fs.renameSync(req.file.path, xmlPath);

  try {
    // Produces a populated temp DB file; no live handle touched.
    const result = await runImport(xmlPath);

    try {
      // Derive a display name: use the provided body.name, else the XML filename stripped.
      const bodyName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const fallback = req.file.originalname.replace(/\.xml$/i, '').slice(0, 100);
      const name = bodyName || fallback || 'Imported Portfolio';

      const created = await createPortfolio({
        source: 'import-pp-xml',
        name,
        ppxmlTempDbPath: result.tempDbPath,
      });

      // Record the last-import timestamp on the user-level sidecar.
      updateAppState({ lastImport: new Date().toISOString() });

      console.log(`[quovibe] Import completed. New portfolio created: ${created.entry.id}`);
      res.status(201).json({
        status: 'success',
        id: created.entry.id,
        name: created.entry.name,
        accounts: result.accounts,
        securities: result.securities,
      });
    } finally {
      // portfolio-manager atomic-COPIES (not moves) the temp DB, and the guard
      // (BUG-92) may throw before the copy runs. Clean up either way so the
      // DUPLICATE_NAME rejection path doesn't orphan the file in os.tmpdir().
      try { fs.unlinkSync(result.tempDbPath); } catch { /* ok */ }
    }
  } catch (err) {
    if (err instanceof ImportError) { handleError(res, err); return; }
    if (err instanceof PortfolioManagerError) {
      // BUG-92: duplicate-name collision from the registry guard must map to
      // 409, mirroring POST /api/portfolios. Other PortfolioManagerError codes
      // (INVALID_SOURCE, DEMO_SOURCE_MISSING, …) keep the 400 default.
      const status = err.code === 'DUPLICATE_NAME' ? 409 : 400;
      res.status(status).json({ error: err.code });
      return;
    }
    console.error('[quovibe] Import error:', err);
    const details = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : String(err);
    res.status(500).json({ error: 'CONVERSION_FAILED', details });
  }
};

// GET /api/import/status — thin wrapper around the in-process mutex + last-import time
const getStatus: RequestHandler = (_req, res) => {
  const lastImport = getSettings().app.lastImport;
  res.json({ ready: true, inProgress: isImportInProgress(), lastImport });
};

// Apply 120s timeout to the upload route. ppxml2db has a 110s internal cap so
// the outer 120s gives it headroom before Express terminates the request.
importRouter.post('/xml', (req, res, next) => {
  req.setTimeout(120_000); // native-ok
  res.setTimeout(120_000); // native-ok
  next();
}, uploadSingle('file'), uploadXml);

importRouter.get('/status', getStatus);

// ─── Error handler ────────────────────────────────
//
// Mirror of csv-import.ts handleError: only ImportError reaches the wire;
// anything else becomes 500 CONVERSION_FAILED. Codes map to HTTP status as:
//   NO_FILE, INVALID_FILE_FORMAT, FILE_TOO_LARGE,
//   INVALID_XML, INVALID_FORMAT, ENCRYPTED_FORMAT    → 400
//   IMPORT_IN_PROGRESS                               → 409
//   CONVERSION_FAILED                                → 500
function handleError(res: Parameters<RequestHandler>[1], err: unknown): void {
  if (err instanceof ImportError) {
    const status = err.code === 'IMPORT_IN_PROGRESS' ? 409
      : err.code === 'CONVERSION_FAILED' ? 500
      : 400;
    const body: { error: string; details?: string } = { error: err.code };
    if (err.details) body.details = err.details;
    else if (err.message) body.details = err.message;
    res.status(status).json(body);
    return;
  }
  console.error('[xml-import]', err);
  res.status(500).json({ error: 'CONVERSION_FAILED', details: String(err) });
}
