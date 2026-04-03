import { Router, type RequestHandler, type Router as RouterType } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import Database from 'better-sqlite3';
import { runImport, isImportInProgress, ImportError } from '../services/import.service';
import { updateAppState, getSettings } from '../services/settings.service';
import { DB_PATH } from '../config';

// Multer: save uploads to OS temp dir with a unique filename
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.xml')) {
      cb(new Error('FILE_EXTENSION'));
      return;
    }
    cb(null, true);
  },
});

export const importRouter: RouterType = Router();

// POST /api/import/xml
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
    // Service only produces the new DB file — does NOT touch live connection
    const result = await runImport(xmlPath);

    // reloadApp handles: drain → backup → close → swap → reopen
    const reload = req.app.locals.reloadApp as ((tempDbPath?: string) => Promise<void>) | undefined;
    if (reload) {
      await reload(result.tempDbPath);
    }

    // Write lastImport to sidecar (AFTER reload completes — sidecar survives DB swap)
    updateAppState({ lastImport: new Date().toISOString() });

    // Clean up temp DB after swap
    try { fs.unlinkSync(result.tempDbPath); } catch { /* ok */ }

    console.log('[quovibe] Import completato. App ricaricata (hot reload).');
    res.json({ status: 'success', accounts: result.accounts, securities: result.securities, reloaded: true });
  } catch (err) {
    if (err instanceof ImportError) {
      if (err.code === 'CONVERSION_FAILED') {
        res.status(500).json({ error: err.code, details: err.details ?? err.message });
      } else {
        res.status(400).json({ error: err.code, details: err.message });
      }
      return;
    }
    // Unexpected error — attempt recovery
    console.error('[quovibe] Import error:', err);
    try {
      const reload = req.app.locals.reloadApp as (() => Promise<void>) | undefined;
      if (reload) await reload();
    } catch (reloadErr) {
      console.error('[quovibe] Recovery reload failed:', reloadErr);
    }
    const details = process.env.NODE_ENV === 'production'
      ? 'Errore interno del server'
      : String(err);
    res.status(500).json({ error: 'CONVERSION_FAILED', details });
  }
};

// GET /api/import/status
const getStatus: RequestHandler = (_req, res) => {
  let empty = true;

  try {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const row = db.prepare('SELECT COUNT(*) as cnt FROM account').get() as { cnt: number };
      empty = row.cnt === 0;
    } finally {
      db.close();
    }
  } catch {
    // DB might be mid-restart; return safe defaults
  }

  const lastImport = getSettings().app.lastImport;
  res.json({ ready: true, empty, lastImport });
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
