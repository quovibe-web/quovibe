import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { fingerprintXact, cleanupCsvDuplicates } from '../csv-dedupe-cleanup';

const hasSqliteBindings = (() => {
  try { new Database(':memory:'); return true; } catch { return false; }
})();

describe('fingerprintXact', () => {
  it('produces the same fingerprint for two byte-identical rows', () => {
    const a = {
      note: 'Buy AAPL', currency: 'EUR', fees: 0, taxes: 0, acctype: 'portfolio',
      units: [{ type: 'FEE', amount: 100, currency: 'EUR', forex_amount: null, forex_currency: null, exchangeRate: null }],
      crossEntries: [{ type: 'BUY', from_acc: 'port', to_acc: 'dep', role: 'from' as const }],
    };
    const b = { ...a };
    expect(fingerprintXact(a)).toBe(fingerprintXact(b));
  });

  it('produces different fingerprints when notes differ', () => {
    const a = {
      note: 'Buy AAPL', currency: 'EUR', fees: 0, taxes: 0, acctype: 'portfolio',
      units: [], crossEntries: [],
    };
    const b = { ...a, note: 'Sell AAPL' };
    expect(fingerprintXact(a)).not.toBe(fingerprintXact(b));
  });

  it('treats null and undefined as equivalent', () => {
    const a = {
      note: null, currency: 'EUR', fees: 0, taxes: 0, acctype: 'portfolio',
      units: [], crossEntries: [],
    };
    const b = { ...a, note: undefined };
    expect(fingerprintXact(a)).toBe(fingerprintXact(b));
  });

  it('is order-insensitive on the units array', () => {
    const a = {
      note: 'x', currency: 'EUR', fees: 0, taxes: 0, acctype: 'portfolio',
      units: [
        { type: 'FEE', amount: 100, currency: 'EUR', forex_amount: null, forex_currency: null, exchangeRate: null },
        { type: 'TAX', amount: 50, currency: 'EUR', forex_amount: null, forex_currency: null, exchangeRate: null },
      ],
      crossEntries: [],
    };
    const b = {
      ...a,
      units: [
        { type: 'TAX', amount: 50, currency: 'EUR', forex_amount: null, forex_currency: null, exchangeRate: null },
        { type: 'FEE', amount: 100, currency: 'EUR', forex_amount: null, forex_currency: null, exchangeRate: null },
      ],
    };
    expect(fingerprintXact(a)).toBe(fingerprintXact(b));
  });

  it('is order-insensitive on the crossEntries array', () => {
    const a = {
      note: 'x', currency: 'EUR', fees: 0, taxes: 0, acctype: 'portfolio',
      units: [],
      crossEntries: [
        { type: 'BUY', from_acc: 'port', to_acc: 'dep', role: 'from' as const },
        { type: 'BUY', from_acc: 'port', to_acc: 'dep', role: 'to' as const },
      ],
    };
    const b = {
      ...a,
      crossEntries: [
        { type: 'BUY', from_acc: 'port', to_acc: 'dep', role: 'to' as const },
        { type: 'BUY', from_acc: 'port', to_acc: 'dep', role: 'from' as const },
      ],
    };
    expect(fingerprintXact(a)).toBe(fingerprintXact(b));
  });

  it('distinguishes units that differ on a single field', () => {
    const a = {
      note: 'x', currency: 'EUR', fees: 0, taxes: 0, acctype: 'portfolio',
      units: [{ type: 'FEE', amount: 100, currency: 'EUR', forex_amount: null, forex_currency: null, exchangeRate: null }],
      crossEntries: [],
    };
    const b = {
      ...a,
      units: [{ ...a.units[0], amount: 200 }],
    };
    expect(fingerprintXact(a)).not.toBe(fingerprintXact(b));
  });
});

