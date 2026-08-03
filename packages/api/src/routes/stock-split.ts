import { Router, type Router as RouterType, type RequestHandler, type Response } from 'express';
import { ZodError } from 'zod';
import { stockSplitSchema } from '@quovibe/shared';
import { getSqlite } from '../helpers/request';
import {
  applyStockSplit,
  previewStockSplit,
  StockSplitError,
  type StockSplitErrorCode,
} from '../services/stock-split.service';

export const stockSplitRouter: RouterType = Router({ mergeParams: true });

const STATUS_BY_CODE: Record<StockSplitErrorCode, number> = {
  INVALID_SPLIT_RATIO: 400,
  SECURITY_NOT_FOUND: 404,
  DUPLICATE_SPLIT: 409,
  SPLIT_DEDUPE_CONFLICT: 409,
};

function handleError(err: unknown, res: Response): void {
  // The name check mirrors the global error handler: a duplicated zod copy in
  // the workspace makes `instanceof` unreliable across package boundaries.
  if (err instanceof ZodError || (err as { name?: string }).name === 'ZodError') {
    res.status(400).json({ error: 'INVALID_INPUT', details: (err as ZodError).errors });
    return;
  }
  if (err instanceof StockSplitError) {
    res.status(STATUS_BY_CODE[err.code]).json({
      error: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[stock-split] unhandled:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

const postPreview: RequestHandler = (req, res) => {
  try {
    const { securityId } = req.params as { securityId: string };
    const input = stockSplitSchema.parse({ ...req.body, securityId });
    res.json(previewStockSplit(getSqlite(req), input));
  } catch (err) {
    handleError(err, res);
  }
};

const postApply: RequestHandler = (req, res) => {
  try {
    const { securityId } = req.params as { securityId: string };
    const input = stockSplitSchema.parse({ ...req.body, securityId });
    res.json(applyStockSplit(getSqlite(req), input));
  } catch (err) {
    handleError(err, res);
  }
};

stockSplitRouter.post('/preview', postPreview);
stockSplitRouter.post('/', postApply);
