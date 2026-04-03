import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');

  sqlite.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT,
      currency TEXT DEFAULT 'EUR',
      isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT,
      updatedAt TEXT NOT NULL DEFAULT '',
      note TEXT,
      _xmlid INTEGER NOT NULL DEFAULT 0,
      _order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      isin TEXT,
      tickerSymbol TEXT,
      wkn TEXT,
      currency TEXT DEFAULT 'EUR',
      note TEXT,
      isRetired INTEGER DEFAULT 0,
      feedURL TEXT,
      feed TEXT,
      latestFeedURL TEXT,
      latestFeed TEXT,
      feedTickerSymbol TEXT,
      calendar TEXT,
      updatedAt TEXT,
      onlineId TEXT,
      targetCurrency TEXT
    );

    CREATE TABLE xact (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      amount INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      security TEXT,
      account TEXT NOT NULL DEFAULT '',
      source TEXT,
      updatedAt TEXT NOT NULL DEFAULT '',
      fees INTEGER NOT NULL DEFAULT 0,
      taxes INTEGER NOT NULL DEFAULT 0,
      acctype TEXT NOT NULL DEFAULT 'account',
      _xmlid INTEGER NOT NULL DEFAULT 0,
      _order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE xact_cross_entry (
      from_xact TEXT,
      from_acc TEXT,
      to_xact TEXT,
      to_acc TEXT,
      type TEXT
    );

    CREATE TABLE xact_unit (
      xact TEXT,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT,
      forex_amount INTEGER,
      forex_currency TEXT,
      exchangeRate TEXT
    );

    CREATE TABLE config_entry (
      uuid TEXT,
      config_set INTEGER,
      name TEXT NOT NULL,
      data TEXT
    );
    CREATE TABLE property (
      name TEXT PRIMARY KEY,
      special INTEGER NOT NULL DEFAULT 0,
      value TEXT NOT NULL
    );

    CREATE TABLE account_attr (
      account TEXT,
      attr_uuid TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'string',
      value TEXT,
      seq INTEGER DEFAULT 0,
      PRIMARY KEY (account, attr_uuid)
    );

    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY,
      tstamp TEXT,
      value INTEGER NOT NULL,
      high INTEGER,
      low INTEGER,
      volume INTEGER
    );

    CREATE TABLE price (
      security TEXT,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
      high INTEGER,
      low INTEGER,
      volume INTEGER,
      PRIMARY KEY (security, tstamp)
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Transaction Search Tests ─────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('GET /api/transactions?search=', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    // Seed: account
    sqlite.prepare(`
      INSERT INTO account (uuid, name, type, currency, updatedAt, _xmlid, _order)
      VALUES ('acc-1', 'Broker EUR', 'account', 'EUR', '', 1, 1)
    `).run();

    // Seed: security
    sqlite.prepare(`
      INSERT INTO security (uuid, name, isin, tickerSymbol, wkn, currency, updatedAt)
      VALUES ('sec-1', 'Apple Inc.', 'US0378331005', 'AAPL', 'A1B2C3', 'EUR', '')
    `).run();

    // tx-1: BUY Apple, amount=1550 (=15.50), shares=1000000000 (=10.0000)
    sqlite.prepare(`
      INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, _xmlid, _order)
      VALUES ('tx-1', 'BUY', '2024-06-15', 'EUR', 1550, 1000000000, 'First purchase', 'sec-1', 'acc-1', 'portfolio', 1, 1)
    `).run();

    // tx-2: DEPOSIT, no security, amount=500000 (=5000.00)
    sqlite.prepare(`
      INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, _xmlid, _order)
      VALUES ('tx-2', 'DEPOSIT', '2024-07-01', 'EUR', 500000, 0, 'Monthly deposit', NULL, 'acc-1', 'account', 2, 2)
    `).run();

    // tx-3: DIVIDENDS Apple, amount=250 (=2.50), no shares, no note
    sqlite.prepare(`
      INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, _xmlid, _order)
      VALUES ('tx-3', 'DIVIDENDS', '2024-08-01', 'EUR', 250, 0, NULL, 'sec-1', 'acc-1', 'account', 3, 3)
    `).run();
  });

  it('returns all transactions when search is empty', async () => {
    const res = await request(app).get('/api/transactions?search=');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });

  it('searches by security name (case-insensitive)', async () => {
    const res = await request(app).get('/api/transactions?search=apple');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = res.body.data.map((r: { uuid: string }) => r.uuid);
    expect(ids).toContain('tx-1');
    expect(ids).toContain('tx-3');
  });

  it('searches by ISIN', async () => {
    const res = await request(app).get('/api/transactions?search=US0378331005');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = res.body.data.map((r: { uuid: string }) => r.uuid);
    expect(ids).toContain('tx-1');
    expect(ids).toContain('tx-3');
  });

  it('searches by formatted amount (display value)', async () => {
    // tx-1 amount = 1550 in DB → printf('%.2f', 1550/100.0) = '15.50'
    const res = await request(app).get('/api/transactions?search=15.50');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].uuid).toBe('tx-1');
  });

  it('composes with type filter', async () => {
    const res = await request(app).get('/api/transactions?search=apple&type=BUY');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].uuid).toBe('tx-1');
  });

  it('returns empty array for non-matching search', async () => {
    const res = await request(app).get('/api/transactions?search=zzzznonexistent');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.data).toEqual([]);
  });

  it('searches by note content', async () => {
    // tx-2 note = 'Monthly deposit'
    const res = await request(app).get('/api/transactions?search=monthly');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].uuid).toBe('tx-2');
  });
});
