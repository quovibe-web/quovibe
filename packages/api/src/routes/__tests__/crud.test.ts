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

    CREATE TABLE taxonomy_assignment (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy TEXT,
      item TEXT,
      item_type TEXT
    );

    CREATE TABLE taxonomy_assignment_data (
      assignment INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY,
      tstamp TEXT,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER
    );

    CREATE TABLE price (
      security TEXT,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
      open INTEGER,
      high INTEGER,
      low INTEGER,
      volume INTEGER,
      PRIMARY KEY (security, tstamp)
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Test 1: CRUD Account ────────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('CRUD accounts', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  it('creates, reads, updates an account', async () => {
    // CREATE
    const createRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Conto Corrente', type: 'DEPOSIT', currency: 'EUR' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Conto Corrente');
    expect(createRes.body.balance).toBe('0');
    const accountId = createRes.body.id as string;

    // READ single
    const getRes = await request(app).get(`/api/accounts/${accountId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(accountId);

    // READ list — includes transactionCount
    const listRes = await request(app).get('/api/accounts');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].transactionCount).toBe(0);

    // UPDATE
    const updateRes = await request(app)
      .put(`/api/accounts/${accountId}`)
      .send({ name: 'Conto Aggiornato' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Conto Aggiornato');
  });

  it('deletes account with no transactions → 204 + account gone', async () => {
    const createRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Test Delete', type: 'DEPOSIT', currency: 'EUR' });
    expect(createRes.status).toBe(201);
    const accountId = createRes.body.id as string;

    const deleteRes = await request(app).delete(`/api/accounts/${accountId}`);
    expect(deleteRes.status).toBe(204);

    // Account is gone (hard delete)
    const getRes = await request(app).get(`/api/accounts/${accountId}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 409 when deleting account with transactions', async () => {
    const createRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Test With Txn', type: 'DEPOSIT', currency: 'EUR' });
    expect(createRes.status).toBe(201);
    const accountId = createRes.body.id as string;

    // Insert a transaction directly into xact table
    sqlite.prepare(
      `INSERT INTO xact (uuid, type, date, account, currency, amount, shares, acctype, _xmlid, _order)
       VALUES ('txn-test-001', 'DEPOSIT', '2024-01-01', ?, 'EUR', 10000, 0, 'account', 1, 1)`
    ).run(accountId);

    const deleteRes = await request(app).delete(`/api/accounts/${accountId}`);
    expect(deleteRes.status).toBe(409);
    expect(deleteRes.body.error).toMatch(/transactions/i);
  });

  it('returns 404 for unknown account', async () => {
    const res = await request(app).get('/api/accounts/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

// ─── Test 2: BUY Transaction ─────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('POST /api/transactions BUY', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositAccountId: string;
  let securitiesAccountId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    // Create deposit account first
    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositAccountId = depositRes.body.id as string;

    // Create securities account referencing the deposit account
    const secRes = await request(app)
      .post('/api/accounts')
      .send({
        name: 'Portfolio',
        type: 'SECURITIES',
        currency: 'EUR',
        referenceAccountId: depositAccountId,
      });
    securitiesAccountId = secRes.body.id as string;
  });

  it('creates BUY transaction with cross entries and units', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY',
        date: '2024-01-15',
        amount: 1000,
        shares: 10,
        fees: 5,
        taxes: 2,
        accountId: securitiesAccountId,
        currencyCode: 'EUR',
      });

    expect(res.status).toBe(201);
    const xactId = res.body.uuid as string;

    // Verify xact row
    const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(xactId) as
      | Record<string, unknown>
      | undefined;
    expect(xact).toBeDefined();
    expect(xact!.type).toBe('BUY');

    // Verify cross entry: one row with from_acc + to_acc
    const crossEntries = sqlite
      .prepare('SELECT * FROM xact_cross_entry WHERE from_xact = ?')
      .all(xactId) as Record<string, unknown>[];
    expect(crossEntries).toHaveLength(1);
    expect(crossEntries[0].from_acc).toBe(securitiesAccountId);
    expect(crossEntries[0].to_acc).toBe(depositAccountId);

    // Verify units: FEE + TAX (GROSS_VALUE is no longer stored; gross is reconstructed from amount ± fees ± taxes)
    const units = sqlite
      .prepare('SELECT * FROM xact_unit WHERE xact = ?')
      .all(xactId) as Record<string, unknown>[];
    const unitTypes = units.map(u => u.type as string);
    expect(unitTypes).not.toContain('GROSS_VALUE');
    expect(unitTypes).toContain('FEE');
    expect(unitTypes).toContain('TAX');
  });

  it('BUY cash-side row has security = same UUID as securities-side (ppxml2db parity)', async () => {
    const SEC_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    sqlite.prepare("INSERT INTO security (uuid, name) VALUES (?, 'TestSec')").run(SEC_UUID);

    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-01-15', amount: 1000, shares: 10,
        securityId: SEC_UUID, accountId: securitiesAccountId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    // D4 fix: ppxml2db stores the security UUID on both the securities-side and cash-side rows
    const cashRow = sqlite
      .prepare("SELECT security FROM xact WHERE type = 'BUY' AND shares = 0")
      .get() as { security: string | null };
    expect(cashRow.security).toBe(SEC_UUID);
  });

  it('rejects BUY without shares', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-01-15', amount: 1000,
        securityId: 'sec-1', accountId: 'portfolio-1',
      });
    expect(res.status).toBe(400);
  });
});

