// packages/api/src/routes/dashboard.ts
import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { getSqlite } from '../helpers/request';
import {
  listDashboards, getDashboard, createDashboard, updateDashboard, deleteDashboard,
} from '../services/dashboard.service';
import {
  createDashboardBodySchema, updateDashboardBodySchema,
} from '@quovibe/shared';

export const dashboardRouter: RouterType = Router();

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
  const p = createDashboardBodySchema.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'INVALID_INPUT', details: p.error.format() }); return; }
  res.status(201).json(createDashboard(getSqlite(req), p.data));
};
const patchItem: RequestHandler = (req, res) => {
  const id = req.params.dashboardId;
  if (typeof id !== 'string') { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
  const p = updateDashboardBodySchema.safeParse(req.body);
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
