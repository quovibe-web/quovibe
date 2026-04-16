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

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: IMPORT_MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.xml')) {
      cb(new Error('FILE_EXTENSION'));
      return;
    }
    cb(null, true);
  },
});

export const importRouter: RouterType = Router();

// POST /api/import/xml — create a NEW portfolio from the uploaded XML
const uploadXml: RequestHandler = async (req, res) => {
  // Check lock before even processing the file
  if (isImportInProgress()) {
    res.status(409).json({ error: 'IMPORT_IN_PROGRESS' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'INVALID_XML', details: 'Nessun file ricevuto' });
    return;
  }

  // Rename multer's temp file to .xml extension (ppxml2db needs the .xml extension)
  const xmlPath = req.file.path + '.xml';
  fs.renameSync(req.file.path, xmlPath);

  try {
    // Produces a populated temp DB file; no live handle touched.
    const result = await runImport(xmlPath);

    // Derive a display name: use the provided body.name, else the XML filename stripped.
    const bodyName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const fallback = req.file.originalname.replace(/\.xml$/i, '').slice(0, 100);
    const name = bodyName || fallback || 'Imported Portfolio';

    const created = await createPortfolio({
      source: 'import-pp-xml',
      name,
      ppxmlTempDbPath: result.tempDbPath,
    });

    // portfolio-manager atomic-copies the temp DB into place; clean up the original.
    try { fs.unlinkSync(result.tempDbPath); } catch { /* ok */ }

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
  } catch (err) {
    if (err instanceof ImportError) {
      if (err.code === 'CONVERSION_FAILED') {
        res.status(500).json({ error: err.code, details: err.details ?? err.message });
      } else {
        res.status(400).json({ error: err.code, details: err.message });
      }
      return;
    }
    if (err instanceof PortfolioManagerError) {
      res.status(400).json({ error: err.code });
      return;
    }
    console.error('[quovibe] Import error:', err);
    const details = process.env.NODE_ENV === 'production'
      ? 'Errore interno del server'
      : String(err);
    res.status(500).json({ error: 'CONVERSION_FAILED', details });
  }
};

// GET /api/import/status — thin wrapper around the in-process mutex + last-import time
const getStatus: RequestHandler = (_req, res) => {
  const lastImport = getSettings().app.lastImport;
  res.json({ ready: true, inProgress: isImportInProgress(), lastImport });
};

// Apply 120s timeout to the upload route, with multer error handling
importRouter.post('/xml', (req, res, next) => {
  req.setTimeout(120_000);
  res.setTimeout(120_000);
  next();
}, (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err && typeof err === 'object' && 'code' in err) {
      if ((err as { code: string }).code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'FILE_TOO_LARGE' });
        return;
      }
    }
    if (err instanceof Error && err.message === 'FILE_EXTENSION') {
      res.status(400).json({ error: 'INVALID_XML', details: 'Estensione file non .xml' });
      return;
    }
    if (err) return next(err);
    next();
  });
}, uploadXml);

importRouter.get('/status', getStatus);