// ─── Test 3: Cash routing from securities account ────────────────────────────

describe.skipIf(!hasSqliteBindings)('Cash routing: securities account → deposit account', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositAccountId: string;
  let securitiesAccountId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositAccountId = depositRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositAccountId });
    securitiesAccountId = secRes.body.id as string;
  });

  it('DEPOSIT from securities account → xact.account = deposit account', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'DEPOSIT', date: '2024-01-15', amount: 500, accountId: securitiesAccountId, currencyCode: 'EUR' });

    expect(res.status).toBe(201);
    const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(res.body.uuid as string) as Record<string, unknown>;
    expect(xact.account).toBe(depositAccountId);
    expect(xact.acctype).toBe('account');
  });

  it('DIVIDEND from securities account → xact.account = deposit account, security preserved', async () => {
    const SEC_TEST_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    sqlite.prepare("INSERT INTO security (uuid, name) VALUES (?, 'ACME')").run(SEC_TEST_UUID);
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'DIVIDEND', date: '2024-03-01', amount: 100, accountId: securitiesAccountId, securityId: SEC_TEST_UUID, currencyCode: 'EUR' });

    expect(res.status).toBe(201);
    const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(res.body.uuid as string) as Record<string, unknown>;
    expect(xact.account).toBe(depositAccountId);
    expect(xact.security).toBe(SEC_TEST_UUID);
  });

  it('BUY from securities account → xact.account remains securities account (no regression)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'BUY', date: '2024-01-15', amount: 1000, shares: 10, accountId: securitiesAccountId, currencyCode: 'EUR' });

    expect(res.status).toBe(201);
    const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(res.body.uuid as string) as Record<string, unknown>;
    expect(xact.account).toBe(securitiesAccountId);
  });

  it('DELIVERY_INBOUND from securities account → xact.account remains securities account', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'DELIVERY_INBOUND', date: '2024-01-15', amount: 0, shares: 5, accountId: securitiesAccountId, currencyCode: 'EUR' });

    expect(res.status).toBe(201);
    const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(res.body.uuid as string) as Record<string, unknown>;
    expect(xact.account).toBe(securitiesAccountId);
  });

  it('DEPOSIT from portfolio account with no referenceAccount → 400', async () => {
    // Create orphan portfolio account (no referenceAccount)
    const orphanRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Orphan Portfolio', type: 'SECURITIES' });
    const orphanId = orphanRes.body.id as string;

    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'DEPOSIT', date: '2024-01-15', amount: 500, accountId: orphanId, currencyCode: 'EUR' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no linked deposit account/i);
  });
});

// ─── Test 5: Transaction Atomicity ───────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('Transaction atomicity', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    // Enable FK checks to force violations
    sqlite.pragma('foreign_keys = ON');
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  it('rolls back all writes when transaction fails due to invalid data', async () => {
    const countBefore = (sqlite.prepare('SELECT COUNT(*) as n FROM xact').get() as { n: number }).n;

    // Attempt BUY with invalid type to trigger Zod validation error
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'INVALID_TYPE',
        date: '2024-01-15',
        amount: 1000,
        accountId: '00000000-0000-0000-0000-000000000000',
      });

    // Should fail with validation error
    expect(res.status).toBe(400);

    // Nothing written to xact
    const countAfter = (sqlite.prepare('SELECT COUNT(*) as n FROM xact').get() as { n: number }).n;
    expect(countAfter).toBe(countBefore);
  });
});

