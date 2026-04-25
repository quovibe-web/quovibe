// Emits `portfolio.mutated { id }` after every 2xx write under
// /api/p/:portfolioId/*. Mount AFTER portfolioContext so 4xx responses
// from invalid-id requests never produce phantom events.
import type { Request, Response, NextFunction } from 'express';
import { broadcast } from '../routes/events';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function broadcastMutations(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const id = req.portfolioId;
    if (!id) return;
    broadcast('portfolio.mutated', { id });
  });
  next();
}
