// packages/api/src/services/csv/csv-import.service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { saveTempFile, parseCsv, executePriceImport, executeTradeImport, previewTradeImport } from './csv-import.service';

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

  describe('executeTradeImport (BUG-101)', () => {
    let sqlite: Database.Database;

    beforeEach(() => { sqlite = createTestDb(); });
    afterEach(() => { sqlite.close(); });

    it('reports input-row count, not raw xact-row count (BUY/SELL double internally)', async () => {
      // 2 BUYs + 1 SELL (all dual-entry → 2 xact rows each) + 1 DEPOSIT +
      // 1 DIVIDEND (single row each). User imports 5 logical rows; internal
      // xact table ends up with 8 rows. The success blurb reads
      // `created.transactions`, which must be 5, not 8 — the exact
      // QA-PASS-5 BUG-101 scenario.
      const csv = [
        'date,type,security,shares,amount',
        '2024-01-02,BUY,Apple Inc,10,1500.00',
        '2024-01-03,BUY,Apple Inc,5,760.00',
        '2024-01-04,SELL,Apple Inc,3,480.00',
        '2024-01-05,DEPOSIT,,,2000.00',
        '2024-01-06,DIVIDEND,Apple Inc,,12.50',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'trades.csv');

      const result = await executeTradeImport(sqlite, {
        tempFileId,
        config: {
          delimiter: ',',
          columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4 },
          dateFormat: 'yyyy-MM-dd',
          decimalSeparator: '.',
          thousandSeparator: '',
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { 'Apple Inc': 'sec-1' },
        newSecurities: [],
        excludedRows: [],
      });

      // User-facing counts: 5 logical input rows became 5 transactions.
      expect(result.created.transactions).toBe(5);
      expect(result.imported).toBe(5);
      // Field alignment — future readers picking `imported` must see the same
      // number as readers picking `created.transactions`.
      expect(result.imported).toBe(result.created.transactions);
      expect(result.errors).toHaveLength(0);

      // Internal DB: 3 dual-entries (2 BUY + 1 SELL) × 2 rows + 1 DEPOSIT +
      // 1 DIVIDEND = 8 xact rows. Pins the invariant that the wire count
      // differs from the table count.
      const xactRowCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;
      expect(xactRowCount).toBe(8);
    });
  });

  describe('previewTradeImport (BUG-100)', () => {
    let sqlite: Database.Database;

    beforeEach(() => { sqlite = createTestDb(); });
    afterEach(() => { sqlite.close(); });

    const baseInput = (tempFileId: string) => ({
      tempFileId,
      delimiter: ',' as const,
      columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4 },
      dateFormat: 'yyyy-MM-dd',
      decimalSeparator: '.' as const,
      thousandSeparator: '' as const,
      targetSecuritiesAccountId: 'port-1',
    });

    const unmatchedCsv = [
      'date,type,security,shares,amount',
      '2024-01-02,BUY,FooCorp,10,1500.00',
      '2024-01-03,BUY,BarInc,5,760.00',
    ].join('\n');

    it('baseline: unmatched securities produce MISSING_SECURITY errors when no overlay is provided', async () => {
      const tempFileId = saveTempFile(Buffer.from(unmatchedCsv, 'utf-8'), 'a.csv');
      const result = await previewTradeImport(sqlite, baseInput(tempFileId));

      // Baseline: pre-fix behavior. No auto-match found for either name.
      expect(result.summary.valid).toBe(0);
      expect(result.summary.errors).toBe(2);
      expect(result.errors.every((e) => e.code === 'MISSING_SECURITY')).toBe(true);
    });

    it('newSecurityNames overlay: pending-create names do NOT emit MISSING_SECURITY', async () => {
      const tempFileId = saveTempFile(Buffer.from(unmatchedCsv, 'utf-8'), 'b.csv');
      const result = await previewTradeImport(sqlite, {
        ...baseInput(tempFileId),
        newSecurityNames: ['FooCorp', 'BarInc'],
      });

      // After the overlay, both rows are considered valid — the client has
      // promised to create those securities on execute.
      expect(result.summary.valid).toBe(2);
      expect(result.summary.errors).toBe(0);
      expect(result.errors).toHaveLength(0);

      // The preview-only placeholder must never escape to the wire. Pins the
      // sentinel-containment contract documented at the overlay site.
      expect(JSON.stringify(result)).not.toContain('__PENDING_NEW__');
    });

    it('securityMapping overlay: user-chosen existing security resolves without auto-match', async () => {
      // Map "FooCorp" to the seeded 'sec-1' (Apple Inc); leave BarInc for
      // create-new. Both rows should become valid.
      const tempFileId = saveTempFile(Buffer.from(unmatchedCsv, 'utf-8'), 'c.csv');
      const result = await previewTradeImport(sqlite, {
        ...baseInput(tempFileId),
        securityMapping: { FooCorp: 'sec-1' },
        newSecurityNames: ['BarInc'],
      });

      expect(result.summary.valid).toBe(2);
      expect(result.summary.errors).toBe(0);
    });

    it('securityMapping overrides a server auto-match for the same csvName', async () => {
      // Seed a second security whose name contains "Apple" — auto-match
      // would pick 'sec-1' (Apple Inc) for any csvName containing "Apple".
      // We override with a user pick to 'sec-2'.
      sqlite.prepare(
        'INSERT INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('sec-2', 'Apple Pie Fund', 'US0000000000', 'APF', 'USD', '2024-01-01');

      const csv = [
        'date,type,security,shares,amount',
        '2024-01-02,BUY,Apple Pie,10,100.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'd.csv');

      const result = await previewTradeImport(sqlite, {
        ...baseInput(tempFileId),
        securityMapping: { 'Apple Pie': 'sec-2' },
      });

      expect(result.summary.valid).toBe(1);
      expect(result.summary.errors).toBe(0);
    });
  });
});
