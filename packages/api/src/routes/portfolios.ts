// packages/api/src/routes/portfolios.ts
import { Router, type Router as RouterType, type RequestHandler } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  createPortfolio, renamePortfolio, deletePortfolio, exportPortfolio,
  touchPortfolio, PortfolioManagerError,
} from '../services/portfolio-manager';
import { validateQuovibeDbFile, ImportValidationError } from '../services/import-validation';
import { listPortfolios, getPortfolioEntry } from '../services/portfolio-registry';
import { getSettings } from '../services/settings.service';
import { DATA_DIR, IMPORT_MAX_MB, UUID_V4_RE } from '../config';

export const portfoliosRouter: RouterType = Router();

const upload = multer({
  dest: path.join(DATA_DIR, 'tmp'),
  limits: { fileSize: IMPORT_MAX_MB * 1024 * 1024 },
});

const createSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('fresh'), name: z.string().min(1).max(200) }),
  z.object({ source: z.literal('demo') }),
  // import-pp-xml is handled by routes/import.ts which calls portfolio-manager directly;
  // the registry endpoint only accepts the declarative sources.
  z.object({ source: z.literal('import-quovibe-db') }),
]);

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  lastOpenedAt: z.string().optional(),
});

// --- GET /api/portfolios ---------------------------------------------------

const getList: RequestHandler = (_req, res) => {
  const s = getSettings();
  res.json({
    initialized: s.app.initialized,
    defaultPortfolioId: s.app.defaultPortfolioId,
    portfolios: listPortfolios(),
  });
};

// --- POST /api/portfolios --------------------------------------------------

const postCreate: RequestHandler = async (req, res) => {
  try {
    if (req.is('multipart/form-data')) {
      // import-quovibe-db: file upload path
      const file = (req as unknown as { file?: Express.Multer.File }).file;
      if (!file) { res.status(400).json({ error: 'NO_FILE' }); return; }
      try {
        validateQuovibeDbFile(file.path);
      } catch (err) {
        try { fs.unlinkSync(file.path); } catch { /* ok */ }
        if (err instanceof ImportValidationError) {
          res.status(400).json({ error: err.code, details: err.details });
          return;
        }
        throw err;
      }
      const result = await createPortfolio({
        source: 'import-quovibe-db',
        name: '',                                  // name read from vf_portfolio_meta
        uploadedDbPath: file.path,
      });
      try { fs.unlinkSync(file.path); } catch { /* ok */ }
      res.status(201).json(result);
      return;
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.format() });
      return;
    }
    if (parsed.data.source === 'fresh') {
      const r = await createPortfolio({ source: 'fresh', name: parsed.data.name });
      res.status(201).json(r);
      return;
    }
    if (parsed.data.source === 'demo') {
      const r = await createPortfolio({ source: 'demo', name: '' });
      res.status(201).json(r);
      return;
    }
    // import-quovibe-db without a file → 400
    res.status(400).json({ error: 'IMPORT_REQUIRES_FILE' });
  } catch (err) {
    if (err instanceof PortfolioManagerError) {
      // BUG-05: case-insensitive name collision surfaces as 409 Conflict so
      // the client can distinguish it from generic 400 INVALID_INPUT.
      const http = err.code === 'DUPLICATE_NAME' ? 409 : 400;
      res.status(http).json({ error: err.code });
      return;
    }
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'FILE_TOO_LARGE', details: `max ${IMPORT_MAX_MB} MB` });
      return;
    }
    throw err;
  }
};

// --- PATCH /api/portfolios/:id ---------------------------------------------

const patch: RequestHandler = (req, res) => {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID_V4_RE.test(id)) { res.status(400).json({ error: 'INVALID_PORTFOLIO_ID' }); return; }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'INVALID_INPUT' }); return; }

  try {
    if (parsed.data.name !== undefined) {
      const updated = renamePortfolio(id, parsed.data.name);
      res.json(updated);
      return;
    }
    if (parsed.data.lastOpenedAt !== undefined) {
      touchPortfolio(id);
      res.json(getPortfolioEntry(id));
      return;
    }
    res.status(400).json({ error: 'NO_MUTATION_FIELDS' });
  } catch (err) {
    if (err instanceof PortfolioManagerError) {
      const http = err.code === 'DEMO_PORTFOLIO_IMMUTABLE_METADATA' ? 403
                 : err.code === 'PORTFOLIO_NOT_FOUND' ? 404
                 : err.code === 'DUPLICATE_NAME' ? 409
                 : 400;
      res.status(http).json({ error: err.code });
      return;
    }
    throw err;
  }
};

// --- DELETE /api/portfolios/:id --------------------------------------------

const del: RequestHandler = (req, res) => {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID_V4_RE.test(id)) { res.status(400).json({ error: 'INVALID_PORTFOLIO_ID' }); return; }
  try {
    deletePortfolio(id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof PortfolioManagerError) {
      const http = err.code === 'DEMO_PORTFOLIO_IMMUTABLE_METADATA' ? 403
                 : err.code === 'PORTFOLIO_NOT_FOUND' ? 404
                 : 400;
      res.status(http).json({ error: err.code });
      return;
    }
    throw err;
  }
};

// --- GET /api/portfolios/:id/export ----------------------------------------

const getExport: RequestHandler = async (req, res) => {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID_V4_RE.test(id)) { res.status(400).json({ error: 'INVALID_PORTFOLIO_ID' }); return; }
  try {
    const { filePath, downloadName } = await exportPortfolio(id);
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    const stream = fs.createReadStream(filePath);
    stream.on('close', () => { try { fs.unlinkSync(filePath); } catch { /* ok */ } });
    stream.on('error', () => { try { fs.unlinkSync(filePath); } catch { /* ok */ } });
    stream.pipe(res);
  } catch (err) {
    if (err instanceof PortfolioManagerError && err.code === 'PORTFOLIO_NOT_FOUND') {
      res.status(404).json({ error: err.code });
      return;
    }
    throw err;
  }
};

portfoliosRouter.get('/', getList);
portfoliosRouter.post('/', upload.single('file'), postCreate);
portfoliosRouter.patch('/:id', patch);
portfoliosRouter.delete('/:id', del);
portfoliosRouter.get('/:id/export', getExport);