// ─── Test: SECURITY_TRANSFER ─────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('POST /api/transactions SECURITY_TRANSFER', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let portfolioAId: string;
  let portfolioBId: string;
  let depositAId: string;
  let securityId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app).post('/api/accounts').send({ name: 'Cash A', type: 'DEPOSIT', currency: 'EUR' });
    depositAId = depRes.body.id as string;
    const portARes = await request(app).post('/api/accounts').send({ name: 'Portfolio A', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositAId });
    portfolioAId = portARes.body.id as string;
    const portBRes = await request(app).post('/api/accounts').send({ name: 'Portfolio B', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositAId });
    portfolioBId = portBRes.body.id as string;
    securityId = '00000000-0000-0000-0001-000000000001';
    sqlite.prepare("INSERT INTO security (uuid, name, currency) VALUES (?, 'ACME', 'EUR')").run(securityId);
  });

  it('creates 2 xact rows (from: TRANSFER_OUT positive shares, to: TRANSFER_IN positive shares) + genuine cross_entry', async () => {
    // ppxml2db format uses TRANSFER_OUT/TRANSFER_IN with positive shares
    const res = await request(app).post('/api/transactions').send({
      type: 'SECURITY_TRANSFER',
      date: '2024-06-01',
      amount: 0,
      shares: 5,
      accountId: portfolioAId,
      crossAccountId: portfolioBId,
      securityId,
      currencyCode: 'EUR',
    });

    expect(res.status).toBe(201);
    const fromId = res.body.uuid as string;

    // from-row: TRANSFER_OUT with positive shares (direction encoded in type, not sign)
    const fromRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(fromId) as Record<string, unknown>;
    expect(fromRow).toBeDefined();
    expect(fromRow.type).toBe('TRANSFER_OUT');
    expect(Number(fromRow.shares)).toBeGreaterThan(0);
    expect(fromRow.account).toBe(portfolioAId);

    // cross_entry: genuine (from_xact != to_xact)
    const cross = sqlite.prepare('SELECT * FROM xact_cross_entry WHERE from_xact = ?').get(fromId) as Record<string, unknown>;
    expect(cross).toBeDefined();
    expect(cross.from_xact).not.toBe(cross.to_xact);
    expect(cross.to_acc).toBe(portfolioBId);

    // to-row: TRANSFER_IN with positive shares, same security
    const toRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(cross.to_xact as string) as Record<string, unknown>;
    expect(toRow).toBeDefined();
    expect(toRow.type).toBe('TRANSFER_IN');
    expect(Number(toRow.shares)).toBeGreaterThan(0);
    expect(toRow.account).toBe(portfolioBId);
    expect(toRow.security).toBe(securityId);
  });

  it('GET /api/transactions excludes the to-row', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'SECURITY_TRANSFER',
      date: '2024-06-01',
      amount: 0,
      shares: 5,
      accountId: portfolioAId,
      crossAccountId: portfolioBId,
      securityId,
      currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);

    const listRes = await request(app).get('/api/transactions');
    expect(listRes.status).toBe(200);
    const cross = sqlite.prepare('SELECT to_xact FROM xact_cross_entry WHERE from_xact = ?').get(res.body.uuid as string) as { to_xact: string };
    const ids = (listRes.body.data as { uuid: string }[]).map(t => t.uuid);
    expect(ids).toContain(res.body.uuid as string);
    expect(ids).not.toContain(cross.to_xact);
  });

  it('DELETE removes both xact rows and cross_entry', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'SECURITY_TRANSFER',
      date: '2024-06-01',
      amount: 0,
      shares: 5,
      accountId: portfolioAId,
      crossAccountId: portfolioBId,
      securityId,
      currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);
    const fromId = res.body.uuid as string;
    const cross = sqlite.prepare('SELECT to_xact FROM xact_cross_entry WHERE from_xact = ?').get(fromId) as { to_xact: string };
    const toId = cross.to_xact;

    const delRes = await request(app).delete(`/api/transactions/${fromId}`);
    expect(delRes.status).toBe(204);

    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(fromId)).toBeUndefined();
    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(toId)).toBeUndefined();
    expect(sqlite.prepare('SELECT from_xact FROM xact_cross_entry WHERE from_xact = ?').get(fromId)).toBeUndefined();
  });
});

