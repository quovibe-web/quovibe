// packages/api/src/routes/csv-import.ts
import { Router, type RequestHandler, type Router as RouterType } from 'express';
import multer from 'multer';
import {
  saveTempFile, parseCsv, previewTradeImport,
  executeTradeImport, executePriceImport,
  CsvImportError, cleanupTempFiles,
} from '../services/csv/csv-import.service';
import {
  listCsvConfigs, createCsvConfig, updateCsvConfig, deleteCsvConfig,
} from '../services/csv/csv-config.service';
import { csvImportConfigSchema, csvDelimiters, csvDateFormats } from '@quovibe/shared';
import { z } from 'zod';
import { getSqlite } from '../helpers/request';

const UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // native-ok — 100 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      cb(new CsvImportError('INVALID_FILE_FORMAT', 'File must have a .csv extension'));
      return;
    }
    cb(null, true);
  },
});

// Wrap multer so its failures (extension reject, oversize) land as structured
// 400 responses via handleError rather than falling through to the global
// error-handler's 500 branch (BUG-46).
const uploadSingle = (field: string): RequestHandler =>
  (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) { next(); return; }
      if (err instanceof CsvImportError) { handleError(res, err); return; }
      if (err instanceof multer.MulterError) {
        const mapped = err.code === 'LIMIT_FILE_SIZE'
          ? new CsvImportError('FILE_TOO_LARGE', `Upload exceeds ${UPLOAD_MAX_BYTES} bytes`)
          : new CsvImportError('INVALID_FILE_FORMAT', err.message);
        handleError(res, mapped);
        return;
      }
      handleError(res, new CsvImportError('INVALID_FILE_FORMAT', String((err as Error).message ?? err)));
    });
  };

export const csvImportRouter: RouterType = Router();

// ─── Config CRUD ──────────────────────────────────

const getConfigs: RequestHandler = (req, res) => {
  const configs = listCsvConfigs(getSqlite(req));
  res.json(configs);
};

const postConfig: RequestHandler = (req, res) => {
  const input = csvImportConfigSchema.parse(req.body);
  const config = createCsvConfig(getSqlite(req), input);
  res.status(201).json(config);
};

const putConfig: RequestHandler = (req, res) => {
  const id = String(req.params['id']);
  const input = csvImportConfigSchema.partial().parse(req.body);
  const config = updateCsvConfig(getSqlite(req), id, input);
  if (!config) { res.status(404).json({ error: 'Config not found' }); return; }
  res.json(config);
};

const deleteConfig: RequestHandler = (req, res) => {
  const id = String(req.params['id']);
  const deleted = deleteCsvConfig(getSqlite(req), id);
  if (!deleted) { res.status(404).json({ error: 'Config not found' }); return; }
  res.status(204).send();
};

csvImportRouter.get('/configs', getConfigs);
csvImportRouter.post('/configs', postConfig);
csvImportRouter.put('/configs/:id', putConfig);
csvImportRouter.delete('/configs/:id', deleteConfig);

// ─── Trade Import ─────────────────────────────────

