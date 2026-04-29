import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../apply-bootstrap';

const hasSqliteBindings = (() => {
  try { new Database(':memory:'); return true; } catch { return false; }
})();

function seedFkRefs(db: Database.Database): void {
  // FK targets. Tests use fixed UUIDs 'port-1' (account) and 'sec-1' (security).
  db.prepare(
    `INSERT OR IGNORE INTO account (uuid, type, name, currency, isRetired, updatedAt, _xmlid, _order)
     VALUES ('port-1', 'portfolio', 'Test', 'EUR', 0, '2024-01-01', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt, isRetired)
     VALUES ('sec-1', 'TestSec', 'US0000000000', 'TS', 'EUR', '2024-01-01', 0)`,
  ).run();
}

(hasSqliteBindings ? describe : describe.skip)('applyBootstrap — CSV dedupe', () => {
  it('installs idx_xact_csv_natural_key on a fresh DB', () => {
    const db = new Database(':memory:');
    applyBootstrap(db);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_xact_csv_natural_key'",
    ).all();
    expect(indexes).toHaveLength(1);
  });

  it('partial unique index rejects duplicate CSV-source insert', () => {
    const db = new Database(':memory:');
    applyBootstrap(db);
    seedFkRefs(db);
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, source, updatedAt, _xmlid, _order)
       VALUES ('aaa', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'sec-1', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01', 1, 1)`,
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, source, updatedAt, _xmlid, _order)
         VALUES ('bbb', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'sec-1', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01', 2, 2)`,
      ).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('partial unique index allows non-CSV-source duplicates', () => {
    const db = new Database(':memory:');
    applyBootstrap(db);
    seedFkRefs(db);
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, source, updatedAt, _xmlid, _order)
       VALUES ('m1', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'port-1', 'portfolio', 'MANUAL', '2024-01-01', 1, 1)`,
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, source, updatedAt, _xmlid, _order)
         VALUES ('m2', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'port-1', 'portfolio', 'MANUAL', '2024-01-01', 2, 2)`,
      ).run(),
    ).not.toThrow();
  });

  it('cleans byte-identical CSV duplicates from contaminated DBs and installs index', () => {
    const db = new Database(':memory:');
    applyBootstrap(db);  // initial bootstrap (clean)
    seedFkRefs(db);
    // Drop the index manually to simulate a pre-fix DB shape, then insert dupes.
    db.exec('DROP INDEX IF EXISTS idx_xact_csv_natural_key');
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, source, updatedAt, _xmlid, _order)
       VALUES ('aaa', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'sec-1', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, source, updatedAt, _xmlid, _order)
       VALUES ('bbb', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'sec-1', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01', 2, 2)`,
    ).run();

    applyBootstrap(db);  // re-apply: should clean + install index

    const remaining = db.prepare("SELECT COUNT(*) AS n FROM xact").get() as { n: number };
    expect(remaining.n).toBe(1);
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_xact_csv_natural_key'",
    ).all();
    expect(indexes).toHaveLength(1);
  });

  it('survives divergent CSV duplicates without breaking bootstrap', () => {
    const db = new Database(':memory:');
    applyBootstrap(db);
    seedFkRefs(db);
    db.exec('DROP INDEX IF EXISTS idx_xact_csv_natural_key');
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, note, account, acctype, source, updatedAt, _xmlid, _order)
       VALUES ('aaa', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'sec-1', 'first', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01', 1, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, note, account, acctype, source, updatedAt, _xmlid, _order)
       VALUES ('bbb', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'sec-1', 'second', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01', 2, 2)`,
    ).run();

    // Should NOT throw — the index install fails gracefully.
    expect(() => applyBootstrap(db)).not.toThrow();

    // Both rows survive.
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM xact").get() as { n: number };
    expect(remaining.n).toBe(2);
    // Index is absent (couldn't install over divergent data).
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_xact_csv_natural_key'",
    ).all();
    expect(indexes).toHaveLength(0);
  });
});
