// packages/api/src/services/csv/csv-import.service.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { saveTempFile, parseCsv, executePriceImport, executeTradeImport, previewTradeImport, resolveAccountNames, parseTradeRow } from './csv-import.service';
import { applyBootstrap } from '../../db/apply-bootstrap';

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
    CREATE TABLE xact_unit (
      xact TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      forex_amount INTEGER,
      forex_currency TEXT,
      exchangeRate TEXT
    );
    CREATE TABLE vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );

    -- Mirror the partial unique index that applyBootstrap installs in
    -- production via apply-bootstrap.ts > ensureCsvDedupeIndex. INSERT OR
    -- IGNORE in executeTradeImport relies on this constraint to dedupe.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_xact_csv_natural_key
      ON xact (date, type, security, account, shares, amount)
      WHERE source = 'CSV_IMPORT';

    INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order)
      VALUES ('dep-1', 'Cash EUR', 'account', 'EUR', '2024-01-01', 1, 1);
    INSERT INTO account (uuid, name, type, referenceAccount, updatedAt, _xmlid, _order)
      VALUES ('port-1', 'Broker', 'portfolio', 'dep-1', '2024-01-01', 2, 2);
    -- Same-currency security for the BUG-100 / BUG-101 baseline tests. The
    -- cross-currency tests below seed their own USD security explicitly.
    INSERT INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt)
      VALUES ('sec-1', 'Apple Inc', 'US0378331005', 'AAPL', 'EUR', '2024-01-01');
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

    it('returns autodetected wizard pre-fills (BUG-133)', async () => {
      // German-style CSV: dd.MM.yyyy + comma decimal + dot thousand
      // separator + multilingual headers. The wizard should be able to
      // skip the dropdown step and present a populated mapping straight
      // out of the parse phase.
      const csv = [
        'Datum;Typ;Wertpapier;Stück;Wert',
        '15.01.2024;Kauf;Apple Inc;10;1.500,50',
        '16.01.2024;Verkauf;Apple Inc;3;480,00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'de.csv');

      const result = await parseCsv(tempFileId, { delimiter: ';' });

      expect(result.autodetected).toBeDefined();
      expect(result.autodetected!.dateFormat).toBe('dd.MM.yyyy');
      expect(result.autodetected!.decimalSeparator).toBe(',');
      expect(result.autodetected!.thousandSeparator).toBe('.');
      // Multilingual header auto-match: German labels → internal fields.
      expect(result.autodetected!.columnMapping['date']).toBe(0);
      expect(result.autodetected!.columnMapping['type']).toBe(1);
      expect(result.autodetected!.columnMapping['security']).toBe(2);
      expect(result.autodetected!.columnMapping['shares']).toBe(3);
      expect(result.autodetected!.columnMapping['amount']).toBe(4);
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

    it('accepts volume column with M suffix (BUG-161)', async () => {
      const csv = 'Date;Close;Volume\n2026-01-15;191.62;45.6M\n';
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'prices-suffix.csv');

      const result = await executePriceImport(sqlite, {
        tempFileId,
        securityId: 'sec-1',
        columnMapping: { date: 0, close: 1, volume: 2 },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.',
        thousandSeparator: '',
        skipLines: 0,
      });

      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify the volume was parsed: 45.6M = 45,600,000
      const row = sqlite.prepare('SELECT volume FROM price WHERE security = ?').get('sec-1') as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.volume).toBe(45600000);
    });

    it('accepts volume column with B suffix (BUG-161)', async () => {
      const csv = 'Date;Close;Volume\n2026-01-16;192.00;1.23B\n';
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'prices-suffix-b.csv');

      const result = await executePriceImport(sqlite, {
        tempFileId,
        securityId: 'sec-1',
        columnMapping: { date: 0, close: 1, volume: 2 },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.',
        thousandSeparator: '',
        skipLines: 0,
      });

      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify: 1.23B = 1,230,000,000
      const row = sqlite.prepare('SELECT volume FROM price WHERE security = ?').get('sec-1') as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.volume).toBe(1230000000);
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

    describe('re-import dedupe (BUG-143)', () => {
      const baseExecuteInput = (tempFileId: string) => ({
        tempFileId,
        config: {
          delimiter: ',' as const,
          columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4 },
          dateFormat: 'yyyy-MM-dd',
          decimalSeparator: '.' as const,
          thousandSeparator: '' as const,
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { 'Apple Inc': 'sec-1' },
        newSecurities: [],
        excludedRows: [],
      });

      it('re-execute same CSV: second pass skips all rows, count unchanged', async () => {
        const csv = [
          'date,type,security,shares,amount',
          '2024-01-15,BUY,Apple Inc,5,500.00',
          '2024-01-16,BUY,Apple Inc,3,300.00',
        ].join('\n');
        const tempFileId1 = saveTempFile(Buffer.from(csv, 'utf-8'), 'first.csv');
        await executeTradeImport(sqlite, baseExecuteInput(tempFileId1));
        const xactCountAfterFirst = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;

        const tempFileId2 = saveTempFile(Buffer.from(csv, 'utf-8'), 'second.csv');
        const second = await executeTradeImport(sqlite, baseExecuteInput(tempFileId2));

        const xactCountAfterSecond = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;
        expect(second.skippedDuplicates).toBeGreaterThanOrEqual(2);
        expect(xactCountAfterSecond).toBe(xactCountAfterFirst);
      });

      it('mixed re-import: 1 new + 1 duplicate inserts only the new row', async () => {
        const original = 'date,type,security,shares,amount\n2024-01-15,BUY,Apple Inc,5,500.00';
        const tempFileId1 = saveTempFile(Buffer.from(original, 'utf-8'), 'orig.csv');
        await executeTradeImport(sqlite, baseExecuteInput(tempFileId1));
        const beforeMixed = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;

        const mixed = [
          'date,type,security,shares,amount',
          '2024-01-15,BUY,Apple Inc,5,500.00',  // duplicate
          '2024-02-15,BUY,Apple Inc,2,200.00',  // new
        ].join('\n');
        const tempFileId2 = saveTempFile(Buffer.from(mixed, 'utf-8'), 'mixed.csv');

        const result = await executeTradeImport(sqlite, baseExecuteInput(tempFileId2));

        expect(result.skippedDuplicates).toBeGreaterThanOrEqual(1);
        const afterMixed = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;
        // BUY emits 2 xact rows per input row, so the new row contributes +2.
        expect(afterMixed).toBe(beforeMixed + 2);
      });

      it('skipped xacts do NOT leave orphan xact_unit rows', async () => {
        const csv = [
          'date,type,security,shares,amount,fees,taxes',
          '2024-01-15,BUY,Apple Inc,5,500.00,5,2',
        ].join('\n');
        const cfg = {
          delimiter: ',' as const,
          columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4, fees: 5, taxes: 6 },
          dateFormat: 'yyyy-MM-dd',
          decimalSeparator: '.' as const,
          thousandSeparator: '' as const,
        };
        const tempFileId1 = saveTempFile(Buffer.from(csv, 'utf-8'), 'orig.csv');
        await executeTradeImport(sqlite, {
          tempFileId: tempFileId1, config: cfg,
          targetSecuritiesAccountId: 'port-1',
          securityMapping: { 'Apple Inc': 'sec-1' },
          newSecurities: [],
          excludedRows: [],
        });
        const unitsBefore = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact_unit').get() as { n: number }).n;

        const tempFileId2 = saveTempFile(Buffer.from(csv, 'utf-8'), 'reimport.csv');
        await executeTradeImport(sqlite, {
          tempFileId: tempFileId2, config: cfg,
          targetSecuritiesAccountId: 'port-1',
          securityMapping: { 'Apple Inc': 'sec-1' },
          newSecurities: [],
          excludedRows: [],
        });

        const unitsAfter = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact_unit').get() as { n: number }).n;
        expect(unitsAfter).toBe(unitsBefore);
      });
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
      ).run('sec-2', 'Apple Pie Fund', 'US0000000000', 'APF', 'EUR', '2024-01-01');

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

    describe('re-import dedupe (BUG-143)', () => {
      function seedExistingCsvImport(): void {
        sqlite.prepare(
          `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, source, updatedAt, _xmlid, _order)
           VALUES ('seed-1', 'BUY', '2024-01-15', 'EUR', 50000, 500000000, 'sec-1', 'port-1', 'portfolio', 'CSV_IMPORT', '2024-01-01', 1, 1)`,
        ).run();
      }

      const reimportInput = (tempFileId: string) => ({
        tempFileId,
        delimiter: ',' as const,
        columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4 },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.' as const,
        thousandSeparator: '' as const,
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { 'Apple Inc': 'sec-1' },
      });

      it('summary.duplicates counts rows whose natural key matches existing CSV-source xacts', async () => {
        seedExistingCsvImport();
        const csv = [
          'date,type,security,shares,amount',
          '2024-01-15,BUY,Apple Inc,5,500.00',
        ].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'reimport.csv');

        const result = await previewTradeImport(sqlite, reimportInput(tempFileId));

        expect(result.summary.duplicates).toBeGreaterThanOrEqual(1);
      });

      it('summary.duplicates is 0 when no rows match', async () => {
        const csv = [
          'date,type,security,shares,amount',
          '2024-02-15,BUY,Apple Inc,5,500.00',
        ].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fresh.csv');

        const result = await previewTradeImport(sqlite, reimportInput(tempFileId));

        expect(result.summary.duplicates).toBe(0);
      });

      it('non-CSV-source xacts in DB do NOT count toward duplicates', async () => {
        sqlite.prepare(
          `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, source, updatedAt, _xmlid, _order)
           VALUES ('manual-1', 'BUY', '2024-01-15', 'EUR', 50000, 500000000, 'sec-1', 'port-1', 'portfolio', 'MANUAL', '2024-01-01', 1, 1)`,
        ).run();
        const csv = [
          'date,type,security,shares,amount',
          '2024-01-15,BUY,Apple Inc,5,500.00',
        ].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'cross-source.csv');

        const result = await previewTradeImport(sqlite, reimportInput(tempFileId));

        expect(result.summary.duplicates).toBe(0);
      });
    });

    describe('csvCurrencies enrichment (BUG-146)', () => {
      const cgaInput = (tempFileId: string) => ({
        tempFileId,
        delimiter: ',' as const,
        columnMapping: {
          date: 0, type: 1, security: 2, shares: 3, amount: 4,
          fxRate: 5, grossAmount: 6, currencyGrossAmount: 7,
        },
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.' as const,
        thousandSeparator: '' as const,
        targetSecuritiesAccountId: 'port-1',
      });

      it('emits csvCurrencies sorted + deduped when CGA column is mapped', async () => {
        const csvContent = [
          'date,type,security,shares,amount,fxRate,grossAmount,currencyGrossAmount',
          '2024-01-15,BUY,NewCorp,5,500,0.92,460,USD',
          '2024-01-16,BUY,NewCorp,3,300,0.92,276,USD',
          '2024-02-10,BUY,OtherCorp,2,200,0.92,184,USD',
        ].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csvContent, 'utf-8'), 'cga-1.csv');

        const result = await previewTradeImport(sqlite, cgaInput(tempFileId));

        const newCorp = result.unmatchedSecurities.find((s) => s.csvName === 'NewCorp');
        const otherCorp = result.unmatchedSecurities.find((s) => s.csvName === 'OtherCorp');
        expect(newCorp?.csvCurrencies).toEqual(['USD']);
        expect(otherCorp?.csvCurrencies).toEqual(['USD']);
      });

      it('emits csvCurrencies as sorted distinct array for conflicting CGA values', async () => {
        const csvContent = [
          'date,type,security,shares,amount,fxRate,grossAmount,currencyGrossAmount',
          '2024-01-15,BUY,NewCorp,5,500,0.92,460,USD',
          '2024-01-16,BUY,NewCorp,3,300,1.00,300,EUR',
        ].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csvContent, 'utf-8'), 'cga-2.csv');

        const result = await previewTradeImport(sqlite, cgaInput(tempFileId));

        const newCorp = result.unmatchedSecurities.find((s) => s.csvName === 'NewCorp');
        expect(newCorp?.csvCurrencies).toEqual(['EUR', 'USD']);
      });

      it('omits csvCurrencies when CGA column is unmapped', async () => {
        const csvContent = [
          'date,type,security,shares,amount',
          '2024-01-15,BUY,NewCorp,5,500',
        ].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csvContent, 'utf-8'), 'cga-3.csv');

        const result = await previewTradeImport(sqlite, baseInput(tempFileId));

        const newCorp = result.unmatchedSecurities.find((s) => s.csvName === 'NewCorp');
        expect(newCorp?.csvCurrencies).toBeUndefined();
      });
    });

    it('accepts WKN, Time, Date-of-Quote columns without error', async () => {
      // Exercises the accept-and-ignore read path in parseTradeRow for the
      // three PP-parity columns. Uses the seeded 'Apple Inc' / 'sec-1' so
      // no security resolution errors can mask the column-handling behavior.
      const csv = [
        'date,type,security,wkn,time,dateOfQuote,shares,amount',
        '2026-01-15,BUY,Apple Inc,A0YEDG,14:30,2026-01-14,5,1500.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'wkn-cols.csv');

      const result = await previewTradeImport(sqlite, {
        ...baseInput(tempFileId),
        columnMapping: { date: 0, type: 1, security: 2, wkn: 3, time: 4, dateOfQuote: 5, shares: 6, amount: 7 },
        securityMapping: { 'Apple Inc': 'sec-1' },
      });

      expect(result.summary.errors).toBe(0);
      expect(result.summary.valid).toBe(1);
    });

    it('rejects suffix in shares column — does NOT silently 1000× cost basis (BUG-161 regression guard)', async () => {
      const csv = [
        'date,type,security,shares,amount',
        '2024-01-02,BUY,Apple Inc,1.23M,1500.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'trade-suffix.csv');

      const result = await previewTradeImport(sqlite, baseInput(tempFileId));

      // parseNumber is strict and rejects "1.23M", leaving shares undefined.
      // This produces a MISSING_SHARES error, not a silently-multiplied 1230000 shares.
      // The regression guard ensures the trade flow never calls parseNumberWithSuffix.
      expect(result.summary.errors).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('MISSING_SHARES');
    });

    describe('Default-Type inference (type column unmapped)', () => {
      // Exercises the Account-mode inference rules in parseTradeRow.
      // Trigger: columnMapping omits 'type'. Expected: each row's type is
      // derived from sign(amount) × hasSecurity.

      it('positive amount + has security (csvName) → DIVIDEND', async () => {
        const csv = ['date,security,amount', '2024-01-02,Apple Inc,150.00'].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'inf-divp.csv');
        const result = await previewTradeImport(sqlite, {
          ...baseInput(tempFileId),
          columnMapping: { date: 0, security: 1, amount: 2 },
          securityMapping: { 'Apple Inc': 'sec-1' },
        });
        expect(result.summary.errors).toBe(0);
        expect(result.summary.valid).toBe(1);
        expect(result.rows[0]?.type).toBe('DIVIDEND');
      });

      it('negative amount + has security → REMOVAL', async () => {
        const csv = ['date,security,amount', '2024-01-02,Apple Inc,-150.00'].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'inf-remn.csv');
        const result = await previewTradeImport(sqlite, {
          ...baseInput(tempFileId),
          columnMapping: { date: 0, security: 1, amount: 2 },
          securityMapping: { 'Apple Inc': 'sec-1' },
        });
        expect(result.summary.errors).toBe(0);
        expect(result.rows[0]?.type).toBe('REMOVAL');
      });

      it('positive amount + no security → DEPOSIT', async () => {
        const csv = ['date,amount', '2024-01-02,1000.00'].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'inf-dep.csv');
        const result = await previewTradeImport(sqlite, {
          ...baseInput(tempFileId),
          columnMapping: { date: 0, amount: 1 },
        });
        expect(result.summary.errors).toBe(0);
        expect(result.rows[0]?.type).toBe('DEPOSIT');
      });

      it('negative amount + no security → REMOVAL', async () => {
        const csv = ['date,amount', '2024-01-02,-500.00'].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'inf-remns.csv');
        const result = await previewTradeImport(sqlite, {
          ...baseInput(tempFileId),
          columnMapping: { date: 0, amount: 1 },
        });
        expect(result.summary.errors).toBe(0);
        expect(result.rows[0]?.type).toBe('REMOVAL');
      });

      it('mapped type column with empty cell still emits UNKNOWN_TYPE — strict path preserved', async () => {
        const csv = ['date,type,security,amount', '2024-01-02,,Apple Inc,150.00'].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'inf-strict.csv');
        const result = await previewTradeImport(sqlite, {
          ...baseInput(tempFileId),
          columnMapping: { date: 0, type: 1, security: 2, amount: 3 },
          securityMapping: { 'Apple Inc': 'sec-1' },
        });
        expect(result.summary.errors).toBe(1);
        expect(result.errors[0]?.code).toBe('UNKNOWN_TYPE');
      });

      it('mapped type column with garbage cell still emits UNKNOWN_TYPE', async () => {
        const csv = ['date,type,security,amount', '2024-01-02,xyzpdq,Apple Inc,150.00'].join('\n');
        const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'inf-strict2.csv');
        const result = await previewTradeImport(sqlite, {
          ...baseInput(tempFileId),
          columnMapping: { date: 0, type: 1, security: 2, amount: 3 },
          securityMapping: { 'Apple Inc': 'sec-1' },
        });
        expect(result.summary.errors).toBe(1);
        expect(result.errors[0]?.code).toBe('UNKNOWN_TYPE');
      });
    });
  });

  describe('Cross-currency CSV import (PP-aligned)', () => {
    let sqlite: Database.Database;

    beforeEach(() => {
      sqlite = createTestDb();
      // Seed a USD security for the cross-currency cases; the EUR Apple Inc
      // already in the fixture stays for same-currency tests above.
      sqlite.prepare(
        'INSERT INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('sec-nvda', 'NVIDIA', 'US67066G1040', 'NVDA', 'USD', '2024-01-01');
    });
    afterEach(() => { sqlite.close(); });

    const baseConfig = {
      delimiter: ',' as const,
      dateFormat: 'yyyy-MM-dd',
      decimalSeparator: '.' as const,
      thousandSeparator: '' as const,
    };

    it('preview: USD security on EUR deposit without fxRate column nor cached rate → FX_RATE_REQUIRED', async () => {
      const csv = [
        'date,type,security,shares,amount',
        '2024-01-13,BUY,NVIDIA,3,1740.98',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-pre.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4 },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.summary.errors).toBeGreaterThanOrEqual(1);
      expect(result.errors.some((e) => e.code === 'FX_RATE_REQUIRED')).toBe(true);
    });

    it('preview: cached rate auto-fills row.fxRate (PP "automatic" behavior)', async () => {
      // Seed a EUR→USD rate for the trade date. Convention: rate stored
      // is `to-units-per-1-from-unit` per fx.service.ts:30; with from=EUR,
      // to=USD we store the security-per-deposit rate (qv convention).
      sqlite.prepare(
        'INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES (?, ?, ?, ?)',
      ).run('2024-01-13', 'EUR', 'USD', '1.0837');

      const csv = [
        'date,type,security,shares,amount',
        '2024-01-13,BUY,NVIDIA,3,1740.98',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-cache.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4 },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.errors).toHaveLength(0);
      expect(result.summary.valid).toBe(1);
    });

    it('preview: explicit fxRate column populates the row, no error', async () => {
      // PP convention: rate = Value/Gross = deposit-per-security.
      // 1740.98 EUR / 1606.71 USD ≈ 1.0837 EUR per USD.
      const csv = [
        'date,type,security,shares,amount,fxRate',
        '2024-01-13,BUY,NVIDIA,3,1740.98,1.0837',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-explicit.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4, fxRate: 5 },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.errors).toHaveLength(0);
      expect(result.summary.valid).toBe(1);
    });

    it('preview: invalid fxRate (≤ 0) → INVALID_FX_RATE', async () => {
      const csv = [
        'date,type,security,shares,amount,fxRate',
        '2024-01-13,BUY,NVIDIA,3,1740.98,0',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-bad.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4, fxRate: 5 },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.errors.some((e) => e.code === 'INVALID_FX_RATE')).toBe(true);
    });

    it('preview: Gross × Rate ≠ Value → FX_VERIFICATION_FAILED', async () => {
      // PP convention: G × R = V. With G=1500 and R=1.0837, expected V≈1625.55,
      // far from supplied V=1740.98 → verification fails.
      const csv = [
        'date,type,security,shares,amount,grossAmount,fxRate',
        '2024-01-13,BUY,NVIDIA,3,1740.98,1500,1.0837',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-verify.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4, grossAmount: 5, fxRate: 6 },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.errors.some((e) => e.code === 'FX_VERIFICATION_FAILED')).toBe(true);
    });

    it('preview: explicit currencyGrossAmount mismatch → CURRENCY_MISMATCH', async () => {
      const csv = [
        'date,type,security,shares,amount,fxRate,currencyGrossAmount',
        '2024-01-13,BUY,NVIDIA,3,1740.98,1.0837,GBP',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-ccy.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: {
          date: 0, type: 1, security: 2, shares: 3, amount: 4, fxRate: 5, currencyGrossAmount: 6,
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.errors.some((e) => e.code === 'CURRENCY_MISMATCH')).toBe(true);
    });

    it('execute: hard-aborts on FX_RATE_REQUIRED — no partial write', async () => {
      const csv = [
        'date,type,security,shares,amount',
        '2024-01-13,BUY,NVIDIA,3,1740.98',
        '2024-01-14,DEPOSIT,,,500',  // would otherwise insert
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-abort.csv');

      const before = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;

      await expect(executeTradeImport(sqlite, {
        tempFileId,
        config: {
          ...baseConfig,
          columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4 },
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
        newSecurities: [],
        excludedRows: [],
      })).rejects.toMatchObject({ code: 'FX_RATE_REQUIRED' });

      const after = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;
      expect(after).toBe(before);
      const units = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact_unit').get() as { n: number }).n;
      expect(units).toBe(0);
    });

    it('preview: cross-currency DIVIDEND on USD security without fxRate → FX_RATE_REQUIRED', async () => {
      // DIVIDEND joined CROSS_CURRENCY_FX_TYPES: a USD-denominated dividend
      // paid into the EUR deposit `dep-1` must demand fxRate the same way
      // BUY/SELL do. Without it, the engine has no way to convert the
      // payout deterministically and the FOREX unit row never appears.
      const csv = [
        'date,type,security,amount',
        '2024-03-15,DIVIDEND,NVIDIA,50',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-div-pre.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: { date: 0, type: 1, security: 2, amount: 3 },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.summary.errors).toBeGreaterThanOrEqual(1);
      expect(result.errors.some((e) => e.code === 'FX_RATE_REQUIRED')).toBe(true);
    });

    it('preview: cross-currency DIVIDEND auto-fills fxRate from vf_exchange_rate cache', async () => {
      // Mirrors the BUY auto-fill case above: a cached EUR→USD rate for the
      // dividend's date populates row.fxRate transparently.
      sqlite.prepare(
        'INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES (?, ?, ?, ?)',
      ).run('2024-03-15', 'EUR', 'USD', '1.0837');

      const csv = [
        'date,type,security,amount',
        '2024-03-15,DIVIDEND,NVIDIA,50',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-div-cache.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: { date: 0, type: 1, security: 2, amount: 3 },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.errors).toHaveLength(0);
      expect(result.summary.valid).toBe(1);
    });

    it('preview: cross-currency DIVIDEND with mismatched currencyGrossAmount → CURRENCY_MISMATCH', async () => {
      // CURRENCY_MISMATCH used to be BUY/SELL-only — extending it to
      // DIVIDEND closes the same silent-mis-recording class for dividends.
      const csv = [
        'date,type,security,amount,fxRate,currencyGrossAmount',
        '2024-03-15,DIVIDEND,NVIDIA,50,1.0837,GBP',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-div-ccy.csv');

      const result = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: {
          date: 0, type: 1, security: 2, amount: 3, fxRate: 4, currencyGrossAmount: 5,
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
      });

      expect(result.errors.some((e) => e.code === 'CURRENCY_MISMATCH')).toBe(true);
    });

    it('execute: cross-currency DIVIDEND with fxRate persists xact + TAX + FOREX units', async () => {
      // Mirrors the BUY execute case above. PP rate (deposit-per-security)
      // 1.0837 EUR per USD → qvRate = 1/1.0837 = 0.9228…
      // Cash leg: 50 EUR amount; net = 50 - taxes (8) = 42 EUR (DIVIDEND is
      // an INFLOW per computeNetAmountHecto).
      // FOREX unit: amount = 50 × 100 = 5000 hecto EUR;
      //             forex_amount = 50 × 1.0837 × 100 = 5418.5 → rounded 5419 USD hecto.
      const qvFxRate = 1 / 1.0837;
      const csv = [
        'date,type,security,amount,taxes,fxRate',
        `2024-03-15,DIVIDEND,NVIDIA,50,8,${qvFxRate}`,
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-div-exec.csv');

      const result = await executeTradeImport(sqlite, {
        tempFileId,
        config: {
          ...baseConfig,
          columnMapping: { date: 0, type: 1, security: 2, amount: 3, taxes: 4, fxRate: 5 },
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
        newSecurities: [],
        excludedRows: [],
      });

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);

      // 1 cash-side xact (Group B routing — no second xact for DIVIDEND).
      const xacts = sqlite.prepare(
        "SELECT type, account, security FROM xact WHERE type='DIVIDEND'",
      ).all() as Array<{ type: string; account: string; security: string }>;
      expect(xacts).toHaveLength(1);
      expect(xacts[0].account).toBe('dep-1');         // EUR deposit
      expect(xacts[0].security).toBe('sec-nvda');     // USD security

      const units = sqlite.prepare(
        'SELECT type, currency, forex_currency, amount, forex_amount FROM xact_unit ORDER BY type',
      ).all() as Array<{ type: string; currency: string; forex_currency: string | null; amount: number; forex_amount: number | null }>;
      // 1 TAX + 1 FOREX = 2 units on the cash row.
      expect(units).toHaveLength(2);

      const tax = units.find((u) => u.type === 'TAX');
      expect(tax).toBeDefined();
      expect(tax!.amount).toBe(800);                  // 8 EUR × 100
      expect(tax!.currency).toBe('EUR');

      const forex = units.find((u) => u.type === 'FOREX');
      expect(forex).toBeDefined();
      expect(forex!.currency).toBe('EUR');            // deposit ccy
      expect(forex!.amount).toBe(5000);               // 50 EUR × 100
      expect(forex!.forex_currency).toBe('USD');      // security ccy
      expect(forex!.forex_amount).toBe(5419);         // round(50 × 1.0837 × 100)
    });

    it('execute: cross-currency BUY with fxRate persists xact + FOREX/FEE/TAX units', async () => {
      // PP rate (deposit-per-security): 1740.98 EUR / 1606.71 USD = 1.0837.
      const csv = [
        'date,type,security,shares,amount,fees,taxes,grossAmount,fxRate',
        '2024-01-13,BUY,NVIDIA,3,1740.98,15,10,1606.71,1.0837',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'fx-buy.csv');

      const result = await executeTradeImport(sqlite, {
        tempFileId,
        config: {
          ...baseConfig,
          columnMapping: {
            date: 0, type: 1, security: 2, shares: 3, amount: 4,
            fees: 5, taxes: 6, grossAmount: 7, fxRate: 8,
          },
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
        newSecurities: [],
        excludedRows: [],
      });

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);

      // 2 xact rows (BUY portfolio-side + cash-side)
      const xacts = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;
      expect(xacts).toBe(2);

      // 1 FOREX + 1 FEE + 1 TAX = 3 units, all on the source row
      const units = sqlite.prepare(
        'SELECT type, currency, forex_currency, amount, forex_amount FROM xact_unit ORDER BY type',
      ).all() as Array<{ type: string; currency: string; forex_currency: string | null; amount: number; forex_amount: number | null }>;
      expect(units).toHaveLength(3);
      const forex = units.find((u) => u.type === 'FOREX');
      expect(forex).toBeDefined();
      expect(forex!.currency).toBe('EUR');
      expect(forex!.forex_currency).toBe('USD');
      expect(forex!.amount).toBe(174098);     // 1740.98 EUR × 100
      expect(forex!.forex_amount).toBe(160671); // 1606.71 USD × 100
      expect(units.find((u) => u.type === 'FEE')!.amount).toBe(1500);  // 15 EUR × 100
      expect(units.find((u) => u.type === 'TAX')!.amount).toBe(1000);  // 10 EUR × 100
    });

    it('executeTradeImport — cross-ccy BUY with feesFx + taxesFx persists FEE-FOREX + TAX-FOREX units (BUG-124)', async () => {
      // EUR portfolio, USD security (sec-nvda / NVIDIA, seeded in beforeEach).
      // PP wire Exchange Rate = 1.0870 (deposit-per-security = EUR per USD).
      // qvRate = 1/1.0870 ≈ 0.9201 (security-per-deposit, stored in xact_unit.exchangeRate).
      // Gross × Rate = 1500 × 1.0870 = 1630.50 EUR passes the PP step-2 check.
      // feesFx = 5 USD, taxesFx = 2 USD (no same-currency fees/taxes).
      //   FEE: forex_amount = round(5×100) = 500; amount = round((5/qvRate)×100) = round(543.5) = 544
      //   TAX: forex_amount = round(2×100) = 200; amount = round((2/qvRate)×100) = round(217.4) = 217
      const csv = [
        'date,type,security,shares,amount,grossAmount,currencyGrossAmount,fxRate,feesFx,taxesFx',
        '2026-01-15,BUY,NVIDIA,10,1630.50,1500.00,USD,1.0870,5.00,2.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'bug124-exec.csv');

      const result = await executeTradeImport(sqlite, {
        tempFileId,
        config: {
          ...baseConfig,
          columnMapping: {
            date: 0, type: 1, security: 2, shares: 3, amount: 4,
            grossAmount: 5, currencyGrossAmount: 6, fxRate: 7,
            feesFx: 8, taxesFx: 9,
          },
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: { NVIDIA: 'sec-nvda' },
        newSecurities: [],
        excludedRows: [],
      });

      expect(result.imported).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Find the securities-side BUY xact (has shares > 0 and security IS NOT NULL).
      const secXact = sqlite.prepare(
        `SELECT uuid FROM xact
         WHERE type = 'BUY' AND security IS NOT NULL AND shares > 0
           AND date = '2026-01-15'
         LIMIT 1`,
      ).get() as { uuid: string };
      expect(secXact).toBeDefined();

      // FEE FOREX unit: forex_amount = 500 (5 USD × 100), forex_currency = USD.
      const feeUnit = sqlite.prepare(
        `SELECT amount, forex_amount, forex_currency, exchangeRate
         FROM xact_unit WHERE type = 'FEE' AND xact = ?`,
      ).get(secXact.uuid) as { amount: number; forex_amount: number; forex_currency: string; exchangeRate: string };
      expect(feeUnit).toBeDefined();
      expect(feeUnit.forex_amount).toBe(500);
      expect(feeUnit.forex_currency).toBe('USD');
      expect(parseFloat(feeUnit.exchangeRate)).toBeCloseTo(0.92, 2);

      // TAX FOREX unit: forex_amount = 200 (2 USD × 100), forex_currency = USD.
      const taxUnit = sqlite.prepare(
        `SELECT amount, forex_amount, forex_currency, exchangeRate
         FROM xact_unit WHERE type = 'TAX' AND xact = ?`,
      ).get(secXact.uuid) as { amount: number; forex_amount: number; forex_currency: string; exchangeRate: string };
      expect(taxUnit).toBeDefined();
      expect(taxUnit.forex_amount).toBe(200);
      expect(taxUnit.forex_currency).toBe('USD');

      // FOREX (gross) unit still emitted — BUG-121 regression guard.
      const forexUnit = sqlite.prepare(
        `SELECT forex_currency FROM xact_unit WHERE type = 'FOREX' AND xact = ?`,
      ).get(secXact.uuid) as { forex_currency: string };
      expect(forexUnit).toBeDefined();
      expect(forexUnit.forex_currency).toBe('USD');
    });

    it('cross-currency BUY of new security creates security with CGA currency, not portfolioCurrency (BUG-146)', async () => {
      // Use a name with no auto-match against the fixture (so the security is
      // truly new and goes through the create-new path on execute).
      // PP-aligned: amount × tolerance must hold (5e-4). Use NVIDIA-like
      // values that pass step-2: 460 USD × 1.0837 = 498.502 EUR ≈ 498.50.
      const csv = [
        'date,type,security,shares,amount,fxRate,grossAmount,currencyGrossAmount',
        '2024-01-15,BUY,FreshUSDStock,5,498.50,1.0837,460,USD',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'bug146-exec.csv');

      // Step 1: preview surfaces csvCurrencies for the new security.
      const previewResult = await previewTradeImport(sqlite, {
        tempFileId,
        ...baseConfig,
        columnMapping: {
          date: 0, type: 1, security: 2, shares: 3, amount: 4,
          fxRate: 5, grossAmount: 6, currencyGrossAmount: 7,
        },
        targetSecuritiesAccountId: 'port-1',
        newSecurityNames: ['FreshUSDStock'],
      });
      const fresh = previewResult.unmatchedSecurities.find(
        (s) => s.csvName === 'FreshUSDStock',
      );
      expect(fresh?.csvCurrencies).toEqual(['USD']);

      // Step 2: execute as the client would (passing CGA-derived currency).
      await executeTradeImport(sqlite, {
        tempFileId,
        config: {
          delimiter: ',',
          columnMapping: {
            date: 0, type: 1, security: 2, shares: 3, amount: 4,
            fxRate: 5, grossAmount: 6, currencyGrossAmount: 7,
          },
          dateFormat: 'yyyy-MM-dd',
          decimalSeparator: '.',
          thousandSeparator: '',
        },
        targetSecuritiesAccountId: 'port-1',
        securityMapping: {},
        newSecurities: [{ name: 'FreshUSDStock', currency: 'USD' }],
        excludedRows: [],
      });

      // Step 3: assert the security was born with USD, not EUR.
      const sec = sqlite.prepare(
        "SELECT currency FROM security WHERE name = 'FreshUSDStock'",
      ).get() as { currency: string };
      expect(sec.currency).toBe('USD');
    });
  });

  describe('Inventory feasibility (BUG-123)', () => {
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

    it('flags SELL exceeding existing DB holdings as INSUFFICIENT_SHARES', async () => {
      // Seed 10 shares already held in the portfolio (BUY xact row).
      // shares are stored × 1e8 in DB, so 10 shares = 10 × 1e8 = 1_000_000_000.
      sqlite.prepare(
        'INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, acctype, source, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('seed-buy', 'BUY', '2024-01-01', 'EUR', 100000, 1_000_000_000, 'sec-1', 'port-1', 'portfolio', 'TEST', '2024-01-01');

      const csv = [
        'date,type,security,shares,amount',
        '2024-02-01,SELL,Apple Inc,20,3000.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'short-sell.csv');

      const result = await previewTradeImport(sqlite, baseInput(tempFileId));

      const insufficient = result.errors.find((e) => e.code === 'INSUFFICIENT_SHARES');
      expect(insufficient).toBeDefined();
      expect(insufficient!.row).toBe(1);
      expect(result.summary.errors).toBeGreaterThanOrEqual(1);
      expect(result.summary.valid).toBe(0);
    });

    it('allows SELL <= cumulative shares from earlier same-CSV BUYs', async () => {
      // No DB holdings; CSV: BUY 50 then SELL 30 — must be valid, no error.
      const csv = [
        'date,type,security,shares,amount',
        '2024-01-02,BUY,Apple Inc,50,7500.00',
        '2024-01-05,SELL,Apple Inc,30,4800.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'cumulative.csv');

      const result = await previewTradeImport(sqlite, baseInput(tempFileId));

      expect(result.errors.filter((e) => e.code === 'INSUFFICIENT_SHARES')).toHaveLength(0);
      expect(result.summary.valid).toBe(2);
    });

    it('flags SELL exceeding cumulative same-CSV adds even when chronologically interleaved', async () => {
      // BUY 5, SELL 10 — net 5 short. Date ordering: BUY first.
      const csv = [
        'date,type,security,shares,amount',
        '2024-01-02,BUY,Apple Inc,5,750.00',
        '2024-01-05,SELL,Apple Inc,10,1500.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'short.csv');

      const result = await previewTradeImport(sqlite, baseInput(tempFileId));

      const insufficient = result.errors.find((e) => e.code === 'INSUFFICIENT_SHARES');
      expect(insufficient).toBeDefined();
      expect(insufficient!.row).toBe(2); // the SELL row, not the BUY
    });

    it('orders rows chronologically before applying deltas (later-dated SELL gets earlier-dated BUY contribution)', async () => {
      // Row 1 (CSV order) is the later SELL; row 2 is the earlier BUY.
      // Naïve in-CSV-order check would fail; chronological ordering passes.
      const csv = [
        'date,type,security,shares,amount',
        '2024-01-10,SELL,Apple Inc,30,4800.00',
        '2024-01-02,BUY,Apple Inc,50,7500.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'reordered.csv');

      const result = await previewTradeImport(sqlite, baseInput(tempFileId));

      expect(result.errors.filter((e) => e.code === 'INSUFFICIENT_SHARES')).toHaveLength(0);
      expect(result.summary.valid).toBe(2);
    });

    it('flags DELIVERY_OUTBOUND exceeding holdings the same way as SELL', async () => {
      const csv = [
        'date,type,security,shares,amount',
        '2024-02-01,DELIVERY_OUTBOUND,Apple Inc,5,0',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'deliv-out.csv');

      const result = await previewTradeImport(sqlite, baseInput(tempFileId));

      const insufficient = result.errors.find((e) => e.code === 'INSUFFICIENT_SHARES');
      expect(insufficient).toBeDefined();
    });

    it('does not flag pending-new securities until execute (currency unknown at preview)', async () => {
      // Pending-new at preview means no securityId resolved yet → check
      // intentionally skips, mirroring the FX-gate skip pattern. Execute
      // catches it once the security exists.
      const csv = [
        'date,type,security,shares,amount',
        '2024-02-01,SELL,FreshCorp,5,100.00',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'pending.csv');

      const result = await previewTradeImport(sqlite, {
        ...baseInput(tempFileId),
        newSecurityNames: ['FreshCorp'],
      });

      expect(result.errors.filter((e) => e.code === 'INSUFFICIENT_SHARES')).toHaveLength(0);
    });
  });

  describe('previewTradeImport — per-row account routing', () => {
    let sqlite: Database.Database;

    beforeEach(() => {
      sqlite = createTestDb();
      // Seed an extra deposit account (USD) and a second portfolio so we can
      // exercise WRONG_ACCOUNT_TYPE and per-row override behavior.
      sqlite.prepare(
        `INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('dep-usd', 'USD Cash', 'account', 'USD', '2024-01-01', 3, 3);
      sqlite.prepare(
        `INSERT INTO account (uuid, name, type, currency, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('port-2', 'IB Account', 'portfolio', null, 'dep-1', '2024-01-01', 4, 4);
    });
    afterEach(() => { sqlite.close(); });

    const baseRoutingInput = (tempFileId: string, columnMapping: Record<string, number>) => ({
      tempFileId,
      delimiter: ',' as const,
      columnMapping,
      dateFormat: 'yyyy-MM-dd',
      decimalSeparator: '.' as const,
      thousandSeparator: '' as const,
      targetSecuritiesAccountId: 'port-1',
      securityMapping: { 'Apple Inc': 'sec-1' },
    });

    it('emits INVALID_ACCOUNT_NAME for unknown name in `account` column', async () => {
      const csv = [
        'date,type,security,shares,amount,account',
        '2024-01-15,BUY,Apple Inc,5,500.00,Nonexistent',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'invalid-account.csv');

      const result = await previewTradeImport(sqlite, baseRoutingInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, account: 5,
      }));

      const err = result.errors.find((e) => e.code === 'INVALID_ACCOUNT_NAME');
      expect(err).toBeDefined();
      expect(err!.column).toBe('account');
      expect(err!.value).toBe('Nonexistent');
      expect(err!.row).toBe(1);
    });

    it('emits AMBIGUOUS_ACCOUNT_NAME when two deposit accounts share a name', async () => {
      // Seed a duplicate-named deposit account.
      sqlite.prepare(
        `INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('dep-eur-2', 'Cash EUR', 'account', 'EUR', '2024-01-01', 5, 5);

      const csv = [
        'date,type,security,shares,amount,account',
        '2024-01-15,BUY,Apple Inc,5,500.00,Cash EUR',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'ambiguous-account.csv');

      const result = await previewTradeImport(sqlite, baseRoutingInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, account: 5,
      }));

      const err = result.errors.find((e) => e.code === 'AMBIGUOUS_ACCOUNT_NAME');
      expect(err).toBeDefined();
      expect(err!.column).toBe('account');
      expect(err!.value).toBe('Cash EUR');
    });

    it('emits WRONG_ACCOUNT_TYPE when portfolio name appears in deposit `account` column', async () => {
      const csv = [
        'date,type,security,shares,amount,account',
        '2024-01-15,BUY,Apple Inc,5,500.00,Broker',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'wrong-type.csv');

      const result = await previewTradeImport(sqlite, baseRoutingInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, account: 5,
      }));

      const err = result.errors.find((e) => e.code === 'WRONG_ACCOUNT_TYPE');
      expect(err).toBeDefined();
      expect(err!.column).toBe('account');
      expect(err!.value).toBe('Broker');
    });

    it('emits WRONG_ACCOUNT_TYPE when deposit name appears in `securitiesAccount` column', async () => {
      const csv = [
        'date,type,security,shares,amount,securitiesAccount',
        '2024-01-15,BUY,Apple Inc,5,500.00,Cash EUR',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'wrong-type-portfolio.csv');

      const result = await previewTradeImport(sqlite, baseRoutingInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, securitiesAccount: 5,
      }));

      const err = result.errors.find((e) => e.code === 'WRONG_ACCOUNT_TYPE');
      expect(err).toBeDefined();
      expect(err!.column).toBe('securitiesAccount');
      expect(err!.value).toBe('Cash EUR');
    });

    it('emits MISSING_ACCOUNT for TRANSFER_BETWEEN_ACCOUNTS with blank offsetAccount', async () => {
      const csv = [
        'date,type,shares,amount,account,offsetAccount',
        '2024-01-15,TRANSFER_BETWEEN_ACCOUNTS,0,500.00,Cash EUR,',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'missing-offset.csv');

      const result = await previewTradeImport(sqlite, {
        ...baseRoutingInput(tempFileId, {
          date: 0, type: 1, shares: 2, amount: 3, account: 4, offsetAccount: 5,
        }),
      });

      const err = result.errors.find(
        (e) => e.code === 'MISSING_ACCOUNT' && e.column === 'offsetAccount',
      );
      expect(err).toBeDefined();
    });

    it('emits MISSING_ACCOUNT for TRANSFER_BETWEEN_ACCOUNTS with blank source account', async () => {
      const csv = [
        'date,type,shares,amount,account,offsetAccount',
        '2024-01-15,TRANSFER_BETWEEN_ACCOUNTS,0,500.00,,USD Cash',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'missing-source.csv');

      const result = await previewTradeImport(sqlite, {
        ...baseRoutingInput(tempFileId, {
          date: 0, type: 1, shares: 2, amount: 3, account: 4, offsetAccount: 5,
        }),
      });

      const err = result.errors.find(
        (e) => e.code === 'MISSING_ACCOUNT' && e.column === 'account',
      );
      expect(err).toBeDefined();
    });

    it('emits MISSING_ACCOUNT for SECURITY_TRANSFER with blank offsetSecuritiesAccount', async () => {
      const csv = [
        'date,type,security,shares,amount,offsetSecuritiesAccount',
        '2024-01-15,SECURITY_TRANSFER,Apple Inc,5,0,',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'missing-offset-port.csv');

      const result = await previewTradeImport(sqlite, baseRoutingInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, offsetSecuritiesAccount: 5,
      }));

      const err = result.errors.find(
        (e) => e.code === 'MISSING_ACCOUNT' && e.column === 'offsetSecuritiesAccount',
      );
      expect(err).toBeDefined();
    });

    it('blank account cell with top-panel default — no account-class error', async () => {
      const csv = [
        'date,type,security,shares,amount,account',
        '2024-01-15,BUY,Apple Inc,5,500.00,',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'blank-fallback.csv');

      const result = await previewTradeImport(sqlite, baseRoutingInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, account: 5,
      }));

      const accountErrors = result.errors.filter((e) =>
        e.code === 'INVALID_ACCOUNT_NAME' || e.code === 'AMBIGUOUS_ACCOUNT_NAME' ||
        e.code === 'WRONG_ACCOUNT_TYPE' || e.code === 'MISSING_ACCOUNT',
      );
      expect(accountErrors).toHaveLength(0);
    });

    it('per-row override beats top-panel default — valid USD Cash resolves cleanly', async () => {
      // The portfolio's referenceAccount is 'dep-1' (Cash EUR). The CSV row
      // explicitly names "USD Cash" (dep-usd) — must be accepted with no
      // account-class error. Resolved-UUID assertion is left to Task 7's
      // execute-time test; here we only assert the absence of preview errors.
      const csv = [
        'date,type,security,shares,amount,account',
        '2024-01-15,BUY,Apple Inc,5,500.00,USD Cash',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'per-row-override.csv');

      const result = await previewTradeImport(sqlite, baseRoutingInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, account: 5,
      }));

      const accountErrors = result.errors.filter((e) =>
        e.code === 'INVALID_ACCOUNT_NAME' || e.code === 'AMBIGUOUS_ACCOUNT_NAME' ||
        e.code === 'WRONG_ACCOUNT_TYPE' || e.code === 'MISSING_ACCOUNT',
      );
      expect(accountErrors).toHaveLength(0);
    });
  });

  describe('executeTradeImport — per-row account hard-abort', () => {
    let sqlite: Database.Database;

    beforeEach(() => { sqlite = createTestDb(); });
    afterEach(() => { sqlite.close(); });

    const baseExecuteInput = (
      tempFileId: string,
      columnMapping: Record<string, number>,
    ): Parameters<typeof executeTradeImport>[1] => ({
      tempFileId,
      config: {
        delimiter: ',' as const,
        columnMapping,
        dateFormat: 'yyyy-MM-dd',
        decimalSeparator: '.' as const,
        thousandSeparator: '' as const,
      },
      targetSecuritiesAccountId: 'port-1',
      securityMapping: { 'Apple Inc': 'sec-1' },
      newSecurities: [],
      excludedRows: [],
    });

    it('aborts whole import if any row has INVALID_ACCOUNT_NAME — no partial write', async () => {
      const csv = [
        'date,type,security,shares,amount,account',
        '2024-01-15,BUY,Apple Inc,10,1500.00,Cash EUR',     // valid
        '2024-01-16,BUY,Apple Inc,5,750.00,Nonexistent',    // bad account
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'invalid-acct-execute.csv');

      const before = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;

      await expect(executeTradeImport(sqlite, baseExecuteInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, account: 5,
      }))).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_NAME' });

      const after = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;
      expect(after).toBe(before);
      const units = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact_unit').get() as { n: number }).n;
      expect(units).toBe(0);
    });

    it('all-clean batch with named per-row accounts persists without throwing', async () => {
      // Per-row account UUID routing through the mapper lands in Task 8;
      // here we only assert the new gate does not false-positive on a clean
      // batch — both rows execute and persist.
      const csv = [
        'date,type,security,shares,amount,account',
        '2024-01-15,BUY,Apple Inc,10,1500.00,Cash EUR',
        '2024-01-16,BUY,Apple Inc,5,750.00,Cash EUR',
      ].join('\n');
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'clean-acct-execute.csv');

      const result = await executeTradeImport(sqlite, baseExecuteInput(tempFileId, {
        date: 0, type: 1, security: 2, shares: 3, amount: 4, account: 5,
      }));

      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);
      // 2 BUYs × 2 xact rows each = 4 total
      const xactRowCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM xact').get() as { n: number }).n;
      expect(xactRowCount).toBe(4);
    });
  });

  describe('parseTradeRow — per-row account fields', () => {
    it('extracts the 4 account-name fields when mapped (trim, empty → undefined)', () => {
      const fields = ['2026-01-15', 'BUY', 'AAPL', '10', '1500',
        'EUR Cash', 'Main Securities', '  ', ''];
      const columnMapping: Record<string, number> = {
        date: 0, type: 1, security: 2, shares: 3, amount: 4,
        account: 5, securitiesAccount: 6, offsetAccount: 7,
        offsetSecuritiesAccount: 8,
      };
      const opts = { dateFormat: 'yyyy-MM-dd', decimalSeparator: '.' as const, thousandSeparator: '' as const };
      const out = parseTradeRow(2, fields, columnMapping, opts);
      // parseTradeRow returns NormalizedTradeRow | RowError. Check if RowError (has 'code' at top level)
      if ('code' in out) {
        throw new Error(`parse failed: ${JSON.stringify(out)}`);
      }
      expect(out.accountName).toBe('EUR Cash');
      expect(out.securitiesAccountName).toBe('Main Securities');
      expect(out.offsetAccountName).toBeUndefined(); // whitespace-only → undefined
      expect(out.offsetSecuritiesAccountName).toBeUndefined();
    });

    it('all 4 fields are undefined when columns are not mapped', () => {
      const fields = ['2026-01-15', 'BUY', 'AAPL', '10', '1500'];
      const columnMapping: Record<string, number> = {
        date: 0, type: 1, security: 2, shares: 3, amount: 4,
      };
      const opts = { dateFormat: 'yyyy-MM-dd', decimalSeparator: '.' as const, thousandSeparator: '' as const };
      const out = parseTradeRow(2, fields, columnMapping, opts);
      if ('code' in out) {
        throw new Error(`parse failed: ${JSON.stringify(out)}`);
      }
      expect(out.accountName).toBeUndefined();
      expect(out.securitiesAccountName).toBeUndefined();
      expect(out.offsetAccountName).toBeUndefined();
      expect(out.offsetSecuritiesAccountName).toBeUndefined();
    });
  });

  describe('resolveAccountNames', () => {
    let db: Database.Database;
    beforeEach(() => {
      db = new Database(':memory:');
      applyBootstrap(db);
      // Seed 2 deposit accounts + 2 portfolio accounts.
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, _order, updatedAt, _xmlid)
        VALUES (?,?,?,?,0,?,'2024-01-01',0)`).run('dep-eur', 'EUR Cash', 'account', 'EUR', 1);
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, _order, updatedAt, _xmlid)
        VALUES (?,?,?,?,0,?,'2024-01-01',0)`).run('dep-usd', 'USD Cash', 'account', 'USD', 2);
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, _order, updatedAt, _xmlid)
        VALUES (?,?,?,?,0,?,'2024-01-01',0)`).run('port-a', 'Main Securities', 'portfolio', 'EUR', 3);
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, _order, updatedAt, _xmlid)
        VALUES (?,?,?,?,0,?,'2024-01-01',0)`).run('port-b', 'IB Account', 'portfolio', 'EUR', 4);
    });
    afterEach(() => { db.close(); });

    it('resolves names case-insensitive trimmed, scoped per type', () => {
      const out = resolveAccountNames(db, {
        account: ['  eur cash  ', 'usd cash'],
        portfolio: ['Main Securities'],
      });
      expect(out.errors).toEqual([]);
      expect(out.account.get('eur cash')!.uuid).toBe('dep-eur');
      expect(out.account.get('usd cash')!.uuid).toBe('dep-usd');
      expect(out.portfolio.get('main securities')!.uuid).toBe('port-a');
    });

    it('emits AMBIGUOUS for duplicate names within a type', () => {
      db.prepare(`INSERT INTO account (uuid, name, type, currency, isRetired, _order, updatedAt, _xmlid)
        VALUES (?,?,?,?,0,?,'2024-01-01',0)`).run('dep-eur-2', 'EUR Cash', 'account', 'EUR', 5);
      const out = resolveAccountNames(db, { account: ['EUR Cash'], portfolio: [] });
      expect(out.errors).toContainEqual({ code: 'AMBIGUOUS_ACCOUNT_NAME', name: 'EUR Cash', type: 'account', count: 2 });
    });

    it('emits INVALID for unknown names', () => {
      const out = resolveAccountNames(db, { account: ['Nonexistent'], portfolio: [] });
      expect(out.errors).toContainEqual({ code: 'INVALID_ACCOUNT_NAME', name: 'Nonexistent', type: 'account' });
    });

    it('returns empty maps + no errors when both type sets are empty', () => {
      const out = resolveAccountNames(db, { account: [], portfolio: [] });
      expect(out.errors).toEqual([]);
      expect(out.account.size).toBe(0);
      expect(out.portfolio.size).toBe(0);
    });

    it('uses 1 prepared statement per non-empty type set', () => {
      const spy = vi.spyOn(db, 'prepare');
      resolveAccountNames(db, { account: ['EUR Cash'], portfolio: ['Main Securities'] });
      const selectCount = spy.mock.calls.filter((c) =>
        typeof c[0] === 'string' && c[0].startsWith('SELECT uuid, name, type FROM account WHERE type=?'),
      ).length;
      expect(selectCount).toBe(2); // one per type
      spy.mockRestore();
    });
  });

  describe('executeTradeImport — end-to-end multi-broker', () => {
    it('routes BUYs across 2 portfolios + 2 deposits via per-row columns', async () => {
      const db = createTestDb();
      // Replace the default single-broker seed with a 2-broker layout.
      db.exec("DELETE FROM account; DELETE FROM security;");
      db.prepare(`INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order) VALUES (?,?,?,?,?,?,?)`)
        .run('dep-a', 'Broker A Cash', 'account', 'EUR', '2026-01-01', 1, 1);
      db.prepare(`INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order) VALUES (?,?,?,?,?,?,?)`)
        .run('dep-b', 'Broker B Cash', 'account', 'EUR', '2026-01-01', 2, 2);
      db.prepare(`INSERT INTO account (uuid, name, type, referenceAccount, updatedAt, _xmlid, _order) VALUES (?,?,?,?,?,?,?)`)
        .run('port-a', 'Broker A Securities', 'portfolio', 'dep-a', '2026-01-01', 3, 3);
      db.prepare(`INSERT INTO account (uuid, name, type, referenceAccount, updatedAt, _xmlid, _order) VALUES (?,?,?,?,?,?,?)`)
        .run('port-b', 'Broker B Securities', 'portfolio', 'dep-b', '2026-01-01', 4, 4);
      db.prepare(`INSERT INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt) VALUES (?,?,?,?,?,?)`)
        .run('sec-aapl', 'AAPL', 'US0378331005', 'AAPL', 'EUR', '2026-01-01');

      const csv =
        'date,type,security,shares,amount,securitiesAccount,account\n' +
        '2026-01-15,BUY,AAPL,10,1500,Broker A Securities,Broker A Cash\n' +
        '2026-01-16,BUY,AAPL,5,750,Broker B Securities,Broker B Cash\n';
      const tempFileId = saveTempFile(Buffer.from(csv, 'utf-8'), 'multi.csv');

      const result = await executeTradeImport(db, {
        tempFileId,
        config: {
          delimiter: ',',
          columnMapping: { date: 0, type: 1, security: 2, shares: 3, amount: 4, securitiesAccount: 5, account: 6 },
          dateFormat: 'yyyy-MM-dd',
          decimalSeparator: '.',
          thousandSeparator: '',
        },
        targetSecuritiesAccountId: 'port-a',
        securityMapping: { AAPL: 'sec-aapl' },
        newSecurities: [],
        excludedRows: [],
      });

      expect(result.imported).toBe(2);

      const portRows = db.prepare(
        "SELECT account FROM xact WHERE shares > 0 ORDER BY date",
      ).all() as Array<{ account: string }>;
      const cashRows = db.prepare(
        "SELECT account FROM xact WHERE shares = 0 AND security IS NOT NULL ORDER BY date",
      ).all() as Array<{ account: string }>;
      expect(portRows.map((r) => r.account)).toEqual(['port-a', 'port-b']);
      expect(cashRows.map((r) => r.account)).toEqual(['dep-a', 'dep-b']);
    });
  });
});
