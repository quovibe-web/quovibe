// Tests for downsample() and GET /api/performance/movers

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import Decimal from 'decimal.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { createApp } from '../create-app';
import { downsample } from '../services/movers.service';

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
  `);

  // Base currency
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
    .run('portfolio.currency', 'EUR');

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

function insertPrice(sqlite: Database.Database, securityId: string, date: string, price: number) {
  sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(securityId, date, Math.round(price * 1e8));
}

function insertSecurity(sqlite: Database.Database, uuid: string, name: string) {
  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, 'EUR')`)
    .run(uuid, name);
}

function insertAccount(
  sqlite: Database.Database,
  uuid: string,
  name: string,
  type: string,
  referenceAccount?: string,
) {
  sqlite.prepare(`INSERT INTO account (uuid, name, type, referenceAccount) VALUES (?, ?, ?, ?)`)
    .run(uuid, name, type, referenceAccount ?? null);
}

function insertBuyTransaction(
  sqlite: Database.Database,
  uuid: string,
  securityId: string,
  accountId: string,
  date: string,
  shares: number,
  pricePerShare: number,
) {
  const sharesStored = Math.round(shares * 1e8);
  const amount = Math.round(pricePerShare * shares * 100);
  sqlite.prepare(
    `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, updatedAt, fees, taxes, acctype)
     VALUES (?, 'BUY', ?, 'EUR', ?, ?, ?, ?, ?, 0, 0, 'portfolio')`
  ).run(uuid, date, amount, sharesStored, securityId, accountId, date);
}

// ─── Unit tests: downsample ────────────────────────────────────────────────────

describe('downsample()', () => {
  it('returns all points when count <= maxPoints', () => {
    const input = [
      { date: '2024-01-01', r: new Decimal('0.01'), cumR: new Decimal('0.01') },
      { date: '2024-01-02', r: new Decimal('0.02'), cumR: new Decimal('0.0302') },
      { date: '2024-01-03', r: new Decimal('0.005'), cumR: new Decimal('0.035') },
    ];
    const result = downsample(input, 5);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: '2024-01-01', cumR: '0.01' });
    expect(result[2]).toEqual({ date: '2024-01-03', cumR: '0.035' });
  });

  it('downsamples and always includes last point', () => {
    // 10 points, max 3 → step = ceil(10/3) = 4 → indices 0,4,8 → last is index 9, appended
    const input = Array.from({ length: 10 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      r: new Decimal('0.01'),
      cumR: new Decimal((i + 1) * 0.01),
    }));
    const result = downsample(input, 3);
    // Should include indices 0, 4, 8 + last (9)
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.length).toBeGreaterThanOrEqual(3);
    // Last point must always be the final data point
    expect(result[result.length - 1].date).toBe('2024-01-10');
  });

  it('returns empty for empty input', () => {
    const result = downsample([], 30);
    expect(result).toEqual([]);
  });
});

// ─── Integration tests: GET /api/performance/movers ────────────────────────────

(hasSqliteBindings ? describe : describe.skip)('GET /api/performance/movers', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  it('returns empty top/bottom for empty portfolio', async () => {
    const res = await request(app)
      .get('/api/performance/movers')
      .query({
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
      })
      .expect(200);

    expect(res.body.top).toEqual([]);
    expect(res.body.bottom).toEqual([]);
  });

  it('sorts securities by TTWROR and returns top/bottom with count=2', async () => {
    // Setup: deposit + portfolio accounts
    insertAccount(sqlite, 'dep-1', 'Cash', 'account');
    insertAccount(sqlite, 'port-1', 'Portfolio', 'portfolio', 'dep-1');

    // 3 securities with different trajectories
    insertSecurity(sqlite, 'sec-a', 'Security A'); // 100 → 120 (+20%)
    insertSecurity(sqlite, 'sec-b', 'Security B'); // 100 → 90  (-10%)
    insertSecurity(sqlite, 'sec-c', 'Security C'); // 100 → 105 (+5%)

    // BUY 1 share of each at 100 on period start
    insertBuyTransaction(sqlite, 'tx-a', 'sec-a', 'port-1', '2024-01-01', 1, 100);
    insertBuyTransaction(sqlite, 'tx-b', 'sec-b', 'port-1', '2024-01-01', 1, 100);
    insertBuyTransaction(sqlite, 'tx-c', 'sec-c', 'port-1', '2024-01-01', 1, 100);

    // Prices at start and end
    insertPrice(sqlite, 'sec-a', '2024-01-01', 100);
    insertPrice(sqlite, 'sec-a', '2024-01-31', 120);

    insertPrice(sqlite, 'sec-b', '2024-01-01', 100);
    insertPrice(sqlite, 'sec-b', '2024-01-31', 90);

    insertPrice(sqlite, 'sec-c', '2024-01-01', 100);
    insertPrice(sqlite, 'sec-c', '2024-01-31', 105);

    const res = await request(app)
      .get('/api/performance/movers')
      .query({
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
        count: '2',
      })
      .expect(200);

    // count=2 → topN = ceil(3/2) = 2, bottomN = 1
    // Top 2: A (+20%), C (+5%). Bottom 1: B (-10%)
    expect(res.body.top).toHaveLength(2);
    expect(res.body.bottom).toHaveLength(1);

    // Top should be sorted descending by TTWROR
    expect(res.body.top[0].securityId).toBe('sec-a');
    expect(res.body.top[1].securityId).toBe('sec-c');

    // Bottom should be the worst performer
    expect(res.body.bottom[0].securityId).toBe('sec-b');

    // Verify TTWROR values are approximately correct
    expect(parseFloat(res.body.top[0].ttwror)).toBeCloseTo(0.2, 1);
    expect(parseFloat(res.body.bottom[0].ttwror)).toBeCloseTo(-0.1, 1);
  });

  it('respects count=1 parameter', async () => {
    // Setup: deposit + portfolio accounts
    insertAccount(sqlite, 'dep-1', 'Cash', 'account');
    insertAccount(sqlite, 'port-1', 'Portfolio', 'portfolio', 'dep-1');

    // 2 securities
    insertSecurity(sqlite, 'sec-x', 'Security X'); // 100 → 115 (+15%)
    insertSecurity(sqlite, 'sec-y', 'Security Y'); // 100 → 95  (-5%)

    insertBuyTransaction(sqlite, 'tx-x', 'sec-x', 'port-1', '2024-01-01', 1, 100);
    insertBuyTransaction(sqlite, 'tx-y', 'sec-y', 'port-1', '2024-01-01', 1, 100);

    insertPrice(sqlite, 'sec-x', '2024-01-01', 100);
    insertPrice(sqlite, 'sec-x', '2024-01-31', 115);

    insertPrice(sqlite, 'sec-y', '2024-01-01', 100);
    insertPrice(sqlite, 'sec-y', '2024-01-31', 95);

    const res = await request(app)
      .get('/api/performance/movers')
      .query({
        periodStart: '2024-01-01',
        periodEnd: '2024-01-31',
        count: '1',
      })
      .expect(200);

    // count=1 → topN = ceil(2/2) = 1, bottomN = 1
    expect(res.body.top).toHaveLength(1);
    expect(res.body.bottom).toHaveLength(1);

    expect(res.body.top[0].securityId).toBe('sec-x');
    expect(res.body.bottom[0].securityId).toBe('sec-y');
  });
});