const parseTrades: RequestHandler = async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'NO_FILE' }); return; }
  try {
    const tempFileId = saveTempFile(req.file.buffer, req.file.originalname);
    const result = await parseCsv(tempFileId, {
      delimiter: req.body?.delimiter,
      skipLines: req.body?.skipLines ? parseInt(req.body.skipLines, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
};

// BUG-97: re-parse a previously-uploaded file with a different delimiter (or
// skipLines). No multer — the file is already on disk; JSON body carries the
// tempFileId. Same handleError mapping as parse (TEMP_FILE_EXPIRED → 410).
// Zod-validated per api.md: invalid delimiter / type must surface as 400, not
// flow into the parser where an unknown string would crash with a 500 (same
// failure class as BUG-46).
const reparseTradesSchema = z.object({
  tempFileId: z.string().min(1),
  delimiter: z.enum(csvDelimiters).optional(),
  skipLines: z.number().int().min(0).optional(),
}).strict();

const reparseTrades: RequestHandler = async (req, res) => {
  const parsed = reparseTradesSchema.safeParse(req.body);
  if (!parsed.success) {
    if (req.body?.tempFileId == null) {
      res.status(400).json({ error: 'NO_FILE' });
      return;
    }
    handleError(res, new CsvImportError('INVALID_INPUT', parsed.error.message));
    return;
  }
  try {
    const result = await parseCsv(parsed.data.tempFileId, {
      delimiter: parsed.data.delimiter,
      skipLines: parsed.data.skipLines,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
};

// Shared fragments. dateFormat + separators are narrowed to the UI-exposed
// sets so a malformed payload produces 400 `INVALID_INPUT` instead of a 500
// from the downstream parser (same failure class as BUG-46 on the body side
// rather than the multer side).
const columnMappingSchema = z.record(z.string(), z.number().int().min(0));
const decimalSeparatorSchema = z.enum(['.', ',']);
const thousandSeparatorSchema = z.enum(['', '.', ',', ' ']);
const dateFormatSchema = z.enum(csvDateFormats);

const tradePreviewSchema = z.object({
  tempFileId: z.string().min(1),
  delimiter: z.enum(csvDelimiters).optional(),
  columnMapping: columnMappingSchema,
  dateFormat: dateFormatSchema,
  decimalSeparator: decimalSeparatorSchema,
  thousandSeparator: thousandSeparatorSchema,
  targetSecuritiesAccountId: z.string().min(1),
  securityMapping: z.record(z.string(), z.string().min(1)).optional(),
  newSecurityNames: z.array(z.string().min(1)).optional(),
}).strict();

const tradeExecuteSchema = z.object({
  tempFileId: z.string().min(1),
  config: z.object({
    // Client omits delimiter on execute; .default(',') keeps the wire field
    // optional but narrows the parsed output to CsvDelimiter so the service's
    // required delimiter param accepts it (BUG-122). Same value csv-reader
    // already falls back to.
    delimiter: z.enum(csvDelimiters).default(','),
    columnMapping: columnMappingSchema,
    dateFormat: dateFormatSchema,
    decimalSeparator: decimalSeparatorSchema,
    thousandSeparator: thousandSeparatorSchema,
  }).strict(),
  targetSecuritiesAccountId: z.string().min(1),
  securityMapping: z.record(z.string(), z.string().min(1)),
  newSecurities: z.array(z.object({
    name: z.string().min(1),
    isin: z.string().optional(),
    ticker: z.string().optional(),
    currency: z.string().min(1),
  }).strict()),
  excludedRows: z.array(z.number().int().min(1)),
}).strict();

const previewTrades: RequestHandler = async (req, res) => {
  const parsed = tradePreviewSchema.safeParse(req.body);
  if (!parsed.success) {
    handleError(res, new CsvImportError('INVALID_INPUT', parsed.error.message));
    return;
  }
  try {
    const result = await previewTradeImport(getSqlite(req), parsed.data);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
};

const executeTrades: RequestHandler = async (req, res) => {
  const parsed = tradeExecuteSchema.safeParse(req.body);
  if (!parsed.success) {
    handleError(res, new CsvImportError('INVALID_INPUT', parsed.error.message));
    return;
  }
  try {
    const result = await executeTradeImport(getSqlite(req), parsed.data);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
};

csvImportRouter.post('/trades/parse', uploadSingle('file'), parseTrades);
csvImportRouter.post('/trades/reparse', reparseTrades);
csvImportRouter.post('/trades/preview', previewTrades);
csvImportRouter.post('/trades/execute', executeTrades);

// ─── Price Import ─────────────────────────────────

const parsePrices: RequestHandler = async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'NO_FILE' }); return; }
  try {
    const tempFileId = saveTempFile(req.file.buffer, req.file.originalname);
    const result = await parseCsv(tempFileId, {
      delimiter: req.body?.delimiter,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
};

const executePrices: RequestHandler = async (req, res) => {
  try {
    const result = await executePriceImport(getSqlite(req), req.body);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
};

csvImportRouter.post('/prices/parse', uploadSingle('file'), parsePrices);
csvImportRouter.post('/prices/execute', executePrices);

// ─── Error handler ────────────────────────────────

function handleError(res: Parameters<RequestHandler>[1], err: unknown): void {
  if (err instanceof CsvImportError) {
    const status = err.code === 'TEMP_FILE_EXPIRED' ? 410
      : err.code === 'IMPORT_IN_PROGRESS' ? 409
      : 400;
    res.status(status).json({ error: err.code, details: err.message });
    return;
  }
  console.error('[csv-import]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', details: String(err) });
}

// Schedule temp file cleanup every hour
setInterval(cleanupTempFiles, 60 * 60 * 1000); // native-ok
