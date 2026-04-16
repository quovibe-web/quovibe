// packages/api/src/routes/dashboard.ts
import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { z } from 'zod';
import { getSqlite } from '../helpers/request';
import {
  listDashboards, getDashboard, createDashboard, updateDashboard, deleteDashboard,
} from '../services/dashboard.service';

export const dashboardRouter: RouterType = Router();

const widgetSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().nullable().optional(),
  span: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

const createBodySchema = z.object({
  name: z.string().min(1).max(100),
  widgets: z.array(widgetSchema).default([]),
  columns: z.number().int().min(1).max(5).default(3),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  widgets: z.array(widgetSchema).optional(),
  columns: z.number().int().min(1).max(5).optional(),
  position: z.number().int().min(0).optional(),
});

const getList: RequestHandler = (req, res) => {
  res.json(listDashboards(getSqlite(req)));
};
const getItem: RequestHandler = (req, res) => {
  const id = req.params.dashboardId;
  if (typeof id !== 'string') { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
  const item = getDashboard(getSqlite(req), id);
  if (!item) { res.status(404).json({ error: 'DASHBOARD_NOT_FOUND' }); return; }
  res.json(item);
};
const postCreate: RequestHandler = (req, res) => {
  const p = createBodySchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'INVALID_INPUT', details: p.error.format() }); return; }
  res.status(201).json(createDashboard(getSqlite(req), p.data));
};
const patchItem: RequestHandler = (req, res) => {
  const id = req.params.dashboardId;
  if (typeof id !== 'string') { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
  const p = updateBodySchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
  const item = updateDashboard(getSqlite(req), id, p.data);
  if (!item) { res.status(404).json({ error: 'DASHBOARD_NOT_FOUND' }); return; }
  res.json(item);
};
const delItem: RequestHandler = (req, res) => {
  const id = req.params.dashboardId;
  if (typeof id !== 'string') { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
  const ok = deleteDashboard(getSqlite(req), id);
  if (!ok) { res.status(404).json({ error: 'DASHBOARD_NOT_FOUND' }); return; }
  res.status(204).end();
};

dashboardRouter.get('/', getList);
dashboardRouter.post('/', postCreate);
dashboardRouter.get('/:dashboardId', getItem);
dashboardRouter.patch('/:dashboardId', patchItem);
dashboardRouter.delete('/:dashboardId', delItem);
