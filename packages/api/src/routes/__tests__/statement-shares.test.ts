/**
 * Test 3.1 — SQL aggregate shares in getStatementOfAssets
 *
 * Verifies that the SQL aggregate query correctly computes net shares
 * per security (BUY + DELIVERY_INBOUND - SELL - DELIVERY_OUTBOUND),
 * that the 1e8 division is exact via Decimal, and that fully-sold
 * securities (net shares <= 0) are excluded from the result.
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
      uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT,
      currency TEXT DEFAULT 'EUR', isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT, updatedAt TEXT, note TEXT,
      _xmlid INTEGER, _order INTEGER
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, isin TEXT,
      tickerSymbol TEXT, wkn TEXT, currency TEXT DEFAULT 'EUR',
      note TEXT, isRetired INTEGER DEFAULT 0, feedURL TEXT, feed TEXT,
      latestFeedURL TEXT, latestFeed TEXT, feedTickerSymbol TEXT,
      calendar TEXT, updatedAt TEXT, onlineId TEXT, targetCurrency TEXT
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
      xact TEXT, type TEXT NOT NULL, amount INTEGER NOT NULL,
      currency TEXT, forex_amount INTEGER, forex_currency TEXT, exchangeRate TEXT
    );
    CREATE TABLE config_entry (
      uuid TEXT, config_set INTEGER, name TEXT NOT NULL, data TEXT
    );
    CREATE TABLE property (
      name TEXT PRIMARY KEY, special INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL
    );
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY, tstamp TEXT, value INTEGER NOT NULL,
      high INTEGER, low INTEGER, volume INTEGER
    );
    CREATE TABLE price (
      security TEXT, tstamp TEXT NOT NULL, value INTEGER NOT NULL,
      high INTEGER, low INTEGER, volume INTEGER,
      PRIMARY KEY (security, tstamp)
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
    CREATE TABLE attribute_type (
      _id INTEGER PRIMARY KEY, id TEXT NOT NULL,
      name TEXT NOT NULL, columnLabel TEXT,
      target TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
      converterClass TEXT NOT NULL DEFAULT '', props_json TEXT
    );
  `);

  return sqlite;
}

describe.skipIf(!hasSqliteBindings)('getStatementOfAssets — net shares SQL aggregate (3.1)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const sqlite = createTestDb();
    const db = drizzle(sqlite, { schema });

    // Base currency
    sqlite.prepare(`INSERT INTO property VALUES ('pp.base.currency', 0, 'EUR')`).run();

    // Portfolio account + deposit account
    sqlite.prepare(`
      INSERT INTO account VALUES (NULL, 'port1', 'Portfolio', 'portfolio', 'EUR', 0, 'dep1', NULL, NULL, 1, 1)
    `).run();
    sqlite.prepare(`
      INSERT INTO account VALUES (NULL, 'dep1', 'Cash', 'deposit', 'EUR', 0, NULL, NULL, NULL, 2, 2)
    `).run();

    // Security
    sqlite.prepare(`
      INSERT INTO security VALUES (NULL, 'sec1', 'Test Security', NULL, NULL, NULL, 'EUR', NULL, 0,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    `).run();

    // Price: 10 EUR per share on 2024-01-01
    // ppxml2db stores value in hecto-units (10^2): 10 EUR = 1000
    sqlite.prepare(`
      INSERT INTO price VALUES ('sec1', '2024-01-01', 1000, NULL, NULL, NULL)
    `).run();

    // Transactions in ppxml2db format: shares stored as shares * 1e8
    // BUY 100 shares → 100 * 1e8 = 10000000000
    sqlite.prepare(`
      INSERT INTO xact VALUES (NULL, 'x1', 'BUY', '2023-06-01', 'EUR', 100000, 10000000000,
        NULL, 'sec1', 'port1', NULL, '', 0, 0, 'portfolio', 1, 1)
    `).run();
    // SELL 30 shares → 30 * 1e8 = 3000000000
    sqlite.prepare(`
      INSERT INTO xact VALUES (NULL, 'x2', 'SELL', '2023-09-01', 'EUR', 30000, 3000000000,
        NULL, 'sec1', 'port1', NULL, '', 0, 0, 'portfolio', 2, 2)
    `).run();
    // DELIVERY_INBOUND 20 shares → 20 * 1e8 = 2000000000
    sqlite.prepare(`
      INSERT INTO xact VALUES (NULL, 'x3', 'DELIVERY_INBOUND', '2023-11-01', 'EUR', 0, 2000000000,
        NULL, 'sec1', 'port1', NULL, '', 0, 0, 'portfolio', 3, 3)
    `).run();

    // Second security — fully sold (net = 0), must NOT appear in results
    sqlite.prepare(`
      INSERT INTO security VALUES (NULL, 'sec2', 'Sold Security', NULL, NULL, NULL, 'EUR', NULL, 0,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    `).run();
    sqlite.prepare(`INSERT INTO price VALUES ('sec2', '2024-01-01', 500, NULL, NULL, NULL)`).run();
    // BUY 50, SELL 50 → net = 0
    sqlite.prepare(`
      INSERT INTO xact VALUES (NULL, 'x4', 'BUY', '2023-01-01', 'EUR', 50000, 5000000000,
        NULL, 'sec2', 'port1', NULL, '', 0, 0, 'portfolio', 4, 4)
    `).run();
    sqlite.prepare(`
      INSERT INTO xact VALUES (NULL, 'x5', 'SELL', '2023-12-01', 'EUR', 50000, 5000000000,
        NULL, 'sec2', 'port1', NULL, '', 0, 0, 'portfolio', 5, 5)
    `).run();

    app = createApp(db, sqlite);
  });

  it('calculates net shares correctly: BUY 100 - SELL 30 + DELIVERY_INBOUND 20 = 90', async () => {
    const res = await request(app)
      .get('/api/reports/statement-of-assets')
      .query({ date: '2024-01-01' });

    expect(res.status).toBe(200);
    const securities: Array<{ securityId: string; shares: string }> = res.body.securities ?? [];
    const sec1Entry = securities.find((s) => s.securityId === 'sec1');
    expect(sec1Entry).toBeDefined();
    // Net shares: 100 - 30 + 20 = 90
    expect(sec1Entry!.shares).toBe('90');
  });

  it('excludes fully-sold securities (net shares <= 0)', async () => {
    const res = await request(app)
      .get('/api/reports/statement-of-assets')
      .query({ date: '2024-01-01' });

    expect(res.status).toBe(200);
    const securities: Array<{ securityId: string }> = res.body.securities ?? [];
    const sec2Entry = securities.find((s) => s.securityId === 'sec2');
    expect(sec2Entry).toBeUndefined();
  });

  it('Decimal precision: shares are exact (no floating point drift)', async () => {
    const res = await request(app)
      .get('/api/reports/statement-of-assets')
      .query({ date: '2024-01-01' });

    expect(res.status).toBe(200);
    const securities: Array<{ securityId: string; shares: string }> = res.body.securities ?? [];
    const sec1Entry = securities.find((s) => s.securityId === 'sec1');
    expect(sec1Entry).toBeDefined();
    // Must be exactly '90', not '89.99999...' or '90.00000001'
    expect(sec1Entry!.shares).toMatch(/^90(\.0+)?$/);
  });
});