// ─── Test: TRANSFER_BETWEEN_ACCOUNTS ─────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('POST /api/transactions TRANSFER_BETWEEN_ACCOUNTS', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositAId: string;
  let depositBId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depARes = await request(app).post('/api/accounts').send({ name: 'Cash A', type: 'DEPOSIT', currency: 'EUR' });
    depositAId = depARes.body.id as string;
    const depBRes = await request(app).post('/api/accounts').send({ name: 'Cash B', type: 'DEPOSIT', currency: 'EUR' });
    depositBId = depBRes.body.id as string;
  });

  it('creates 2 xact rows (from: TRANSFER_OUT positive amount, to: TRANSFER_IN positive amount) + genuine cross_entry', async () => {
    // ppxml2db format uses TRANSFER_OUT/TRANSFER_IN with positive amounts
    const res = await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 200,
      accountId: depositAId,
      crossAccountId: depositBId,
      currencyCode: 'EUR',
    });

    expect(res.status).toBe(201);
    const fromId = res.body.uuid as string;

    // from-row: TRANSFER_OUT with positive amount (direction encoded in type, not sign)
    const fromRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(fromId) as Record<string, unknown>;
    expect(fromRow.type).toBe('TRANSFER_OUT');
    expect(Number(fromRow.amount)).toBeGreaterThan(0);
    expect(fromRow.account).toBe(depositAId);

    // genuine cross_entry
    const cross = sqlite.prepare('SELECT * FROM xact_cross_entry WHERE from_xact = ?').get(fromId) as Record<string, unknown>;
    expect(cross.from_xact).not.toBe(cross.to_xact);
    expect(cross.to_acc).toBe(depositBId);

    // to-row: TRANSFER_IN with positive amount
    const toRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(cross.to_xact as string) as Record<string, unknown>;
    expect(toRow.type).toBe('TRANSFER_IN');
    expect(Number(toRow.amount)).toBeGreaterThan(0);
    expect(toRow.account).toBe(depositBId);
  });

  it('GET /api/transactions type normalized to TRANSFER_BETWEEN_ACCOUNTS', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 200,
      accountId: depositAId,
      crossAccountId: depositBId,
      currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);

    const listRes = await request(app).get('/api/transactions');
    const txn = (listRes.body.data as { uuid: string; type: string }[]).find(t => t.uuid === (res.body.uuid as string));
    expect(txn?.type).toBe('TRANSFER_BETWEEN_ACCOUNTS');
  });

  it('GET /api/transactions excludes the to-row', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 200,
      accountId: depositAId,
      crossAccountId: depositBId,
      currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);

    const listRes = await request(app).get('/api/transactions');
    const cross = sqlite.prepare('SELECT to_xact FROM xact_cross_entry WHERE from_xact = ?').get(res.body.uuid as string) as { to_xact: string };
    const ids = (listRes.body.data as { uuid: string }[]).map(t => t.uuid);
    expect(ids).not.toContain(cross.to_xact);
  });

  it('DELETE removes both xact rows', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'TRANSFER_BETWEEN_ACCOUNTS',
      date: '2024-06-01',
      amount: 200,
      accountId: depositAId,
      crossAccountId: depositBId,
      currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);
    const fromId = res.body.uuid as string;
    const cross = sqlite.prepare('SELECT to_xact FROM xact_cross_entry WHERE from_xact = ?').get(fromId) as { to_xact: string };

    await request(app).delete(`/api/transactions/${fromId}`);

    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(fromId)).toBeUndefined();
    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(cross.to_xact)).toBeUndefined();
  });

  it('rejects TRANSFER_BETWEEN_ACCOUNTS without crossAccountId', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'TRANSFER_BETWEEN_ACCOUNTS', date: '2024-01-15', amount: 500,
        accountId: depositAId,
      });
    expect(res.status).toBe(400);
  });
});

