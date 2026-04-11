/**
 * Tests for currency handling on accounts:
 *   - DEPOSIT accounts own their currency
 *   - SECURITIES (portfolio) accounts have currency = NULL in the DB;
 *     the API resolves it from the referenceAccount on every read.
 *
 * Securities accounts have no own currency;
 * currency is inherited from the linked deposit account (referenceAccount).
 */
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
      currency TEXT,
      isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT,
      updatedAt TEXT NOT NULL DEFAULT '',
      note TEXT,
      _xmlid INTEGER NOT NULL DEFAULT 0,
      _order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE account_attr (
      account TEXT,
      attr_uuid TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'string',
      value TEXT,
      seq INTEGER DEFAULT 0,
      PRIMARY KEY (account, attr_uuid)
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

    CREATE TABLE price (
      security TEXT,
      tstamp TEXT NOT NULL,
      value INTEGER NOT NULL,
      PRIMARY KEY (security, tstamp)
    );

    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY,
      tstamp TEXT,
      value INTEGER NOT NULL
    );

    CREATE TABLE property (
      name TEXT PRIMARY KEY,
      special INTEGER NOT NULL DEFAULT 0,
      value TEXT NOT NULL
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe.skipIf(!hasSqliteBindings)('Portfolio currency model', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  it('stores currency = NULL in DB when creating a portfolio', async () => {
    // First create a deposit account
    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Conto EUR', type: 'DEPOSIT', currency: 'EUR' });
    expect(depositRes.status).toBe(201);
    const depositId = depositRes.body.id as string;

    // Create a portfolio referencing the deposit — no currency sent
    const portfolioRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio Azionario', type: 'SECURITIES', referenceAccountId: depositId });
    expect(portfolioRes.status).toBe(201);
    const portfolioId = portfolioRes.body.id as string;

    // DB must have currency = NULL for the portfolio
    const row = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(portfolioId) as { currency: string | null };
    expect(row.currency).toBeNull();
  });

  it('ignores currency sent by client when creating a portfolio', async () => {
    // Even if the client sends a currency for a portfolio, the API must ignore it
    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Conto USD', type: 'DEPOSIT', currency: 'USD' });
    const depositId = depositRes.body.id as string;

    const portfolioRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio USD', type: 'SECURITIES', currency: 'USD', referenceAccountId: depositId });
    expect(portfolioRes.status).toBe(201);
    const portfolioId = portfolioRes.body.id as string;

    const row = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(portfolioId) as { currency: string | null };
    expect(row.currency).toBeNull();
  });

  it('GET portfolio resolves currency from referenceAccount', async () => {
    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Conto GBP', type: 'DEPOSIT', currency: 'GBP' });
    const depositId = depositRes.body.id as string;

    const portfolioRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio GBP', type: 'SECURITIES', referenceAccountId: depositId });
    const portfolioId = portfolioRes.body.id as string;

    const getRes = await request(app).get(`/api/accounts/${portfolioId}`);
    expect(getRes.status).toBe(200);
    // API must return the referenceAccount's currency, not null
    expect(getRes.body.currency).toBe('GBP');
  });

  it('GET /api/accounts list resolves currency for portfolios', async () => {
    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Conto CHF', type: 'DEPOSIT', currency: 'CHF' });
    const depositId = depositRes.body.id as string;

    await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio CHF', type: 'SECURITIES', referenceAccountId: depositId });

    const listRes = await request(app).get('/api/accounts');
    expect(listRes.status).toBe(200);

    const deposit = listRes.body.find((a: { type: string }) => a.type === 'account');
    const portfolio = listRes.body.find((a: { type: string }) => a.type === 'portfolio');

    expect(deposit.currency).toBe('CHF');
    // Portfolio must show resolved currency from deposit
    expect(portfolio.currency).toBe('CHF');
  });

  it('PUT portfolio ignores currency update (portfolio never owns a currency)', async () => {
    const depositRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Conto EUR', type: 'DEPOSIT', currency: 'EUR' });
    const depositId = depositRes.body.id as string;

    const portfolioRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', referenceAccountId: depositId });
    const portfolioId = portfolioRes.body.id as string;

    // Attempt to set currency on portfolio via PUT — must be ignored
    const updateRes = await request(app)
      .put(`/api/accounts/${portfolioId}`)
      .send({ currency: 'USD' });
    expect(updateRes.status).toBe(200);

    const row = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(portfolioId) as { currency: string | null };
    expect(row.currency).toBeNull();
    // Resolved currency in response must still be EUR (from deposit)
    expect(updateRes.body.currency).toBe('EUR');
  });

  it('DEPOSIT account creates correctly with own currency', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .send({ name: 'Conto Corrente', type: 'DEPOSIT', currency: 'EUR' });
    expect(res.status).toBe(201);
    expect(res.body.currency).toBe('EUR');

    const row = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(res.body.id as string) as { currency: string };
    expect(row.currency).toBe('EUR');
  });
});