(hasSqliteBindings ? describe : describe.skip)('cleanupCsvDuplicates', () => {
  function createSchema(): Database.Database {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE xact (
        _id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        date TEXT NOT NULL,
        currency TEXT NOT NULL,
        amount INTEGER NOT NULL,
        shares INTEGER NOT NULL,
        note TEXT,
        security TEXT,
        account TEXT NOT NULL,
        acctype TEXT NOT NULL,
        source TEXT,
        updatedAt TEXT NOT NULL,
        fees INTEGER NOT NULL DEFAULT 0,
        taxes INTEGER NOT NULL DEFAULT 0,
        _xmlid INTEGER NOT NULL DEFAULT 0,
        _order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE xact_unit (
        xact TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        forex_amount INTEGER,
        forex_currency TEXT,
        exchangeRate TEXT
      );
      CREATE TABLE xact_cross_entry (
        from_xact TEXT,
        from_acc TEXT,
        to_xact TEXT NOT NULL,
        to_acc TEXT NOT NULL,
        type TEXT NOT NULL
      );
    `);
    return db;
  }

  function insertCsvXact(db: Database.Database, uuid: string, overrides: Partial<{ note: string; amount: number; date: string }> = {}): void {
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, source, updatedAt)
       VALUES (?, 'BUY', ?, 'EUR', ?, 1000, ?, 'sec-1', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01')`,
    ).run(uuid, overrides.date ?? '2024-01-15', overrides.amount ?? 50000, overrides.note ?? null);
  }

  it('collapses byte-identical CSV-source duplicates to MIN(_id)', () => {
    const db = createSchema();
    insertCsvXact(db, 'aaa');  // _id 1
    insertCsvXact(db, 'bbb');  // _id 2 — duplicate
    insertCsvXact(db, 'ccc');  // _id 3 — duplicate
    db.prepare("INSERT INTO xact_unit (xact, type, amount, currency) VALUES (?, 'FEE', 100, 'EUR')").run('aaa');
    db.prepare("INSERT INTO xact_unit (xact, type, amount, currency) VALUES (?, 'FEE', 100, 'EUR')").run('bbb');
    db.prepare("INSERT INTO xact_unit (xact, type, amount, currency) VALUES (?, 'FEE', 100, 'EUR')").run('ccc');

    const result = cleanupCsvDuplicates(db);

    expect(result.collapsedGroups).toBe(1);
    expect(result.deletedRows).toBe(2);
    const surviving = db.prepare('SELECT uuid FROM xact ORDER BY _id').all() as { uuid: string }[];
    expect(surviving).toEqual([{ uuid: 'aaa' }]);
    const units = db.prepare('SELECT xact FROM xact_unit').all();
    expect(units).toEqual([{ xact: 'aaa' }]);
  });

  it('leaves divergent natural-key groups untouched (different notes)', () => {
    const db = createSchema();
    insertCsvXact(db, 'aaa', { note: 'original' });
    insertCsvXact(db, 'bbb', { note: 'edited later' });

    const result = cleanupCsvDuplicates(db);

    expect(result.collapsedGroups).toBe(0);
    expect(result.divergentGroups).toBe(1);
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number };
    expect(remaining.n).toBe(2);
  });

  it('is idempotent — second run finds nothing', () => {
    const db = createSchema();
    insertCsvXact(db, 'aaa');
    insertCsvXact(db, 'bbb');

    cleanupCsvDuplicates(db);
    const second = cleanupCsvDuplicates(db);

    expect(second.collapsedGroups).toBe(0);
    expect(second.deletedRows).toBe(0);
  });

  it('ignores non-CSV-source duplicates', () => {
    const db = createSchema();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, source, updatedAt)
       VALUES ('m1', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'port-1', 'portfolio', 'MANUAL', '2024-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, acctype, source, updatedAt)
       VALUES ('m2', 'BUY', '2024-01-15', 'EUR', 50000, 1000, 'port-1', 'portfolio', 'MANUAL', '2024-01-01')`,
    ).run();

    const result = cleanupCsvDuplicates(db);

    expect(result.collapsedGroups).toBe(0);
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM xact WHERE source = 'MANUAL'").get() as { n: number };
    expect(remaining.n).toBe(2);
  });

  it('cleans dependent xact_cross_entry rows when collapsing', () => {
    const db = createSchema();
    insertCsvXact(db, 'aaa');
    insertCsvXact(db, 'bbb');
    db.prepare("INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES (?, 'port-1', ?, 'dep-1', 'BUY')")
      .run('aaa', 'aaa-cash');
    db.prepare("INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES (?, 'port-1', ?, 'dep-1', 'BUY')")
      .run('bbb', 'bbb-cash');

    cleanupCsvDuplicates(db);

    const ce = db.prepare('SELECT from_xact FROM xact_cross_entry').all();
    expect(ce).toEqual([{ from_xact: 'aaa' }]);
  });
});
