import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { getSqlite } from '../helpers/request';
import { DATE_REGEX } from '../middleware/reporting-period';
import { computeRebalancing } from '../services/rebalancing.service';

function resolveDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && DATE_REGEX.test(value) ? value : fallback;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const rebalancingRouter: RouterType = Router();

// GET /api/taxonomies/:id/rebalancing?date=YYYY-MM-DD
const rebalancingHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const taxonomyId = req.params['id'] as string;
  const date = resolveDate(req.query.date, todayStr());

  const result = computeRebalancing(sqlite, taxonomyId, date);
  if (!result) {
    res.status(404).json({ error: 'Taxonomy not found' });
    return;
  }

  res.json(result);
};

rebalancingRouter.get('/:id/rebalancing', rebalancingHandler);
