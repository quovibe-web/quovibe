// packages/api/src/routes/__tests__/transfer-format.test.ts
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
const PORT_1 = '33333333-3333-3333-3333-333333333333';
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
      open INTEGER,
      high INTEGER, low INTEGER, volume INTEGER
    );
    CREATE TABLE price (
      security TEXT, tstamp TEXT NOT NULL, value INTEGER NOT NULL,
      open INTEGER,
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

describe.skipIf(!hasSqliteBindings)('GAP-01: TRANSFER_BETWEEN_ACCOUNTS DB format', () => {
  let sqlite: ReturnType<typeof Database>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sqlite = createTestDb();
    sqlite.exec(`
      INSERT INTO account VALUES
        (NULL, '${DEP_A}', 'Deposit A', 'account', 'EUR', 0, NULL, '', NULL, 1, 1),
        (NULL, '${DEP_B}', 'Deposit B', 'account', 'EUR', 0, NULL, '', NULL, 2, 2);
    `);
    const db = drizzle(sqlite, { schema });
    app = createApp(db, sqlite);
  });

  it('source row is stored as TRANSFER_OUT with positive amount', async () => {
    await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 500,
      currencyCode: 'EUR',
      accountId: DEP_A,
      crossAccountId: DEP_B,
    }).expect(201);

    const source = sqlite
      .prepare(`SELECT * FROM xact WHERE account = '${DEP_A}'`)
      .get() as Record<string, unknown>;

    expect(source['type']).toBe('TRANSFER_OUT');
    // amount must be positive (500 × 100 = 50000)
    expect(source['amount']).toBe(50000);
  });

  it('destination row is stored as TRANSFER_IN with positive amount', async () => {
    await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 500,
      currencyCode: 'EUR',
      accountId: DEP_A,
      crossAccountId: DEP_B,
    }).expect(201);

    const dest = sqlite
      .prepare(`SELECT * FROM xact WHERE account = '${DEP_B}'`)
      .get() as Record<string, unknown>;

    expect(dest['type']).toBe('TRANSFER_IN');
    expect(dest['amount']).toBe(50000);
  });
});

describe.skipIf(!hasSqliteBindings)('GAP-01: TRANSFER_BETWEEN_ACCOUNTS balance impact', () => {
  let sqlite: ReturnType<typeof Database>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sqlite = createTestDb();
    sqlite.exec(`
      INSERT INTO account VALUES
        (NULL, '${DEP_A}', 'Deposit A', 'account', 'EUR', 0, NULL, '', NULL, 1, 1),
        (NULL, '${DEP_B}', 'Deposit B', 'account', 'EUR', 0, NULL, '', NULL, 2, 2);
      -- Seed dep-a with a DEPOSIT of 1000 EUR directly
      INSERT INTO xact VALUES
        (NULL, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'DEPOSIT', '2024-01-01', 'EUR', 100000, 0, NULL, NULL,
         '${DEP_A}', 'TEST', '2024-01-01', 0, 0, 'account', 1, 1);
    `);
    const db = drizzle(sqlite, { schema });
    app = createApp(db, sqlite);
  });

  it('source account balance decreases after transfer', async () => {
    await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 300,
      currencyCode: 'EUR',
      accountId: DEP_A,
      crossAccountId: DEP_B,
    }).expect(201);

    const res = await request(app).get(`/api/accounts/${DEP_A}`).expect(200);
    // Started with 1000, transferred 300 out → should be 700
    expect(parseFloat(res.body.balance)).toBe(700);
  });

  it('destination account balance increases after transfer', async () => {
    await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 300,
      currencyCode: 'EUR',
      accountId: DEP_A,
      crossAccountId: DEP_B,
    }).expect(201);

    const res = await request(app).get(`/api/accounts/${DEP_B}`).expect(200);
    // Started with 0, received 300 → should be 300
    expect(parseFloat(res.body.balance)).toBe(300);
  });
});

