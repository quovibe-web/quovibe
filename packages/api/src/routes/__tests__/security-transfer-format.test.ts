// packages/api/src/routes/__tests__/security-transfer-format.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

let hasSqliteBindings = false;
try { new Database(':memory:').close(); hasSqliteBindings = true; } catch { /* skip */ }

// UUIDs required by createTransactionSchema validation
const DEP_A = '11111111-1111-1111-1111-111111111111';
const DEP_B = '22222222-2222-2222-2222-222222222222';
const PORT_A = '33333333-3333-3333-3333-333333333333';
const PORT_B = '44444444-4444-4444-4444-444444444444';
const SHARE_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT,
      currency TEXT DEFAULT 'EUR', isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT, updatedAt TEXT NOT NULL DEFAULT '',
      note TEXT, _xmlid INTEGER NOT NULL DEFAULT 0, _order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, isin TEXT, tickerSymbol TEXT, wkn TEXT,
      currency TEXT DEFAULT 'EUR', note TEXT, isRetired INTEGER DEFAULT 0,
      feedURL TEXT, feed TEXT, latestFeedURL TEXT, latestFeed TEXT,
      feedTickerSymbol TEXT, calendar TEXT, updatedAt TEXT, onlineId TEXT, targetCurrency TEXT
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
      from_xact TEXT, from_acc TEXT, to_xact TEXT, to_acc TEXT, type TEXT
    );
    CREATE TABLE xact_unit (
      xact TEXT, type TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT,
      forex_amount INTEGER, forex_currency TEXT, exchangeRate TEXT
    );
    CREATE TABLE config_entry (uuid TEXT, config_set INTEGER, name TEXT NOT NULL, data TEXT);
    CREATE TABLE property (name TEXT PRIMARY KEY, special INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL);
    CREATE TABLE account_attr (
      account TEXT, attr_uuid TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'string',
      value TEXT, seq INTEGER DEFAULT 0, PRIMARY KEY (account, attr_uuid)
    );
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY, tstamp TEXT, value INTEGER NOT NULL,
      high INTEGER, low INTEGER, volume INTEGER
    );
    CREATE TABLE price (
      security TEXT, tstamp TEXT NOT NULL, value INTEGER NOT NULL,
      high INTEGER, low INTEGER, volume INTEGER, PRIMARY KEY (security, tstamp)
    );
    CREATE TABLE taxonomy (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL, name TEXT NOT NULL, root TEXT NOT NULL
    );
    CREATE TABLE taxonomy_category (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL, taxonomy TEXT NOT NULL, parent TEXT,
      name TEXT NOT NULL, color TEXT NOT NULL,
      weight INTEGER NOT NULL, rank INTEGER NOT NULL
    );
    CREATE TABLE taxonomy_assignment (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy TEXT NOT NULL, category TEXT NOT NULL,
      item_type TEXT NOT NULL, item TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      rank INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE taxonomy_data (
      taxonomy TEXT NOT NULL, category TEXT,
      name TEXT NOT NULL, type TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL
    );
    CREATE TABLE taxonomy_assignment_data (
      assignment INTEGER NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL, value TEXT NOT NULL
    );
    CREATE TABLE security_event (
      _id INTEGER PRIMARY KEY AUTOINCREMENT, security TEXT, type TEXT,
      date TEXT, details TEXT
    );
  `);
  return sqlite;
}

describe.skipIf(!hasSqliteBindings)('GAP-02: SECURITY_TRANSFER DB format', () => {
  let sqlite: ReturnType<typeof Database>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sqlite = createTestDb();
    sqlite.exec(`
      INSERT INTO account VALUES
        (NULL, '${DEP_A}', 'Deposit A', 'account', 'EUR', 0, NULL, '', NULL, 1, 1),
        (NULL, '${DEP_B}', 'Deposit B', 'account', 'EUR', 0, NULL, '', NULL, 2, 2),
        (NULL, '${PORT_A}', 'Portfolio A', 'portfolio', 'EUR', 0, '${DEP_A}', '', NULL, 3, 3),
        (NULL, '${PORT_B}', 'Portfolio B', 'portfolio', 'EUR', 0, '${DEP_B}', '', NULL, 4, 4);
      INSERT INTO security VALUES
        (NULL, '${SHARE_1}', 'Share 1', NULL, NULL, NULL, 'EUR', NULL, 0,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      -- Give port-a some shares to transfer
      INSERT INTO xact VALUES
        (NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'BUY', '2024-01-01', 'EUR', 100000, 500000000, NULL,
         '${SHARE_1}', '${PORT_A}', 'TEST', '2024-01-01', 0, 0, 'portfolio', 1, 1);
    `);
    const db = drizzle(sqlite, { schema });
    app = createApp(db, sqlite);
  });

  it('source row is stored as TRANSFER_OUT with positive shares', async () => {
    await request(app).post('/api/transactions').send({
      type: 'SECURITY_TRANSFER',
      date: '2024-06-01',
      amount: 30,
      shares: 3,
      currencyCode: 'EUR',
      securityId: SHARE_1,
      accountId: PORT_A,
      crossAccountId: PORT_B,
    }).expect(201);

    const source = sqlite
      .prepare(`SELECT * FROM xact WHERE account = '${PORT_A}' AND type = 'TRANSFER_OUT'`)
      .get() as Record<string, unknown>;

    expect(source).toBeTruthy();
    expect(source['type']).toBe('TRANSFER_OUT');
    // shares must be positive (3 × 10^8 = 300000000)
    expect(source['shares']).toBe(300000000);
  });

  it('destination row is stored as TRANSFER_IN with positive shares', async () => {
    await request(app).post('/api/transactions').send({
      type: 'SECURITY_TRANSFER',
      date: '2024-06-01',
      amount: 30,
      shares: 3,
      currencyCode: 'EUR',
      securityId: SHARE_1,
      accountId: PORT_A,
      crossAccountId: PORT_B,
    }).expect(201);

    const dest = sqlite
      .prepare(`SELECT * FROM xact WHERE account = '${PORT_B}'`)
      .get() as Record<string, unknown>;

    expect(dest).toBeTruthy();
    expect(dest['type']).toBe('TRANSFER_IN');
    expect(dest['shares']).toBe(300000000);
  });

  it('source portfolio net shares decrease after transfer', async () => {
    await request(app).post('/api/transactions').send({
      type: 'SECURITY_TRANSFER',
      date: '2024-06-01',
      amount: 30,
      shares: 3,
      currencyCode: 'EUR',
      securityId: SHARE_1,
      accountId: PORT_A,
      crossAccountId: PORT_B,
    }).expect(201);

    // port-a started with 5 shares (buy-1), transferred 3 → should have 2
    const netShares = sqlite.prepare(`
      SELECT SUM(CASE
        WHEN type IN ('BUY', 'TRANSFER_IN')  THEN shares
        WHEN type IN ('SELL', 'TRANSFER_OUT') THEN -shares
        ELSE 0
      END) as net
      FROM xact WHERE account = '${PORT_A}' AND shares > 0
    `).get() as { net: number };

    expect(netShares.net).toBe(200000000); // 2 shares × 10^8
  });

  it('destination portfolio net shares increase after transfer', async () => {
    await request(app).post('/api/transactions').send({
      type: 'SECURITY_TRANSFER',
      date: '2024-06-01',
      amount: 30,
      shares: 3,
      currencyCode: 'EUR',
      securityId: SHARE_1,
      accountId: PORT_A,
      crossAccountId: PORT_B,
    }).expect(201);

    const netShares = sqlite.prepare(`
      SELECT SUM(CASE
        WHEN type IN ('BUY', 'TRANSFER_IN')  THEN shares
        WHEN type IN ('SELL', 'TRANSFER_OUT') THEN -shares
        ELSE 0
      END) as net
      FROM xact WHERE account = '${PORT_B}' AND shares > 0
    `).get() as { net: number };

    expect(netShares.net).toBe(300000000); // 3 shares × 10^8
  });
});
