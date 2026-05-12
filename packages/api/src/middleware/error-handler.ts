import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { SchemaVersionMismatchError } from '../db/schema-version';

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

  if (err instanceof SchemaVersionMismatchError) {
    res.status(503).json({ error: err.code });
    return;
  }

  // better-sqlite3 surfaces SQLite primary error codes on `err.code`. Disk-
  // full conditions deserve a discriminable response (507) so the client
  // can tell the user to free space rather than retry the operation.
  const sqliteCode = (err as { code?: string }).code;
  if (sqliteCode === 'SQLITE_FULL' || sqliteCode === 'SQLITE_IOERR_WRITE') {
    res.status(507).json({ error: 'INSUFFICIENT_STORAGE' });
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
