// packages/api/src/db/apply-bootstrap.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import type BetterSqlite3 from 'better-sqlite3';

const BOOTSTRAP_SQL = readFileSync(
  join(__dirname, 'bootstrap.sql'),
  'utf-8',
);

/**
 * Apply the quovibe bootstrap DDL to an open SQLite handle.
 * Idempotent. Safe to call on an empty DB, a populated ppxml2db DB,
 * or a DB that already has this script's output.
 */
export function applyBootstrap(db: BetterSqlite3.Database): void {
  db.exec(BOOTSTRAP_SQL);
}
