// packages/api/src/routes/chart-config.ts
import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { getSqlite } from '../helpers/request';
import { getChartConfig, upsertChartConfig } from '../services/chart-config.service';
import { z } from 'zod';

export const chartConfigRouter: RouterType = Router();

const paramsSchema = z.object({ chartId: z.string().min(1).max(100) });

const get: RequestHandler = (req, res) => {
  const p = paramsSchema.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: 'INVALID_CHART_ID' }); return; }
  const row = getChartConfig(getSqlite(req), p.data.chartId);
  if (!row) { res.status(404).json({ error: 'CHART_CONFIG_NOT_FOUND' }); return; }
  res.json(row);
};

const put: RequestHandler = (req, res) => {
  const p = paramsSchema.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: 'INVALID_CHART_ID' }); return; }
  try {
    res.json(upsertChartConfig(getSqlite(req), p.data.chartId, req.body));
  } catch (err) {
    res.status(400).json({ error: 'INVALID_CHART_CONFIG', details: (err as Error).message });
  }
};

chartConfigRouter.get('/:chartId', get);
chartConfigRouter.put('/:chartId', put);
