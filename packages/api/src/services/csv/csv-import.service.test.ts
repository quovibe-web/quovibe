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
  });
});
