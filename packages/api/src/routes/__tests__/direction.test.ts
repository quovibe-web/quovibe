// Shows "Inbound Transfer" / "Outbound Transfer" based on the viewed account.
// quovibe implements this logic via the `direction` field computed by the API.
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
  `);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── TRANSFER_BETWEEN_ACCOUNTS ────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('direction — TRANSFER_BETWEEN_ACCOUNTS', () => {
  let app: ReturnType<typeof createApp>;
  let depositAId: string;
  let depositBId: string;

  beforeEach(async () => {
    const testDb = createTestDb();
    app = createApp(testDb.db as Parameters<typeof createApp>[0], testDb.sqlite);

    const resA = await request(app)
      .post('/api/accounts')
      .send({ name: 'Deposit A', type: 'DEPOSIT', currency: 'EUR' });
    depositAId = resA.body.id as string;

    const resB = await request(app)
      .post('/api/accounts')
      .send({ name: 'Deposit B', type: 'DEPOSIT', currency: 'EUR' });
    depositBId = resB.body.id as string;

    await request(app)
      .post('/api/transactions')
      .send({
        type: 'TRANSFER_BETWEEN_ACCOUNTS',
        accountId: depositAId,
        crossAccountId: depositBId,
        date: '2024-06-01',
        amount: 500,
      });
  });

  it('scenario 1 — GET /api/transactions?account=source → direction=outbound, amount<0', async () => {
    const res = await request(app).get(`/api/transactions?account=${depositAId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('outbound');
    expect(parseFloat(tx.amount)).toBeLessThan(0);
    expect(tx.type).toBe('TRANSFER_BETWEEN_ACCOUNTS');
  });

  it('scenario 2 — GET /api/transactions?account=dest → direction=inbound, amount>0', async () => {
    const res = await request(app).get(`/api/transactions?account=${depositBId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('inbound');
    expect(parseFloat(tx.amount)).toBeGreaterThan(0);
  });

  it('scenario 7 — GET /api/transactions (no filter) → direction=null, amount>0 (abs)', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBeNull();
    // Global list (no account context): always abs() for consistent display
    expect(parseFloat(tx.amount)).toBeGreaterThan(0);
  });

  it('scenario 1b — GET /api/accounts/:id/transactions source → direction=outbound', async () => {
    const res = await request(app).get(`/api/accounts/${depositAId}/transactions`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('outbound');
    expect(parseFloat(tx.amount)).toBeLessThan(0);
  });

  it('scenario 2b — GET /api/accounts/:id/transactions dest → direction=inbound', async () => {
    const res = await request(app).get(`/api/accounts/${depositBId}/transactions`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('inbound');
    expect(parseFloat(tx.amount)).toBeGreaterThan(0);
  });
});

// ─── SECURITY_TRANSFER ───────────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('direction — SECURITY_TRANSFER', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];
  let portfolioAId: string;
  let portfolioBId: string;
  const secId = 'a0000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Deposit Shared', type: 'DEPOSIT', currency: 'EUR' });
    const depositId = depositRes.body.id as string;

    const portARes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio A', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioAId = portARes.body.id as string;

    const portBRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio B', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioBId = portBRes.body.id as string;

    sqlite.prepare(
      `INSERT INTO security (uuid, name, currency) VALUES (?, 'Test Security', 'EUR')`
    ).run(secId);

    await request(app)
      .post('/api/transactions')
      .send({
        type: 'SECURITY_TRANSFER',
        accountId: portfolioAId,
        crossAccountId: portfolioBId,
        securityId: secId,
        date: '2024-06-01',
        shares: 100,
        amount: 0,
      });
  });

  it('scenario 3 — source portfolio → direction=outbound, shares<0', async () => {
    const res = await request(app).get(`/api/transactions?account=${portfolioAId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('outbound');
    expect(parseFloat(tx.shares)).toBeLessThan(0);
  });

  it('scenario 4 — destination portfolio → direction=inbound, shares>0', async () => {
    const res = await request(app).get(`/api/transactions?account=${portfolioBId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('inbound');
    expect(parseFloat(tx.shares)).toBeGreaterThan(0);
  });

  it('scenario 3b — /api/accounts/:id/transactions source → direction=outbound, shares<0', async () => {
    const res = await request(app).get(`/api/accounts/${portfolioAId}/transactions`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('outbound');
    expect(parseFloat(tx.shares)).toBeLessThan(0);
  });

  it('scenario 4b — /api/accounts/:id/transactions dest → direction=inbound, shares>0', async () => {
    const res = await request(app).get(`/api/accounts/${portfolioBId}/transactions`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('inbound');
    expect(parseFloat(tx.shares)).toBeGreaterThan(0);
  });
});

// ─── DELIVERY_INBOUND / DELIVERY_OUTBOUND ─────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('direction — DELIVERY_INBOUND / DELIVERY_OUTBOUND', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];
  let portfolioId: string;
  const secId = 'a0000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Deposit', type: 'DEPOSIT', currency: 'EUR' });
    const depositId = depositRes.body.id as string;

    const portRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = portRes.body.id as string;

    sqlite.prepare(
      `INSERT INTO security (uuid, name, currency) VALUES (?, 'Delivery Security', 'EUR')`
    ).run(secId);

    await request(app)
      .post('/api/transactions')
      .send({ type: 'DELIVERY_INBOUND', accountId: portfolioId, securityId: secId, date: '2024-06-01', shares: 50, amount: 0 });
    await request(app)
      .post('/api/transactions')
      .send({ type: 'DELIVERY_OUTBOUND', accountId: portfolioId, securityId: secId, date: '2024-06-02', shares: 30, amount: 0 });
  });

  it('scenario 5 — DELIVERY_INBOUND with account filter → direction=inbound', async () => {
    const res = await request(app).get(`/api/transactions?account=${portfolioId}&type=DELIVERY_INBOUND`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('inbound');
  });

  it('scenario 6 — DELIVERY_OUTBOUND with account filter → direction=outbound', async () => {
    const res = await request(app).get(`/api/transactions?account=${portfolioId}&type=DELIVERY_OUTBOUND`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('outbound');
  });

  it('delivery direction is non-null even without account filter (unconditional)', async () => {
    const res = await request(app).get('/api/transactions?type=DELIVERY_INBOUND');
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    // Unlike transfers, delivery direction is set unconditionally — no ?account= needed
    expect(tx.direction).toBe('inbound');
  });
});

// ─── ppxml2db import style (positive amounts on BOTH rows) ────────────────────

// ppxml2db exports TRANSFER_BETWEEN_ACCOUNTS with amount>0 on BOTH from_xact and to_xact rows.
// quovibe must show: source=outbound/negative, dest=inbound/positive — regardless of raw DB sign.
describe.skipIf(!hasSqliteBindings)('direction — ppxml2db positive-amount rows', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];
  let depositAId: string;
  let depositBId: string;

  const fromXactId = 'f0000000-0000-4000-8000-000000000001';
  const toXactId   = 'f0000000-0000-4000-8000-000000000002';

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);

    // Create two deposit accounts via API
    const resA = await request(app)
      .post('/api/accounts')
      .send({ name: 'Deposit A', type: 'DEPOSIT', currency: 'EUR' });
    depositAId = resA.body.id as string;

    const resB = await request(app)
      .post('/api/accounts')
      .send({ name: 'Deposit B', type: 'DEPOSIT', currency: 'EUR' });
    depositBId = resB.body.id as string;

    // Insert raw xact rows with POSITIVE amounts on BOTH sides — simulates ppxml2db import
    // (the XML stores absolute values, ppxml2db writes them as-is without sign normalization)
    const amountRaw = 430000; // 4300.00 EUR in hecto-cents (amount * 100)
    sqlite.prepare(`
      INSERT INTO xact (uuid, type, date, currency, amount, shares, account, fees, taxes)
      VALUES (?, 'TRANSFER_BETWEEN_ACCOUNTS', '2024-06-01', 'EUR', ?, 0, ?, 0, 0)
    `).run(fromXactId, amountRaw, depositAId);

    sqlite.prepare(`
      INSERT INTO xact (uuid, type, date, currency, amount, shares, account, fees, taxes)
      VALUES (?, 'TRANSFER_BETWEEN_ACCOUNTS', '2024-06-01', 'EUR', ?, 0, ?, 0, 0)
    `).run(toXactId, amountRaw, depositBId);

    // Cross-entry: from=A (source), to=B (destination)
    sqlite.prepare(`
      INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type)
      VALUES (?, ?, ?, ?, 'TRANSFER_BETWEEN_ACCOUNTS')
    `).run(fromXactId, depositAId, toXactId, depositBId);
  });

  it('ppxml2db source row → direction=outbound, amount<0', async () => {
    const res = await request(app).get(`/api/transactions?account=${depositAId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('outbound');
    expect(parseFloat(tx.amount)).toBeLessThan(0);
  });

  it('ppxml2db dest row → direction=inbound, amount>0', async () => {
    const res = await request(app).get(`/api/transactions?account=${depositBId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('inbound');
    expect(parseFloat(tx.amount)).toBeGreaterThan(0);
  });

  it('ppxml2db source account detail → direction=outbound, amount<0', async () => {
    const res = await request(app).get(`/api/accounts/${depositAId}/transactions`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('outbound');
    expect(parseFloat(tx.amount)).toBeLessThan(0);
  });

  it('ppxml2db dest account detail → direction=inbound, amount>0', async () => {
    const res = await request(app).get(`/api/accounts/${depositBId}/transactions`);
    expect(res.status).toBe(200);
    const tx = res.body.data[0];
    expect(tx.direction).toBe('inbound');
    expect(parseFloat(tx.amount)).toBeGreaterThan(0);
  });
});
