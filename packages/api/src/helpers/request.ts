// packages/api/src/helpers/request.ts
import type { Request } from 'express';
import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getPortfolioEntry } from '../services/portfolio-registry';

export type AppDb = BetterSQLite3Database<Record<string, unknown>>;

/**
 * Portfolio-scoped accessors. The middleware (portfolio-context) injects
 * these onto `req` per request. Handlers must be mounted under
 * `/api/p/:portfolioId/*` via the middleware or these getters throw.
 */
export function getDb(req: Request): AppDb {
  if (!req.portfolioDb) throw new Error('getDb: req.portfolioDb missing — route not mounted under portfolioContext');
  return req.portfolioDb;
}

export function getSqlite(req: Request): BetterSqlite3.Database {
  if (!req.portfolioSqlite) throw new Error('getSqlite: req.portfolioSqlite missing');
  return req.portfolioSqlite;
}

export function getPortfolioId(req: Request): string {
  if (!req.portfolioId) throw new Error('getPortfolioId: req.portfolioId missing');
  return req.portfolioId;
}

export function isDemoPortfolio(req: Request): boolean {
  return getPortfolioEntry(getPortfolioId(req))?.kind === 'demo';
}
