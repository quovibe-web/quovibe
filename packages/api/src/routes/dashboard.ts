import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { putDashboardSchema } from '@quovibe/shared';
import { getSettings, updateSettings } from '../services/settings.service';

export const dashboardRouter: RouterType = Router();

/** GET /api/dashboard — return dashboards config from sidecar */
const getDashboard: RequestHandler = (_req, res) => {
  const { dashboards, activeDashboard } = getSettings();
  res.json({ dashboards, activeDashboard });
};

/** PUT /api/dashboard — replace dashboards config, validate with Zod */
const putDashboard: RequestHandler = (req, res) => {
  const result = putDashboardSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'INVALID_DASHBOARD_CONFIG', details: result.error.format() });
    return;
  }

  const updated = updateSettings({
    dashboards: result.data.dashboards,
    activeDashboard: result.data.activeDashboard,
  });

  res.json({
    dashboards: updated.dashboards,
    activeDashboard: updated.activeDashboard,
  });
};

dashboardRouter.get('/', getDashboard);
dashboardRouter.put('/', putDashboard);
