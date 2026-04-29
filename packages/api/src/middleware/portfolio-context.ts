// packages/api/src/middleware/portfolio-context.ts
import type { Request, Response, NextFunction } from 'express';
import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { UUID_V4_RE } from '../config';
import { acquirePortfolioDb, releasePortfolioDb } from '../services/portfolio-db-pool';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portfolioDb?: BetterSQLite3Database<Record<string, unknown>>;
      portfolioSqlite?: BetterSqlite3.Database;
      portfolioId?: string;
    }
  }
}

/**
 * Request-scoped portfolio resolver. Validates the URL param, acquires a
 * pooled handle, attaches {portfolioDb, portfolioSqlite, portfolioId} to the
 * request, and releases the handle exactly once on response finish/close.
 */
export function portfolioContext(req: Request, res: Response, next: NextFunction): void {
  const raw = req.params.portfolioId;
  const id = typeof raw === 'string' ? raw : undefined;
  if (!id || !UUID_V4_RE.test(id)) {
    res.status(400).json({ error: 'INVALID_PORTFOLIO_ID' });
    return;
  }
  try {
    const { db, sqlite } = acquirePortfolioDb(id);
    req.portfolioDb = db;
    req.portfolioSqlite = sqlite;
    req.portfolioId = id;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releasePortfolioDb(id);
    };
    res.on('finish', release);
    res.on('close', release);

    next();
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    if (code === 'PORTFOLIO_NOT_FOUND') {
      res.status(404).json({ error: 'PORTFOLIO_NOT_FOUND' });
      return;
    }
    if (code === 'INVALID_PORTFOLIO_ID' || code === 'PATH_ESCAPE') {
      res.status(400).json({ error: code });
      return;
    }
    throw err;
  }
}
