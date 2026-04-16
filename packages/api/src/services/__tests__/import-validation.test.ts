import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
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
});