// ─── Test: SELL Transaction ───────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('POST /api/transactions SELL', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositAccountId: string;
  let securitiesAccountId: string;
  let securityId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depositRes = await request(app).post('/api/accounts').send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositAccountId = depositRes.body.id as string;
    const secRes = await request(app).post('/api/accounts').send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositAccountId });
    securitiesAccountId = secRes.body.id as string;
    securityId = '00000000-0000-0000-0002-000000000001';
    sqlite.prepare("INSERT INTO security (uuid, name, currency) VALUES (?, 'ACME', 'EUR')").run(securityId);
  });

  it('creates SELL with 2 xact rows + cross_entry + units (FEE, TAX)', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'SELL',
      date: '2024-03-01',
      amount: 950,
      shares: 10,
      fees: 5,
      taxes: 2,
      accountId: securitiesAccountId,
      securityId,
      currencyCode: 'EUR',
    });

    expect(res.status).toBe(201);
    const xactId = res.body.uuid as string;

    // Main xact row
    const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(xactId) as Record<string, unknown>;
    expect(xact.type).toBe('SELL');
    expect(xact.account).toBe(securitiesAccountId);

    // Cash counter-entry row (shares = 0)
    const cross = sqlite.prepare('SELECT * FROM xact_cross_entry WHERE from_xact = ?').get(xactId) as Record<string, unknown>;
    expect(cross.from_xact).not.toBe(cross.to_xact);
    const cashRow = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(cross.to_xact as string) as Record<string, unknown>;
    expect(Number(cashRow.shares)).toBe(0);
    expect(cashRow.account).toBe(depositAccountId);

    // Units: FEE + TAX only (GROSS_VALUE is no longer stored)
    const units = sqlite.prepare('SELECT type FROM xact_unit WHERE xact = ?').all(xactId) as { type: string }[];
    const unitTypes = units.map(u => u.type);
    expect(unitTypes).not.toContain('GROSS_VALUE');
    expect(unitTypes).toContain('FEE');
    expect(unitTypes).toContain('TAX');
  });

  it('DELETE removes main row, cash-side row, cross_entry and units', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'SELL', date: '2024-03-01', amount: 950, shares: 10, fees: 5,
      accountId: securitiesAccountId, securityId, currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);
    const xactId = res.body.uuid as string;
    const cross = sqlite.prepare('SELECT to_xact FROM xact_cross_entry WHERE from_xact = ?').get(xactId) as { to_xact: string };

    await request(app).delete(`/api/transactions/${xactId}`);

    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(xactId)).toBeUndefined();
    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(cross.to_xact)).toBeUndefined();
    expect(sqlite.prepare('SELECT from_xact FROM xact_cross_entry WHERE from_xact = ?').get(xactId)).toBeUndefined();
    expect(sqlite.prepare('SELECT xact FROM xact_unit WHERE xact = ?').get(xactId)).toBeUndefined();
  });

  it('SELL excluded from list via universal filter (cash-side has shares=0)', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'SELL', date: '2024-03-01', amount: 950, shares: 10,
      accountId: securitiesAccountId, securityId, currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);
    const listRes = await request(app).get('/api/transactions');
    const cross = sqlite.prepare('SELECT to_xact FROM xact_cross_entry WHERE from_xact = ?').get(res.body.uuid as string) as { to_xact: string };
    const ids = (listRes.body.data as { uuid: string }[]).map(t => t.uuid);
    expect(ids).toContain(res.body.uuid as string);
    expect(ids).not.toContain(cross.to_xact);
  });
});

