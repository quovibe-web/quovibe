import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../apply-bootstrap';
import {
  verifyPortfolioSchemaVersion,
  SchemaVersionMismatchError,
  CURRENT_PORTFOLIO_DB_SCHEMA_VERSION,
  type SchemaVersionErrorCode,
} from '../schema-version';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function freshBootstrappedDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  applyBootstrap(d);
  return d;
}

function setVersion(d: Database.Database, value: string): void {
  d.prepare(`INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES ('schemaVersion', ?)`)
    .run(value);
}

function expectFails(d: Database.Database, code: SchemaVersionErrorCode): void {
  expect(() => verifyPortfolioSchemaVersion(d)).toThrow(
    expect.objectContaining({ code, name: 'SchemaVersionMismatchError' }),
  );
  expect(() => verifyPortfolioSchemaVersion(d)).toThrow(SchemaVersionMismatchError);
}

describe('verifyPortfolioSchemaVersion', () => {
  it('is a no-op on a freshly bootstrapped DB with no row yet', () => {
    db = freshBootstrappedDb();
    expect(() => verifyPortfolioSchemaVersion(db!)).not.toThrow();
  });

  it('passes when the stored version equals CURRENT', () => {
    db = freshBootstrappedDb();
    setVersion(db, String(CURRENT_PORTFOLIO_DB_SCHEMA_VERSION));
    expect(() => verifyPortfolioSchemaVersion(db!)).not.toThrow();
  });

  it('throws SCHEMA_VERSION_TOO_NEW when stored > CURRENT', () => {
    db = freshBootstrappedDb();
    setVersion(db, String(CURRENT_PORTFOLIO_DB_SCHEMA_VERSION + 1));
    expectFails(db, 'SCHEMA_VERSION_TOO_NEW');
  });

  it('throws SCHEMA_VERSION_TOO_OLD when stored < CURRENT (only meaningful once CURRENT > 1)', () => {
    if (CURRENT_PORTFOLIO_DB_SCHEMA_VERSION === 1) return;
    db = freshBootstrappedDb();
    setVersion(db, '1');
    expectFails(db, 'SCHEMA_VERSION_TOO_OLD');
  });

  it('throws SCHEMA_VERSION_CORRUPT on non-integer payload', () => {
    db = freshBootstrappedDb();
    setVersion(db, 'banana');
    expectFails(db, 'SCHEMA_VERSION_CORRUPT');
  });

  it('throws SCHEMA_VERSION_CORRUPT on zero or negative integer', () => {
    db = freshBootstrappedDb();
    setVersion(db, '0');
    expectFails(db, 'SCHEMA_VERSION_CORRUPT');
  });
});
