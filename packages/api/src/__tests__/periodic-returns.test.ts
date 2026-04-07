import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { createApp } from '../create-app';

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
      updatedAt TEXT,
      note TEXT,
      _xmlid INTEGER,
      _order INTEGER
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
      currency TEXT,
      amount INTEGER,
      shares INTEGER,
      note TEXT,
      security TEXT,
      account TEXT,
      source TEXT,
      updatedAt TEXT,
      fees INTEGER,
      taxes INTEGER,
      acctype TEXT,
      _xmlid INTEGER,
      _order INTEGER
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
      value TEXT
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
    CREATE TABLE taxonomy (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      name TEXT NOT NULL,
      root TEXT NOT NULL
    );
    CREATE TABLE taxonomy_category (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL,
      taxonomy TEXT NOT NULL,
      parent TEXT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      weight INTEGER NOT NULL,
      rank INTEGER NOT NULL
    );
    CREATE TABLE taxonomy_assignment (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy TEXT NOT NULL,
      category TEXT NOT NULL,
      item_type TEXT NOT NULL,
      item TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      rank INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );
    CREATE TABLE calendar_holiday (
      calendar TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT,
      PRIMARY KEY (calendar, date)
    );
    CREATE TABLE portfolio_calendar (
      security TEXT,
      calendar TEXT
    );
  `);

  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`).run('portfolio.currency', 'EUR');
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`).run('portfolio.calendar', 'default');

  const depositId = 'deposit-001';
  const portfolioId = 'portfolio-001';
  sqlite.prepare(`INSERT INTO account (uuid, name, currency, type, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(depositId, 'Cash', 'EUR', 'deposit', null);
  sqlite.prepare(`INSERT INTO account (uuid, name, currency, type, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(portfolioId, 'Portfolio', 'EUR', 'portfolio', depositId);

  const secId = 'sec-001';
  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`).run(secId, 'Test Stock', 'EUR');

  // DEPOSIT into cash account
  sqlite.prepare(`INSERT INTO xact (uuid, account, security, date, type, shares, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('tx-dep-1', depositId, null, '2024-01-02', 'DEPOSIT', 0, 100000);

  // BUY — securities-side (portfolio account)
  sqlite.prepare(`INSERT INTO xact (uuid, account, security, date, type, shares, amount, fees) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('tx-buy-1', portfolioId, secId, '2024-01-02', 'BUY', 1000000000, -100000, 0);

  // BUY — cash counter-entry (deposit account)
  sqlite.prepare(`INSERT INTO xact (uuid, account, security, date, type, shares, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('tx-buy-1-cash', depositId, secId, '2024-01-02', 'BUY', 0, -100000);

  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('tx-buy-1', portfolioId, 'tx-buy-1-cash', depositId);

  const prices = [
    ['2024-01-02', 100], ['2024-01-03', 101], ['2024-01-04', 99],
    ['2024-01-05', 102], ['2024-01-08', 103],
  ] as const;
  for (const [date, price] of prices) {
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(secId, date, Math.round(price * 1e8));
  }

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

(hasSqliteBindings ? describe : describe.skip)('GET /api/performance/periodic-returns', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  it('returns monthly periodic returns', async () => {
    const res = await request(app)
      .get('/api/performance/periodic-returns')
      .query({ periodStart: '2024-01-02', periodEnd: '2024-01-08', interval: 'monthly' });
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe('monthly');
    expect(res.body.returns).toHaveLength(1);
    expect(res.body.returns[0].date).toBe('2024-01-08');
    expect(parseFloat(res.body.returns[0].return)).not.toBe(0);
  });

  it('returns daily periodic returns', async () => {
    const res = await request(app)
      .get('/api/performance/periodic-returns')
      .query({ periodStart: '2024-01-02', periodEnd: '2024-01-08', interval: 'daily' });
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe('daily');
    expect(res.body.returns.length).toBeGreaterThanOrEqual(3);
  });

  it('returns weekly periodic returns', async () => {
    const res = await request(app)
      .get('/api/performance/periodic-returns')
      .query({ periodStart: '2024-01-02', periodEnd: '2024-01-08', interval: 'weekly' });
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe('weekly');
    expect(res.body.returns.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects missing interval param', async () => {
    const res = await request(app)
      .get('/api/performance/periodic-returns')
      .query({ periodStart: '2024-01-02', periodEnd: '2024-01-08' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid interval param', async () => {
    const res = await request(app)
      .get('/api/performance/periodic-returns')
      .query({ periodStart: '2024-01-02', periodEnd: '2024-01-08', interval: 'biweekly' });
    expect(res.status).toBe(400);
  });
});
