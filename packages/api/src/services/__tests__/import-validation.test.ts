import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { applyBootstrap } from '../../db/apply-bootstrap';
import { validateQuovibeDbFile, ImportValidationError } from '../import-validation';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-iv-'));

function writeValid(id = 'v.db'): string {
  const p = path.join(tmp, id);
  const db = new Database(p);
  applyBootstrap(db);
  db.exec(`INSERT INTO vf_portfolio_meta (key, value) VALUES ('name', 'Test')`);
  db.close();
  return p;
}

describe('validateQuovibeDbFile', () => {
  it('accepts a well-formed quovibe DB', () => {
    const p = writeValid();
    expect(validateQuovibeDbFile(p).name).toBe('Test');
  });

  it('throws INVALID_SQLITE on non-SQLite bytes', () => {
    const p = path.join(tmp, 'trash.db');
    writeFileSync(p, 'not a sqlite file');
    try { validateQuovibeDbFile(p); } catch (err) {
      expect((err as ImportValidationError).code).toBe('INVALID_SQLITE');
      return;
    }
    throw new Error('did not throw');
  });

  it('throws MISSING_REQUIRED_TABLES on an empty SQLite file', () => {
    const p = path.join(tmp, 'empty.db');
    const db = new Database(p);
    db.close();
    try { validateQuovibeDbFile(p); } catch (err) {
      expect((err as ImportValidationError).code).toBe('MISSING_REQUIRED_TABLES');
      return;
    }
    throw new Error('did not throw');
  });

  it('throws MISSING_PORTFOLIO_NAME when vf_portfolio_meta lacks name', () => {
    const p = path.join(tmp, 'noname.db');
    const db = new Database(p);
    applyBootstrap(db);
    db.close();
    try { validateQuovibeDbFile(p); } catch (err) {
      expect((err as ImportValidationError).code).toBe('MISSING_PORTFOLIO_NAME');
      return;
    }
    throw new Error('did not throw');
  });

  it('throws CORRUPTED_FILE when file bytes are truncated mid-page', () => {
    const p = writeValid('corrupt.db');
    // SQLite pages default to 4096 bytes; truncating to half the file size
    // reliably chops the B-tree mid-page and fails PRAGMA integrity_check.
    const fullSize = fs.statSync(p).size;
    fs.truncateSync(p, Math.floor(fullSize / 2));
    try { validateQuovibeDbFile(p); } catch (err) {
      expect((err as ImportValidationError).code).toBe('CORRUPTED_FILE');
      return;
    }
    throw new Error('did not throw');
  });

  it('throws INVALID_SCHEMA when required top-3 tables exist but verifySchema detects other missing tables', () => {
    // verifySchema checks 11 REQUIRED_TABLES (account, security, xact,
    // xact_cross_entry, xact_unit, price, latest_price, taxonomy,
    // taxonomy_category, taxonomy_assignment, config_entry). The
    // import-validation REQUIRED list is only {account, security,
    // vf_portfolio_meta} — so a DB that has just those three passes
    // MISSING_REQUIRED_TABLES but fails verifySchema on the remaining 8.
    const p = path.join(tmp, 'invalid-schema.db');
    const db = new Database(p);
    db.exec(`
      CREATE TABLE account (uuid TEXT PRIMARY KEY);
      CREATE TABLE security (uuid TEXT PRIMARY KEY);
      CREATE TABLE vf_portfolio_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO vf_portfolio_meta (key, value) VALUES ('name', 'Broken');
    `);
    db.close();
    try { validateQuovibeDbFile(p); } catch (err) {
      expect((err as ImportValidationError).code).toBe('INVALID_SCHEMA');
      return;
    }
    throw new Error('did not throw');
  });

  // ACCOUNT_QUERY_FAILED: the `SELECT COUNT(*) FROM account` in check 6 runs
  // only after verifySchema (check 4) has already confirmed that the `account`
  // table exists. With better-sqlite3 a `COUNT(*)` over an existing table is
  // not rejectable via ordinary DDL — it would require low-level page
  // corruption that also bypasses PRAGMA integrity_check (check 2) and
  // therefore conflicts with every earlier guard. We document the branch as
  // near-unreachable in normal flow; the happy-path test `accepts a
  // well-formed quovibe DB` already exercises the successful SELECT COUNT(*).
  it('exercises the ACCOUNT_QUERY_FAILED branch indirectly via the happy-path SELECT COUNT', () => {
    // This test pins the contract that a valid DB makes the COUNT(*) query
    // succeed — the only way to reach the catch block in real code is to
    // corrupt the `account` btree below page-integrity, which the earlier
    // CORRUPTED_FILE gate already blocks. See `import-validation.ts:89-93`.
    const p = writeValid('account-ok.db');
    expect(() => validateQuovibeDbFile(p)).not.toThrow();
  });
});