describe.skipIf(!hasSqliteBindings)('GAP-04: normalizeType + typeFilterCondition', () => {
  let sqlite: ReturnType<typeof Database>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sqlite = createTestDb();
    sqlite.exec(`
      INSERT INTO account VALUES
        (NULL, '${DEP_A}', 'Deposit A', 'account', 'EUR', 0, NULL, '', NULL, 1, 1),
        (NULL, '${DEP_B}', 'Deposit B', 'account', 'EUR', 0, NULL, '', NULL, 2, 2),
        (NULL, '${PORT_1}', 'Portfolio 1', 'portfolio', 'EUR', 0, '${DEP_A}', '', NULL, 3, 3);
      INSERT INTO security VALUES
        (NULL, '${SHARE_1}', 'Share 1', NULL, NULL, NULL, 'EUR', NULL, 0,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    `);
    // Simulate ppxml2db TRANSFER_IN rows for both cases after GAP-01 fix:
    // 1. DELIVERY_INBOUND: TRANSFER_IN on portfolio account (should appear as DELIVERY_INBOUND)
    // 2. Transfer dest: TRANSFER_IN on deposit account (should NOT appear as DELIVERY_INBOUND)
    sqlite.exec(`
      -- DELIVERY_INBOUND: TRANSFER_IN on portfolio account
      INSERT INTO xact VALUES
        (NULL, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'TRANSFER_IN', '2024-05-01', 'EUR', 100000, 500000000, NULL,
         '${SHARE_1}', '${PORT_1}', 'TEST', '2024-05-01', 0, 0, 'portfolio', 10, 10);
      -- Transfer destination (simulating GAP-01-fixed data): TRANSFER_IN on deposit account
      -- (this row is normally excluded as to_xact, but we test the type filter here)
      INSERT INTO xact VALUES
        (NULL, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'TRANSFER_IN', '2024-06-01', 'EUR', 50000, 0, NULL,
         NULL, '${DEP_B}', 'TEST', '2024-06-01', 0, 0, 'account', 11, 11);
      -- Link eeee as the to_xact of a source row (so it's excluded from lists)
      INSERT INTO xact VALUES
        (NULL, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'TRANSFER_OUT', '2024-06-01', 'EUR', 50000, 0, NULL,
         NULL, '${DEP_A}', 'TEST', '2024-06-01', 0, 0, 'account', 12, 12);
      INSERT INTO xact_cross_entry VALUES
        ('ffffffff-ffff-ffff-ffff-ffffffffffff', '${DEP_A}', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '${DEP_B}', 'account-transfer');
      -- Orphan TRANSFER_IN on a deposit account with NO cross_entry.
      -- This row is NOT excluded by the to_xact filter — only the acctype guard stops it
      -- from being classified as DELIVERY_INBOUND. This is the operative test for GAP-04.
      INSERT INTO xact VALUES
        (NULL, '00000000-0000-0000-0000-000000000001', 'TRANSFER_IN', '2024-07-01', 'EUR', 30000, 0, NULL,
         NULL, '${DEP_A}', 'TEST', '2024-07-01', 0, 0, 'account', 13, 13);
    `);
    const db = drizzle(sqlite, { schema });
    app = createApp(db, sqlite);
  });

  it('DELIVERY_INBOUND filter returns portfolio-side TRANSFER_IN', async () => {
    const res = await request(app)
      .get('/api/transactions?type=DELIVERY_INBOUND')
      .expect(200);

    const ids = res.body.data.map((t: Record<string, unknown>) => t['uuid']);
    expect(ids).toContain('dddddddd-dddd-dddd-dddd-dddddddddddd');
  });

  it('DELIVERY_INBOUND filter does not return deposit-side TRANSFER_IN (to_xact excluded)', async () => {
    const res = await request(app)
      .get('/api/transactions?type=DELIVERY_INBOUND')
      .expect(200);

    const ids = res.body.data.map((t: Record<string, unknown>) => t['uuid']);
    // eeee is excluded by the to_xact universal filter
    expect(ids).not.toContain('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
  });

  it('DELIVERY_INBOUND filter does not return orphan deposit-side TRANSFER_IN (acctype guard)', async () => {
    // 0000...0001 has type=TRANSFER_IN on a deposit account and NO cross_entry.
    // The to_xact filter does NOT exclude it. Only typeFilterCondition's acctype='portfolio'
    // guard prevents it from appearing as DELIVERY_INBOUND. This is the operative GAP-04 test.
    const res = await request(app)
      .get('/api/transactions?type=DELIVERY_INBOUND')
      .expect(200);

    const ids = res.body.data.map((t: Record<string, unknown>) => t['uuid']);
    expect(ids).not.toContain('00000000-0000-0000-0000-000000000001');
  });
});
