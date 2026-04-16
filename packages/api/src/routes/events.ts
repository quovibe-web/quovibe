// packages/api/src/routes/events.ts
// Phase 3c stub — Phase 3d replaces this with the real SSE endpoint.
import { Router, type Router as RouterType, type RequestHandler } from 'express';

export const eventsRouter: RouterType = Router();

const notImplemented: RequestHandler = (_req, res) => {
  res.status(501).json({ error: 'NOT_IMPLEMENTED', details: 'SSE wiring arrives in Phase 3d' });
};

eventsRouter.get('/', notImplemented);
