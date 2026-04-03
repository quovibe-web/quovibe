// Tests for GET /api/performance/security-series

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

// ─── Test DB setup ─────────────────────────────────────────────────────────────

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
  `);

  // Base currency
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
    .run('portfolio.currency', 'EUR');

  // Accounts: a securities account (portfolio) and its linked deposit account
  sqlite.prepare(
    `INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`
  ).run('acc-portfolio-1', 'Test Portfolio', 'portfolio', 'EUR', 'acc-deposit-1');
  sqlite.prepare(
    `INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`
  ).run('acc-deposit-1', 'Test Deposit', 'account', 'EUR');

  // EUR-denominated security with transactions
  sqlite.prepare(`INSERT INTO security (uuid, name, tickerSymbol, currency) VALUES (?, ?, ?, ?)`)
    .run('sec-eur-1', 'EUR Stock', 'EURSTK', 'EUR');

  // Security that exists but has NO transactions
  sqlite.prepare(`INSERT INTO security (uuid, name, tickerSymbol, currency) VALUES (?, ?, ?, ?)`)
    .run('sec-no-tx', 'No-TX Stock', 'NOTX', 'EUR');

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/** Insert a historical price. value is the human-readable price (e.g. 100.0);
 *  it is stored x10^8 as per ppxml2db convention. */
function insertPrice(sqlite: Database.Database, securityId: string, date: string, price: number) {
  sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(securityId, date, Math.round(price * 1e8));
}

/** Insert a BUY transaction. amount and shares in human-readable form;
 *  stored as amount x10^2 and shares x10^8. */
function insertBuy(
  sqlite: Database.Database,
  opts: {
    uuid: string;
    date: string;
    securityId: string;
    accountId: string;
    shares: number;
    amount: number;
  },
) {
  sqlite.prepare(
    `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes)
     VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, 0, 0)`
  ).run(
    opts.uuid,
    opts.date,
    Math.round(opts.amount * 100),
    Math.round(opts.shares * 1e8),
    opts.securityId,
    opts.accountId,
  );

  // Cash counter-entry for the deposit account
  const cashUuid = opts.uuid + '-cash';
  sqlite.prepare(
    `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes)
     VALUES (?, 'BUY', ?, 'EUR', ?, 0, ?, ?, 0, 0)`
  ).run(
    cashUuid,
    opts.date,
    Math.round(opts.amount * 100),
    opts.securityId,
    'acc-deposit-1',
  );

  // Cross-entry link
  sqlite.prepare(
    `INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES (?, ?, ?, ?, ?)`
  ).run(opts.uuid, opts.accountId, cashUuid, 'acc-deposit-1', 'BUY');
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

(hasSqliteBindings ? describe : describe.skip)('GET /api/performance/security-series', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  // ── 1. Returns 400 when securityId is missing ─────────────────────────────

  it('returns 400 when securityId query parameter is missing', async () => {
    const res = await request(app)
      .get('/api/performance/security-series')
      .query({
        periodStart: '2024-01-02',
        periodEnd: '2024-01-10',
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error).toContain('securityId');
  });

  // ── 2. Returns 404 for non-existent security ─────────────────────────────

  it('returns 404 for a security UUID that does not exist', async () => {
    const res = await request(app)
      .get('/api/performance/security-series')
      .query({
        securityId: 'non-existent-uuid-12345',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-10',
      })
      .expect(404);

    expect(res.body.error).toBeDefined();
  });

  // ── 3. Returns cumulative TTWROR series for a valid security ──────────────

  it('returns cumulative TTWROR series with correct shape for a valid security', async () => {
    // Buy 10 shares at 100 on Jan 2
    insertBuy(sqlite, {
      uuid: 'tx-buy-1',
      date: '2024-01-02',
      securityId: 'sec-eur-1',
      accountId: 'acc-portfolio-1',
      shares: 10,
      amount: 1000,
    });

    // Prices: 100 on Jan 2, 105 on Jan 3, 110 on Jan 4
    insertPrice(sqlite, 'sec-eur-1', '2024-01-02', 100);
    insertPrice(sqlite, 'sec-eur-1', '2024-01-03', 105);
    insertPrice(sqlite, 'sec-eur-1', '2024-01-04', 110);

    const res = await request(app)
      .get('/api/performance/security-series')
      .query({
        securityId: 'sec-eur-1',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
        interval: 'daily',
      })
      .expect(200);

    // Verify response shape
    expect(res.body.securityId).toBe('sec-eur-1');
    expect(res.body.securityName).toBe('EUR Stock');
    expect(Array.isArray(res.body.series)).toBe(true);
    expect(res.body.series.length).toBeGreaterThan(0);

    // Each series point has date and cumulativeReturn (as string)
    for (const point of res.body.series) {
      expect(typeof point.date).toBe('string');
      expect(typeof point.cumulativeReturn).toBe('string');
      // cumulativeReturn must parse as a number
      expect(Number.isFinite(parseFloat(point.cumulativeReturn))).toBe(true);
    }
  });

  // ── 4. Respects interval parameter — daily vs weekly ─────────────────────

  it('daily interval returns more points than weekly for the same period', async () => {
    // Buy 10 shares at 100 on Jan 2
    insertBuy(sqlite, {
      uuid: 'tx-buy-2',
      date: '2024-01-02',
      securityId: 'sec-eur-1',
      accountId: 'acc-portfolio-1',
      shares: 10,
      amount: 1000,
    });

    // Insert 3 weeks of daily prices (Jan 2 - Jan 19, 2024 — weekdays only)
    const weekdayDates = [
      '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05',
      '2024-01-08', '2024-01-09', '2024-01-10', '2024-01-11', '2024-01-12',
      '2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19',
    ];
    let price = 100;
    for (const date of weekdayDates) {
      insertPrice(sqlite, 'sec-eur-1', date, price);
      price += 1;
    }

    const [dailyRes, weeklyRes] = await Promise.all([
      request(app)
        .get('/api/performance/security-series')
        .query({
          securityId: 'sec-eur-1',
          periodStart: '2024-01-02',
          periodEnd: '2024-01-19',
          interval: 'daily',
        })
        .expect(200),
      request(app)
        .get('/api/performance/security-series')
        .query({
          securityId: 'sec-eur-1',
          periodStart: '2024-01-02',
          periodEnd: '2024-01-19',
          interval: 'weekly',
        })
        .expect(200),
    ]);

    const dailyCount = dailyRes.body.series.length;
    const weeklyCount = weeklyRes.body.series.length;

    expect(dailyCount).toBeGreaterThan(weeklyCount);
    // Weekly should still have at least 2 points (first + last)
    expect(weeklyCount).toBeGreaterThanOrEqual(2);
  });

  // ── 5. Security exists but has no transactions — returns flat zero series ─

  it('returns a flat zero series for a security that exists but has no transactions', async () => {
    // sec-no-tx exists in DB but has no transactions
    // Insert some prices so it has data points to show
    insertPrice(sqlite, 'sec-no-tx', '2024-01-02', 100);
    insertPrice(sqlite, 'sec-no-tx', '2024-01-03', 105);

    const res = await request(app)
      .get('/api/performance/security-series')
      .query({
        securityId: 'sec-no-tx',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-03',
        interval: 'daily',
      })
      .expect(200);

    expect(res.body.securityId).toBe('sec-no-tx');
    expect(res.body.securityName).toBe('No-TX Stock');
    expect(res.body.series.length).toBeGreaterThan(0);

    // All cumulative returns should be '0' for no-transaction security
    for (const point of res.body.series) {
      expect(point.cumulativeReturn).toBe('0');
    }
  });
});
