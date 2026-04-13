import { describe, test, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { preserveCustomTables } from '../import.service';

const tmpDir = os.tmpdir();
const liveDbPath = path.join(tmpDir, `test-live-${process.pid}.db`);
const newDbPath = path.join(tmpDir, `test-new-${process.pid}.db`);

/** Create the vf_exchange_rate table (same DDL as applyExtensions) */
function createFxTable(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    )
  `);
}

afterEach(() => {
  for (const p of [liveDbPath, newDbPath]) {
    try { fs.unlinkSync(p); } catch { /* ok */ }
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(p + ext); } catch { /* ok */ }
    }
  }
});

describe('preserveCustomTables', () => {
  test('copies vf_exchange_rate rows from live DB to new DB', () => {
    const liveDb = new Database(liveDbPath);
    createFxTable(liveDb);
    liveDb.exec(`
      INSERT INTO vf_exchange_rate VALUES ('2024-01-15', 'EUR', 'USD', '1.085');
      INSERT INTO vf_exchange_rate VALUES ('2024-01-16', 'EUR', 'USD', '1.089');
      INSERT INTO vf_exchange_rate VALUES ('2024-01-15', 'EUR', 'GBP', '0.861');
    `);
    liveDb.close();

    const newDb = new Database(newDbPath);
    createFxTable(newDb);
    preserveCustomTables(newDb, liveDbPath);

    const count = newDb.prepare('SELECT COUNT(*) as cnt FROM vf_exchange_rate').get() as { cnt: number };
    expect(count.cnt).toBe(3);

    const usd = newDb.prepare(
      `SELECT rate FROM vf_exchange_rate WHERE date = '2024-01-15' AND from_currency = 'EUR' AND to_currency = 'USD'`,
    ).get() as { rate: string };
    expect(usd.rate).toBe('1.085');
    newDb.close();
  });

  test('is a no-op when live DB does not exist', () => {
    const newDb = new Database(newDbPath);
    createFxTable(newDb);
    preserveCustomTables(newDb, '/nonexistent/path.db');

    const count = newDb.prepare('SELECT COUNT(*) as cnt FROM vf_exchange_rate').get() as { cnt: number };
    expect(count.cnt).toBe(0);
    newDb.close();
  });

  test('is a no-op when live DB has no vf_exchange_rate table', () => {
    const liveDb = new Database(liveDbPath);
    liveDb.exec('CREATE TABLE account (uuid TEXT)');
    liveDb.close();

    const newDb = new Database(newDbPath);
    createFxTable(newDb);
    preserveCustomTables(newDb, liveDbPath);

    const count = newDb.prepare('SELECT COUNT(*) as cnt FROM vf_exchange_rate').get() as { cnt: number };
    expect(count.cnt).toBe(0);
    newDb.close();
  });

  test('does not overwrite rows already in new DB', () => {
    const liveDb = new Database(liveDbPath);
    createFxTable(liveDb);
    liveDb.exec(`INSERT INTO vf_exchange_rate VALUES ('2024-01-15', 'EUR', 'USD', '1.085')`);
    liveDb.close();

    const newDb = new Database(newDbPath);
    createFxTable(newDb);
    newDb.exec(`INSERT INTO vf_exchange_rate VALUES ('2024-01-15', 'EUR', 'USD', '1.099')`);

    preserveCustomTables(newDb, liveDbPath);

    const row = newDb.prepare(
      `SELECT rate FROM vf_exchange_rate WHERE date = '2024-01-15' AND from_currency = 'EUR' AND to_currency = 'USD'`,
    ).get() as { rate: string };
    expect(row.rate).toBe('1.099');
    newDb.close();
  });
});
