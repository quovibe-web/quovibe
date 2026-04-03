import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export type AppDb = BetterSQLite3Database<Record<string, never>>;

type LocalsReq = { app: { locals: Record<string, unknown> } };

export function getDb(req: LocalsReq): AppDb {
  return req.app.locals.db as AppDb;
}

export function getSqlite(req: LocalsReq): BetterSqlite3.Database {
  return req.app.locals.sqlite as BetterSqlite3.Database;
}
