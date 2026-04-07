// packages/api/src/services/csv/csv-import.service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { saveTempFile, parseCsv, executePriceImport } from './csv-import.service';

// Only run if better-sqlite3 native bindings are available
const hasSqliteBindings = (() => {
  try { new Database(':memory:'); return true; } catch { return false; }
})();

function createTestDb(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT,
      type TEXT NOT NULL,
      currency TEXT,
      referenceAccount TEXT,
      isRetired INTEGER DEFAULT 0,
      updatedAt TEXT NOT NULL,
      note TEXT,
      _xmlid INTEGER NOT NULL DEFAULT 0,
      _order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT,
      isin TEXT,
      tickerSymbol TEXT,
      currency TEXT,
      updatedAt TEXT NOT NULL,
      isRetired INTEGER DEFAULT 0,
      note TEXT,
      wkn TEXT,
      feedURL TEXT,
      feed TEXT,
      latestFeed TEXT,
      latestFeedURL TEXT,
      feedTickerSymbol TEXT,
      calendar TEXT,
      onlineId TEXT,
      targetCurrency TEXT
    );
    CREATE TABLE price (
      security TEXT NOT NULL,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER,
      PRIMARY KEY (security, tstamp)
    );
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER
    );
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
    CREATE TABLE xact_cross_entry (
      from_xact TEXT,
      from_acc TEXT,
      to_xact TEXT NOT NULL,
      to_acc TEXT NOT NULL,
      type TEXT NOT NULL
    );

    INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order)
      VALUES ('dep-1', 'Cash EUR', 'account', 'EUR', '2024-01-01', 1, 1);
    INSERT INTO account (uuid, name, type, referenceAccount, updatedAt, _xmlid, _order)
      VALUES ('port-1', 'Broker', 'portfolio', 'dep-1', '2024-01-01', 2, 2);
    INSERT INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt)
      VALUES ('sec-1', 'Apple Inc', 'US0378331005', 'AAPL', 'USD', '2024-01-01');
  `);
  return sqlite;
}

(hasSqliteBindings ? describe : describe.skip)('CSV Import Service', () => {
  describe('parseCsv', () => {
    it('parses uploaded CSV and returns headers + sample', async () => {
      const csv = 'Date;Close\n2024-01-01;100.50\n2024-01-02;101.00\n';
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'test.csv');

      const result = await parseCsv(tempFileId, { delimiter: ';' });
      expect(result.headers).toEqual(['Date', 'Close']);
      expect(result.sampleRows).toHaveLength(2);
      expect(result.totalRows).toBe(2);
    });
  });

  describe('executePriceImport', () => {
    let sqlite: Database.Database;

    beforeEach(() => { sqlite = createTestDb(); });
    afterEach(() => { sqlite.close(); });

    it('inserts prices and syncs latest_price', async () => {
      const csv = 'Date;Close\n2024-01-15;150.50\n2024-01-16;151.25\n';
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'prices.csv');

      const result = await executePriceImport(sqlite, {
        tempFileId,
        securityId: 'sec-1',
        columnMapping: { date: 0, close: 1 },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.',
        thousandSeparator: '',
        skipLines: 0,
      });

      expect(result.inserted).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.dateRange).toEqual({ from: '2024-01-15', to: '2024-01-16' });

      // Verify DB
      const rows = sqlite.prepare('SELECT * FROM price WHERE security = ? ORDER BY tstamp').all('sec-1');
      expect(rows).toHaveLength(2);

      // Verify latest_price synced
      const latest = sqlite.prepare('SELECT * FROM latest_price WHERE security = ?').get('sec-1') as Record<string, unknown>;
      expect(latest).toBeTruthy();
      expect(latest.tstamp).toBe('2024-01-16');
    });

    it('skips duplicates with INSERT OR IGNORE', async () => {
      // Pre-insert one price
      sqlite.prepare('INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)').run('sec-1', '2024-01-15', 15050000000);

      const csv = 'Date;Close\n2024-01-15;150.50\n2024-01-16;151.25\n';
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'dup.csv');

      const result = await executePriceImport(sqlite, {
        tempFileId,
        securityId: 'sec-1',
        columnMapping: { date: 0, close: 1 },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.',
        thousandSeparator: '',
        skipLines: 0,
      });

      expect(result.inserted).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });
});
