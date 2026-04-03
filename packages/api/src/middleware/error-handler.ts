import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[quovibe] Error:', err);

  if (err instanceof ZodError || err.name === 'ZodError') {
    res.status(400).json({
      error: 'Validation error',
      details: (err as ZodError).errors,
    });
    return;
  }

  const statusCode = (err as { statusCode?: number }).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    res.status(statusCode).json({ error: err.message });
    return;
  }

  const isDev = process.env.NODE_ENV !== 'production';
  res.status(500).json({
    error: isDev ? err.message : 'Internal server error',
  });
}
