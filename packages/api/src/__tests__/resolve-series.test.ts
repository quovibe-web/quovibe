// Tests for POST /api/performance/resolve-series — resolves a DataSeriesValue to a label + params.

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
    CREATE TABLE taxonomy_data (
      taxonomy TEXT NOT NULL,
      category TEXT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL
    );
    CREATE TABLE taxonomy_assignment_data (
      assignment INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );
  `);

  // ── Seed data ──
  // Base currency
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
    .run('portfolio.currency', 'EUR');

  // Deposit (cash) account — referenceAccount for the portfolio
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run('acct-dep-1', 'Cash EUR', 'account', 'EUR');

  // Portfolio (securities) account
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run('acct-port-1', 'My Broker', 'portfolio', 'EUR', 'acct-dep-1');

  // Security
  sqlite.prepare(`INSERT INTO security (uuid, name, tickerSymbol, currency) VALUES (?, ?, ?, ?)`)
    .run('sec-1', 'Apple Inc', 'AAPL', 'USD');

  // Taxonomy
  sqlite.prepare(`INSERT INTO taxonomy (uuid, name, root) VALUES (?, ?, ?)`)
    .run('tax-1', 'Asset Classes', 'cat-root');

  // Taxonomy category
  sqlite.prepare(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('cat-1', 'tax-1', 'cat-root', 'Equities', '#0066cc', 10000, 0);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

(hasSqliteBindings ? describe : describe.skip)('POST /api/performance/resolve-series', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    app = createApp(db as Parameters<typeof createApp>[0], sqlite);
  });

  it('portfolio preTax=false → label + params', async () => {
    const res = await request(app)
      .post('/api/performance/resolve-series')
      .send({ type: 'portfolio', preTax: false })
      .expect(200);

    expect(res.body.label).toBe('Entire portfolio');
    expect(res.body.params).toEqual({ preTax: false });
  });

  it('portfolio preTax=true → 400 (preTax: true removed from UI)', async () => {
    await request(app)
      .post('/api/performance/resolve-series')
      .send({ type: 'portfolio', preTax: true })
      .expect(400);
  });

  it('account valid + withReference=true → label has "+"', async () => {
    const res = await request(app)
      .post('/api/performance/resolve-series')
      .send({ type: 'account', accountId: 'acct-port-1', withReference: true })
      .expect(200);

    expect(res.body.label).toContain('+');
    expect(res.body.params.filter).toBe('acct-port-1');
    expect(res.body.params.withReference).toBe(true);
  });

  it('account nonexistent → 404', async () => {
    await request(app)
      .post('/api/performance/resolve-series')
      .send({ type: 'account', accountId: 'nonexistent', withReference: false })
      .expect(404);
  });

  it('taxonomy valid + categoryId → label has "›"', async () => {
    const res = await request(app)
      .post('/api/performance/resolve-series')
      .send({ type: 'taxonomy', taxonomyId: 'tax-1', categoryId: 'cat-1' })
      .expect(200);

    expect(res.body.label).toContain('›');
  });

  it('security nonexistent → 404', async () => {
    await request(app)
      .post('/api/performance/resolve-series')
      .send({ type: 'security', securityId: 'nonexistent' })
      .expect(404);
  });

  it('invalid body (missing type) → 400', async () => {
    await request(app)
      .post('/api/performance/resolve-series')
      .send({ preTax: false })
      .expect(400);
  });
});
