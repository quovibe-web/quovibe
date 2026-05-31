// packages/api/src/routes/fx-rates.ts
// FX rate CRUD + ECB CSV bulk import for user-entered exchange rates.
// All DB writes flow through fx-rates.service (G14 compliance).
import { Router, type RequestHandler, type Router as RouterType } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  listFxPairs,
  listFxRatesForPair,
  createFxRate,
  updateFxRate,
  deleteFxRate,
  importFromEcbCsv,
  FxRatesError,
  EcbCsvError,
} from '../services/fx-rates.service';
import { getSqlite } from '../helpers/request';
import type { Response } from 'express';

const UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // native-ok — 50 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      cb(new FxRatesError('INVALID_FILE_FORMAT', 'File must have a .csv extension'));
      return;
    }
    cb(null, true);
  },
});

// Wraps multer so its failures land as structured 400 responses via handleError,
// not as 500 through the global error handler (mirrors csv-import.ts pattern).
const uploadSingle = (field: string): RequestHandler =>
  (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) { next(); return; }
      if (err instanceof FxRatesError) { handleError(res, err); return; }
      if (err instanceof multer.MulterError) {
        const mapped = err.code === 'LIMIT_FILE_SIZE'
          ? new FxRatesError('FILE_TOO_LARGE', `Upload exceeds ${UPLOAD_MAX_BYTES} bytes`)
          : new FxRatesError('INVALID_FILE_FORMAT', err.message);
        handleError(res, mapped);
        return;
      }
      handleError(res, new FxRatesError('INVALID_FILE_FORMAT', String((err as Error).message ?? err)));
    });
  };

function handleError(res: Response, err: unknown): void {
  if (err instanceof FxRatesError) {
    const status =
      err.code === 'DUPLICATE_RATE' ? 409
      : err.code === 'RATE_NOT_FOUND_OR_NOT_MANUAL' ? 404
      : 400;
    res.status(status).json({ error: err.code });
    return;
  }
  // EcbCsvError: check by name to guard against ESM/CJS module-identity issues
  // in test environments where the class imported here and the one thrown by
  // @quovibe/shared may not share the same identity.
  if (
    err instanceof Error &&
    err.name === 'EcbCsvError' &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    res.status(400).json({ error: (err as EcbCsvError).code });
    return;
  }
  console.error('[fx-rates] unhandled:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// ─── Input schemas ────────────────────────────────────────────────────────────

const createSchema = z.object({
  from: z.string().length(3).regex(/^[A-Z]{3}$/),
  to: z.string().length(3).regex(/^[A-Z]{3}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.string(),
});

const updateSchema = z.object({
  rate: z.string(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const fxRatesRouter: RouterType = Router({ mergeParams: true });

// GET /api/p/:portfolioId/fx-rates
// Returns distinct currency pairs with count + date range.
const getPairs: RequestHandler = (req, res) => {
  try {
    res.json({ pairs: listFxPairs(getSqlite(req)) });
  } catch (e) { handleError(res, e); }
};

// GET /api/p/:portfolioId/fx-rates/:from/:to
// Returns all rates for a pair, ordered by date DESC.
const getRatesForPair: RequestHandler = (req, res) => {
  try {
    const rows = listFxRatesForPair(
      getSqlite(req),
      String(req.params['from']),
      String(req.params['to']),
    );
    res.json(rows);
  } catch (e) { handleError(res, e); }
};

// POST /api/p/:portfolioId/fx-rates
// Creates a single MANUAL rate.
const postRate: RequestHandler = (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.flatten() });
    return;
  }
  try {
    const row = createFxRate(getSqlite(req), parsed.data);
    res.status(201).json({ from: parsed.data.from, to: parsed.data.to, ...row });
  } catch (e) { handleError(res, e); }
};

// PATCH /api/p/:portfolioId/fx-rates/:from/:to/:date
// Updates rate value on an existing MANUAL row. Returns 404 for ECB/IMPORT rows.
const patchRate: RequestHandler = (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_INPUT' });
    return;
  }
  try {
    const row = updateFxRate(getSqlite(req), {
      from: String(req.params['from']),
      to: String(req.params['to']),
      date: String(req.params['date']),
      rate: parsed.data.rate,
    });
    res.json({ from: req.params['from'], to: req.params['to'], ...row });
  } catch (e) { handleError(res, e); }
};

// DELETE /api/p/:portfolioId/fx-rates/:from/:to/:date
// Deletes a MANUAL rate. Returns 404 for ECB/IMPORT rows.
const deleteRate: RequestHandler = (req, res) => {
  try {
    deleteFxRate(getSqlite(req), {
      from: String(req.params['from']),
      to: String(req.params['to']),
      date: String(req.params['date']),
    });
    res.status(204).send();
  } catch (e) { handleError(res, e); }
};

// POST /api/p/:portfolioId/fx-rates/import-csv
// Bulk-imports ECB eurofxref CSV. Uses INSERT OR IGNORE so existing rows are never overwritten.
const importCsv: RequestHandler = (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'NO_FILE' }); return; }
  try {
    const csv = req.file.buffer.toString('utf-8');
    const result = importFromEcbCsv(getSqlite(req), csv);
    res.json(result);
  } catch (e) { handleError(res, e); }
};

fxRatesRouter.get('/', getPairs);
fxRatesRouter.get('/:from/:to', getRatesForPair);
fxRatesRouter.post('/', postRate);
fxRatesRouter.patch('/:from/:to/:date', patchRate);
fxRatesRouter.delete('/:from/:to/:date', deleteRate);
fxRatesRouter.post('/import-csv', uploadSingle('file'), importCsv);