// ─── Test: Group B — Cash-only types ─────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('Group B: cash-only transaction types', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app).post('/api/accounts').send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;
    const portRes = await request(app).post('/api/accounts').send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = portRes.body.id as string;
  });

  const cashOnlyTypes = [
    'REMOVAL', 'INTEREST', 'INTEREST_CHARGE', 'FEES', 'FEES_REFUND', 'TAXES', 'TAX_REFUND',
  ] as const;

  for (const type of cashOnlyTypes) {
    it(`${type}: creates 1 xact row with account=deposit, no portfolio row`, async () => {
      const countBefore = (sqlite.prepare('SELECT COUNT(*) as n FROM xact').get() as { n: number }).n;

      const res = await request(app).post('/api/transactions').send({
        type,
        date: '2024-04-01',
        amount: 100,
        accountId: depositId,
        currencyCode: 'EUR',
      });

      expect(res.status).toBe(201);
      const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(res.body.uuid as string) as Record<string, unknown>;
      expect(xact.account).toBe(depositId);

      // Only 1 new row in xact (no dest-row for cash-only types)
      const countAfter = (sqlite.prepare('SELECT COUNT(*) as n FROM xact').get() as { n: number }).n;
      expect(countAfter).toBe(countBefore + 1);
    });
  }

  it('REMOVAL: UPDATE changes amount correctly', async () => {
    const createRes = await request(app).post('/api/transactions').send({
      type: 'REMOVAL', date: '2024-04-01', amount: 100, accountId: depositId, currencyCode: 'EUR',
    });
    expect(createRes.status).toBe(201);
    const id = createRes.body.uuid as string;

    const updateRes = await request(app).put(`/api/transactions/${id}`).send({
      type: 'REMOVAL', date: '2024-04-01', amount: 150, accountId: depositId, currencyCode: 'EUR',
    });
    expect(updateRes.status).toBe(200);

    const xact = sqlite.prepare('SELECT amount FROM xact WHERE uuid = ?').get(id) as { amount: number };
    expect(xact.amount).toBe(150 * 100);
  });

  it('REMOVAL: DELETE removes xact row', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'REMOVAL', date: '2024-04-01', amount: 100, accountId: depositId, currencyCode: 'EUR',
    });
    const id = res.body.uuid as string;
    await request(app).delete(`/api/transactions/${id}`);
    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(id)).toBeUndefined();
  });

  it('cash-only type from portfolio account routes to deposit (no portfolio row)', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'INTEREST', date: '2024-04-01', amount: 50, accountId: portfolioId, currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);
    const xact = sqlite.prepare('SELECT account FROM xact WHERE uuid = ?').get(res.body.uuid as string) as { account: string };
    expect(xact.account).toBe(depositId); // routed to referenceAccount
  });
});

// ─── Test: DELIVERY_OUTBOUND ──────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('POST /api/transactions DELIVERY_OUTBOUND', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let portfolioId: string;
  let depositId: string;
  let securityId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app).post('/api/accounts').send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;
    const portRes = await request(app).post('/api/accounts').send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = portRes.body.id as string;
    securityId = '00000000-0000-0000-0003-000000000001';
    sqlite.prepare("INSERT INTO security (uuid, name, currency) VALUES (?, 'ACME', 'EUR')").run(securityId);
  });

  it('creates 1 xact row with account=portfolio, no deposit row', async () => {
    const countBefore = (sqlite.prepare('SELECT COUNT(*) as n FROM xact').get() as { n: number }).n;

    const res = await request(app).post('/api/transactions').send({
      type: 'DELIVERY_OUTBOUND',
      date: '2024-05-01',
      amount: 500,
      shares: 10,
      accountId: portfolioId,
      securityId,
      currencyCode: 'EUR',
    });

    expect(res.status).toBe(201);
    const xact = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?').get(res.body.uuid as string) as Record<string, unknown>;
    expect(xact.account).toBe(portfolioId);
    const countAfter = (sqlite.prepare('SELECT COUNT(*) as n FROM xact').get() as { n: number }).n;
    expect(countAfter).toBe(countBefore + 1);
  });

  it('DELIVERY_INBOUND type normalized in list response (TRANSFER_IN → DELIVERY_INBOUND)', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'DELIVERY_INBOUND', date: '2024-05-01', amount: 500, shares: 10,
      accountId: portfolioId, securityId, currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);

    const listRes = await request(app).get('/api/transactions');
    const txn = (listRes.body.data as { uuid: string; type: string }[]).find(t => t.uuid === (res.body.uuid as string));
    expect(txn?.type).toBe('DELIVERY_INBOUND');
  });

  it('type normalized to DELIVERY_OUTBOUND in list response', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'DELIVERY_OUTBOUND', date: '2024-05-01', amount: 500, shares: 10,
      accountId: portfolioId, securityId, currencyCode: 'EUR',
    });
    expect(res.status).toBe(201);

    const listRes = await request(app).get('/api/transactions');
    const txn = (listRes.body.data as { uuid: string; type: string }[]).find(t => t.uuid === (res.body.uuid as string));
    expect(txn?.type).toBe('DELIVERY_OUTBOUND');
  });

  it('DELETE removes xact and units', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'DELIVERY_OUTBOUND', date: '2024-05-01', amount: 500, shares: 10,
      accountId: portfolioId, securityId, currencyCode: 'EUR',
    });
    const id = res.body.uuid as string;
    await request(app).delete(`/api/transactions/${id}`);
    expect(sqlite.prepare('SELECT uuid FROM xact WHERE uuid = ?').get(id)).toBeUndefined();
  });
});
