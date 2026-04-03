// packages/api/src/routes/__tests__/cross-entries.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

let hasSqliteBindings = false;
try { new Database(':memory:').close(); hasSqliteBindings = true; } catch { /* skip */ }

const DEP_A = '11111111-1111-1111-1111-111111111111';

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

describe.skipIf(!hasSqliteBindings)('GAP-05: no auto-referential xact_cross_entry for standalone txns', () => {
  let sqlite: ReturnType<typeof Database>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sqlite = createTestDb();
    sqlite.exec(`
      INSERT INTO account (uuid, name, type, currency, isRetired, referenceAccount, updatedAt, note, _xmlid, _order) VALUES
        ('${DEP_A}', 'Deposit A', 'account', 'EUR', 0, NULL, '', NULL, 1, 1);
    `);
    const db = drizzle(sqlite, { schema });
    app = createApp(db, sqlite);
  });

  it('DEPOSIT does not create a cross_entry row', async () => {
    const res = await request(app).post('/api/transactions').send({
      type: 'DEPOSIT',
      date: '2024-06-01',
      amount: 1000,
      currencyCode: 'EUR',
      accountId: DEP_A,
    }).expect(201);

    const xactId = res.body.uuid as string;
    const crossEntries = sqlite
      .prepare('SELECT * FROM xact_cross_entry WHERE from_xact = ?')
      .all(xactId) as unknown[];

    expect(crossEntries).toHaveLength(0);
  });

  it('DEPOSIT still appears in per-account transaction list after fix', async () => {
    await request(app).post('/api/transactions').send({
      type: 'DEPOSIT',
      date: '2024-06-01',
      amount: 1000,
      currencyCode: 'EUR',
      accountId: DEP_A,
    }).expect(201);

    const res = await request(app)
      .get(`/api/transactions?account=${DEP_A}`)
      .expect(200);

    const types = res.body.data.map((t: Record<string, unknown>) => t['type']);
    expect(types).toContain('DEPOSIT');
  });
});
