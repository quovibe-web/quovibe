// Shared test helpers: build minimal SQLite files for portfolio-manager tests.
// Both helpers are fully synchronous (better-sqlite3 is a sync API).
import path from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../../db/apply-bootstrap';

interface SeedCounts {
  depositAccounts: number;
  securities: number;
  transactions: number;
}

/**
 * Seed the ppxml2db schema with N deposit accounts, N securities, and N
 * cash-only DEPOSIT transactions. Column names match bootstrap.sql §1+§2:
 *   account: uuid, type, updatedAt, _xmlid, _order (all NOT NULL)
 *   security: uuid (NOT NULL; others nullable)
 *   xact: uuid, acctype, account, date, currency, amount, shares, updatedAt,
 *         type, _xmlid, _order (all NOT NULL)
 */
function seedCounts(db: Database.Database, args: SeedCounts): void {
  const insertAccount = db.prepare(
    "INSERT INTO account (uuid, type, name, currency, updatedAt, _xmlid, _order) " +
    "VALUES (?, 'account', ?, 'EUR', '2026-01-01T00:00:00Z', ?, ?)",
  );
  for (let i = 0; i < args.depositAccounts; i++) {
    insertAccount.run(`acc-${i}`, `Deposit ${i}`, i, i);
  }
  const insertSecurity = db.prepare(
    "INSERT INTO security (uuid, name, currency, updatedAt) VALUES (?, ?, 'EUR', '2026-01-01T00:00:00Z')",
  );
  for (let i = 0; i < args.securities; i++) {
    insertSecurity.run(`sec-${i}`, `Security ${i}`);
  }
  const insertXact = db.prepare(
    "INSERT INTO xact (uuid, acctype, account, date, currency, amount, shares, " +
    "updatedAt, type, _xmlid, _order) " +
    "VALUES (?, 'DEPOSIT_ACCOUNT', 'acc-0', '2026-01-01', 'EUR', 10000, 0, " +
    "'2026-01-01T00:00:00Z', 'DEPOSIT', ?, ?)",
  );
  for (let i = 0; i < args.transactions; i++) {
    insertXact.run(`tx-${i}`, i, i);
  }
}

function uniqueTempDbPath(): string {
  return path.join(tmpdir(), `qv-test-${Date.now()}-${Math.random()}.db`);
}

/**
 * Build a temporary SQLite file in the ppxml2db schema with seeded rows.
 * Uses the same applyBootstrap that createImportedPpxmlImpl calls.
 */
export function buildPpxmlTempDb(args: SeedCounts): string {
  const file = uniqueTempDbPath();
  const db = new Database(file);
  applyBootstrap(db);
  seedCounts(db, args);
  db.close();
  return file;
}

/**
 * Build a temporary SQLite file that simulates a quovibe backup (.db),
 * including vf_portfolio_meta entries so createImportedQuovibeDbImpl can read
 * the portfolio name and createdAt.
 */
export function buildQuovibeBackupDb(args: SeedCounts & { name: string }): string {
  const file = uniqueTempDbPath();
  const db = new Database(file);
  applyBootstrap(db);
  db.prepare("INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES (?, ?)").run('name', args.name);
  db.prepare("INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES (?, ?)").run('createdAt', new Date().toISOString());
  seedCounts(db, args);
  db.close();
  return file;
}
