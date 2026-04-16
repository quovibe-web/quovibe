// packages/api/src/services/import-validation.ts
import fs from 'fs';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { verifySchema, verifyColumnTypes } from '../db/verify';

export type ImportValidationCode =
  | 'INVALID_SQLITE'
  | 'CORRUPTED_FILE'
  | 'MISSING_REQUIRED_TABLES'
  | 'INVALID_SCHEMA'
  | 'MISSING_PORTFOLIO_NAME'
  | 'ACCOUNT_QUERY_FAILED';

export class ImportValidationError extends Error {
  constructor(
    public readonly code: ImportValidationCode,
    public readonly details?: string,
  ) {
    super(code);
    this.name = 'ImportValidationError';
  }
}

const REQUIRED = ['account', 'security', 'vf_portfolio_meta'];

/**
 * Validate an uploaded `.db` file in-place (read-only) before the import
 * pipeline copies it into data/. Throws ImportValidationError with a code
 * matching the spec §3.15 point 5 six-check contract.
 */
export function validateQuovibeDbFile(filePath: string): { name: string } {
  if (!fs.existsSync(filePath)) {
    throw new ImportValidationError('INVALID_SQLITE', `file not found: ${filePath}`);
  }
  let db: BetterSqlite3.Database;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw new ImportValidationError('INVALID_SQLITE', (err as Error).message);
  }
  try {
    // Check 2: integrity
    // Some non-SQLite files slip past the Database constructor (better-sqlite3
    // opens lazily), and only surface as SQLITE_NOTADB on the first query.
    // Severely corrupted files (e.g. mid-page truncation) throw SQLITE_CORRUPT
    // before integrity_check can produce a row — map those to CORRUPTED_FILE.
    let rows: { integrity_check: string }[];
    try {
      rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'SQLITE_NOTADB') {
        throw new ImportValidationError('INVALID_SQLITE', e.message);
      }
      if (e.code === 'SQLITE_CORRUPT' || e.code === 'SQLITE_IOERR_SHORT_READ') {
        throw new ImportValidationError('CORRUPTED_FILE', e.message);
      }
      throw err;
    }
    const result = rows.map(r => r.integrity_check).join('; ');
    if (!rows.length || rows[0].integrity_check !== 'ok') {
      throw new ImportValidationError('CORRUPTED_FILE', result.slice(0, 500));
    }

    // Check 3: required tables
    const tableRows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'`,
    ).all() as { name: string }[];
    const present = new Set(tableRows.map(r => r.name));
    const missing = REQUIRED.filter(t => !present.has(t));
    if (missing.length) {
      throw new ImportValidationError('MISSING_REQUIRED_TABLES', missing.join(','));
    }

    // Check 4: schema + column types
    const schemaResult = verifySchema(db);
    if (!schemaResult.valid) {
      throw new ImportValidationError('INVALID_SCHEMA', schemaResult.missing.join(','));
    }
    // verifyColumnTypes logs warnings and never throws — keep its call but don't gate on it.
    verifyColumnTypes(db);

    // Check 5: portfolio name present and non-empty
    const nameRow = db.prepare(
      "SELECT value FROM vf_portfolio_meta WHERE key = 'name'",
    ).get() as { value: string } | undefined;
    if (!nameRow?.value || nameRow.value.trim() === '') {
      throw new ImportValidationError('MISSING_PORTFOLIO_NAME');
    }

    // Check 6: basic query executes
    try {
      db.prepare('SELECT COUNT(*) as n FROM account').get();
    } catch (err) {
      throw new ImportValidationError('ACCOUNT_QUERY_FAILED', (err as Error).message);
    }

    return { name: nameRow.value };
  } finally {
    try { db.close(); } catch { /* ok */ }
  }
}
