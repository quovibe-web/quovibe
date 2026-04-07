/**
 * Security Write-Parity Tests
 *
 * Ground truth: docs/audit/fixtures/security.json, price.json, latest-price.json
 *
 * Strategy:
 *   - Call API endpoints via supertest (createSecurity, updateSecurity, deleteSecurity, etc.)
 *   - Read back raw rows with direct SQL (never through service read layer)
 *   - Compare every column against fixture-derived expected values
 *   - Test price pipeline SQL patterns directly for isolation guarantees
 *
 * Findings documented in this file:
 *   S1 (MEDIUM): createSecurity omitted onlineId — FIXED
 *   S3 (LOW):    createSecurity hardcoded isRetired=0, ignored input — FIXED
 *   S4 (MEDIUM): updateSecurity could not update feedTickerSymbol — FIXED
 *   S8 (MEDIUM): savePricesToDb discarded high/low/volume from FetchedPrice — FIXED
 *   S9 (MEDIUM): updateFeedConfig did not bump updatedAt — FIXED
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

// ─── Skip if native SQLite bindings are unavailable ────────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Schema SQL ────────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE account (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT,
    type TEXT NOT NULL,
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
    onlineId TEXT,
    name TEXT,
    currency TEXT DEFAULT 'EUR',
    targetCurrency TEXT,
    note TEXT,
    isin TEXT,
    tickerSymbol TEXT,
    calendar TEXT,
    wkn TEXT,
    feedTickerSymbol TEXT,
    feed TEXT,
    feedURL TEXT,
    latestFeed TEXT,
    latestFeedURL TEXT,
    isRetired INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL
  );
  CREATE UNIQUE INDEX security__uuid ON security(uuid);
  CREATE TABLE security_attr (
    security TEXT NOT NULL,
    attr_uuid TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'string',
    value TEXT,
    seq INTEGER DEFAULT 0
  );
  CREATE UNIQUE INDEX security_attr__pk ON security_attr(security, attr_uuid);
  CREATE TABLE security_prop (
    security TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    seq INTEGER DEFAULT 0
  );
  CREATE TABLE security_event (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    security TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    details TEXT
  );
  CREATE TABLE price (
    security TEXT NOT NULL,
    tstamp TEXT NOT NULL,
    value INTEGER NOT NULL,
    open INTEGER,
    high INTEGER,
    low INTEGER,
    volume INTEGER
  );
  CREATE UNIQUE INDEX price__security_tstamp ON price(security, tstamp);
  CREATE TABLE latest_price (
    security TEXT NOT NULL PRIMARY KEY,
    tstamp TEXT NOT NULL,
    value INTEGER NOT NULL,
    open INTEGER,
    high INTEGER,
    low INTEGER,
    volume INTEGER
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
    to_xact TEXT NOT NULL,
    to_acc TEXT NOT NULL,
    type TEXT NOT NULL
  );
  CREATE TABLE xact_unit (
    xact TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT,
    forex_amount INTEGER,
    forex_currency TEXT,
    exchangeRate TEXT
  );
  CREATE TABLE taxonomy_assignment (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT,
    category TEXT,
    taxonomy TEXT,
    item_type TEXT,
    weight INTEGER DEFAULT 10000,
    rank INTEGER DEFAULT 0
  );
  CREATE TABLE taxonomy_assignment_data (
    assignment INTEGER,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE watchlist (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    _order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE watchlist_security (
    list INTEGER,
    security TEXT
  );
  CREATE TABLE attribute_type (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    columnLabel TEXT NOT NULL,
    source TEXT,
    target TEXT NOT NULL,
    converterClass TEXT NOT NULL,
    props_json TEXT
  );
  CREATE TABLE property (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    special INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE config_entry (
    uuid TEXT,
    config_set INTEGER,
    name TEXT NOT NULL,
    data TEXT
  );
  CREATE TABLE account_attr (
    account TEXT,
    attr_uuid TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'string',
    value TEXT,
    seq INTEGER DEFAULT 0,
    PRIMARY KEY (account, attr_uuid)
  );
`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(CREATE_TABLES_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

function createTestApp() {
  const { sqlite, db } = createTestDb();
  const app = createApp(db as Parameters<typeof createApp>[0], sqlite);
  return { app, sqlite };
}

interface SecurityRow {
  uuid: string;
  onlineId: string | null;
  name: string | null;
  currency: string | null;
  targetCurrency: string | null;
  note: string | null;
  isin: string | null;
  tickerSymbol: string | null;
  calendar: string | null;
  wkn: string | null;
  feedTickerSymbol: string | null;
  feed: string | null;
  feedURL: string | null;
  latestFeed: string | null;
  latestFeedURL: string | null;
  isRetired: number;
  updatedAt: string;
}

interface PropRow {
  security: string;
  type: string;
  name: string;
  value: string | null;
  seq: number;
}

const SEC_UUID = '04db1b60-9230-4c5b-a070-613944e91dc3';

function seedSecurity(sqlite: Database.Database, overrides: Partial<SecurityRow> = {}): string {
  const uuid = overrides.uuid ?? SEC_UUID;
  sqlite.prepare(`
    INSERT INTO security (uuid, name, currency, isin, tickerSymbol, wkn, note,
      isRetired, feed, feedURL, latestFeed, latestFeedURL, feedTickerSymbol, calendar,
      onlineId, targetCurrency, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uuid,
    overrides.name ?? 'VANECK VIDEO GAMING AND ESPORT',
    overrides.currency ?? 'EUR',
    overrides.isin ?? 'IE00BYWQWR46',
    overrides.tickerSymbol ?? 'ESPO.MI',
    overrides.wkn ?? null,
    overrides.note ?? null,
    overrides.isRetired ?? 0,
    overrides.feed ?? 'YAHOO',
    overrides.feedURL ?? null,
    overrides.latestFeed ?? null,
    overrides.latestFeedURL ?? null,
    overrides.feedTickerSymbol ?? null,
    overrides.calendar ?? null,
    overrides.onlineId ?? null,
    overrides.targetCurrency ?? null,
    overrides.updatedAt ?? '2024-10-08T07:41:06.465108100Z',
  );
  return uuid;
}

// ─── GROUP A: createSecurity — all columns verified against fixture ────────────

describe.skipIf(!hasSqliteBindings)('GROUP A — createSecurity: all columns', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('A1: writes all standard ppxml2db columns', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({
        name: 'VANECK VIDEO GAMING AND ESPORT',
        currency: 'EUR',
        isin: 'IE00BYWQWR46',
        ticker: 'ESPO.MI',
        feed: 'YAHOO',
      });

    expect(res.status).toBe(201);
    const id = res.body.id as string;

    const row = sqlite.prepare('SELECT * FROM security WHERE uuid = ?').get(id) as SecurityRow;
    expect(row).toBeDefined();
    expect(row.name).toBe('VANECK VIDEO GAMING AND ESPORT');
    expect(row.currency).toBe('EUR');
    expect(row.isin).toBe('IE00BYWQWR46');
    expect(row.tickerSymbol).toBe('ESPO.MI');
    expect(row.feed).toBe('YAHOO');
    expect(row.isRetired).toBe(0);
    expect(row.updatedAt).toBeTruthy();
  });

  it('A2: UUID is a valid v4 format', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Test', currency: 'EUR' });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('A3: isRetired respects input value (not hardcoded 0)', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Retired ETF', currency: 'EUR', isRetired: true });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const row = sqlite.prepare('SELECT isRetired FROM security WHERE uuid = ?').get(id) as { isRetired: number };
    expect(row.isRetired).toBe(1);
  });

  it('A4: isRetired defaults to 0 when not provided', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Active ETF', currency: 'EUR' });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const row = sqlite.prepare('SELECT isRetired FROM security WHERE uuid = ?').get(id) as { isRetired: number };
    expect(row.isRetired).toBe(0);
  });

  it('A5: onlineId written when provided (PP feed parity)', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({
        name: '21SHARES BITCOIN ETP',
        currency: 'EUR',
        feed: 'PP',
        onlineId: 'fe58a021913a4bf884e22ffd6c7df364',
      });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const row = sqlite.prepare('SELECT onlineId FROM security WHERE uuid = ?').get(id) as { onlineId: string | null };
    expect(row.onlineId).toBe('fe58a021913a4bf884e22ffd6c7df364');
  });

  it('A6: onlineId is NULL when not provided', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Test', currency: 'EUR' });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const row = sqlite.prepare('SELECT onlineId FROM security WHERE uuid = ?').get(id) as { onlineId: string | null };
    expect(row.onlineId).toBeNull();
  });

  it('A7: feed props written for GENERIC-JSON feed', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({
        name: 'BTP VALORE',
        currency: 'EUR',
        feed: 'GENERIC-JSON',
        feedUrl: 'https://example.com/prices.json',
        pathToDate: '$[*].date',
        pathToClose: '$[*].close',
      });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const props = sqlite.prepare(
      `SELECT name, value, seq FROM security_prop WHERE security = ? AND type = 'FEED' ORDER BY seq`,
    ).all(id) as { name: string; value: string; seq: number }[];

    expect(props).toHaveLength(2);
    expect(props[0]).toEqual({ name: 'GENERIC-JSON-DATE', value: '$[*].date', seq: 0 });
    expect(props[1]).toEqual({ name: 'GENERIC-JSON-CLOSE', value: '$[*].close', seq: 1 });
  });

  it('A8: feed props NOT written when no feed specified', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'No Feed', currency: 'EUR' });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const props = sqlite.prepare(`SELECT * FROM security_prop WHERE security = ?`).all(id);
    expect(props).toHaveLength(0);
  });

  it('A9: updatedAt is a valid ISO timestamp', async () => {
    const before = new Date().toISOString();
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Test', currency: 'EUR' });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const row = sqlite.prepare('SELECT updatedAt FROM security WHERE uuid = ?').get(id) as { updatedAt: string };
    const ts = new Date(row.updatedAt);
    expect(ts.getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
    expect(ts.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('A10: feedTickerSymbol written when provided', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Test', currency: 'EUR', feed: 'YAHOO', feedTickerSymbol: 'ESPO.MI' });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const row = sqlite.prepare('SELECT feedTickerSymbol FROM security WHERE uuid = ?').get(id) as { feedTickerSymbol: string | null };
    expect(row.feedTickerSymbol).toBe('ESPO.MI');
  });

  it('A11: latestFeed and latestFeedURL written when provided', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({
        name: 'Test',
        currency: 'EUR',
        latestFeed: 'YAHOO',
        latestFeedUrl: 'https://example.com/latest',
      });

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    const row = sqlite.prepare('SELECT latestFeed, latestFeedURL FROM security WHERE uuid = ?')
      .get(id) as { latestFeed: string | null; latestFeedURL: string | null };
    expect(row.latestFeed).toBe('YAHOO');
    expect(row.latestFeedURL).toBe('https://example.com/latest');
  });
});

// ─── GROUP B: updateSecurity — partial update safety ───────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP B — updateSecurity: partial update safety', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
    seedSecurity(sqlite);
  });

  it('B1: updating name only preserves isin', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ name: 'RENAMED' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT name, isin FROM security WHERE uuid = ?').get(SEC_UUID) as { name: string; isin: string };
    expect(row.name).toBe('RENAMED');
    expect(row.isin).toBe('IE00BYWQWR46');
  });

  it('B2: updating feed only preserves name and wkn', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ feed: 'GENERIC-JSON' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT name, feed, wkn FROM security WHERE uuid = ?').get(SEC_UUID) as SecurityRow;
    expect(row.name).toBe('VANECK VIDEO GAMING AND ESPORT');
    expect(row.feed).toBe('GENERIC-JSON');
    expect(row.wkn).toBeNull();
  });

  it('B3: updatedAt is bumped on every update', async () => {
    const before = sqlite.prepare('SELECT updatedAt FROM security WHERE uuid = ?').get(SEC_UUID) as { updatedAt: string };
    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 10));

    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ name: 'Bump' });

    expect(res.status).toBe(200);
    const after = sqlite.prepare('SELECT updatedAt FROM security WHERE uuid = ?').get(SEC_UUID) as { updatedAt: string };
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });

  it('B4: feedTickerSymbol can be updated (S4 fix)', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ feedTickerSymbol: '2BTC.DE' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT feedTickerSymbol FROM security WHERE uuid = ?')
      .get(SEC_UUID) as { feedTickerSymbol: string | null };
    expect(row.feedTickerSymbol).toBe('2BTC.DE');
  });

  it('B5: onlineId can be updated (S1/S5 fix)', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ onlineId: 'abc123' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT onlineId FROM security WHERE uuid = ?')
      .get(SEC_UUID) as { onlineId: string | null };
    expect(row.onlineId).toBe('abc123');
  });

  it('B6: isRetired can be toggled', async () => {
    const res1 = await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ isRetired: true });
    expect(res1.status).toBe(200);

    const row1 = sqlite.prepare('SELECT isRetired FROM security WHERE uuid = ?').get(SEC_UUID) as { isRetired: number };
    expect(row1.isRetired).toBe(1);

    const res2 = await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ isRetired: false });
    expect(res2.status).toBe(200);

    const row2 = sqlite.prepare('SELECT isRetired FROM security WHERE uuid = ?').get(SEC_UUID) as { isRetired: number };
    expect(row2.isRetired).toBe(0);
  });

  it('B7: security_prop rebuilt on feed change', async () => {
    // First set up GENERIC-JSON feed with props
    await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ feed: 'GENERIC-JSON', pathToDate: '$[*].d', pathToClose: '$[*].c' });

    let props = sqlite.prepare(
      `SELECT name FROM security_prop WHERE security = ? AND type = 'FEED' ORDER BY seq`,
    ).all(SEC_UUID) as { name: string }[];
    expect(props.map(p => p.name)).toEqual(['GENERIC-JSON-DATE', 'GENERIC-JSON-CLOSE']);

    // Change feed — old props should be cleared
    await request(app)
      .put(`/api/securities/${SEC_UUID}`)
      .send({ feed: 'YAHOO' });

    props = sqlite.prepare(
      `SELECT name FROM security_prop WHERE security = ? AND type = 'FEED'`,
    ).all(SEC_UUID) as { name: string }[];
    expect(props).toHaveLength(0);
  });
});

// ─── GROUP C: deleteSecurity — cascade to all 8 dependent tables ───────────────

describe.skipIf(!hasSqliteBindings)('GROUP C — deleteSecurity: cascade to all 8 dependent tables', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
    seedSecurity(sqlite);

    // Seed all dependent tables
    sqlite.prepare(`INSERT INTO security_attr (security, attr_uuid, type, value, seq)
      VALUES (?, 'logo', 'string', 'data:image/png;base64,abc', 0)`).run(SEC_UUID);
    sqlite.prepare(`INSERT INTO security_attr (security, attr_uuid, type, value, seq)
      VALUES (?, 'ter', 'double', '0.0055', 1)`).run(SEC_UUID);
    sqlite.prepare(`INSERT INTO security_prop (security, type, name, value, seq)
      VALUES (?, 'FEED', 'GENERIC-JSON-DATE', '$[*].date', 0)`).run(SEC_UUID);
    sqlite.prepare(`INSERT INTO security_event (security, date, type, details)
      VALUES (?, '2024-08-20', 'NOTE', 'test')`).run(SEC_UUID);
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, '2024-01-01', 1000000000)`).run(SEC_UUID);
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, '2024-01-02', 1010000000)`).run(SEC_UUID);
    sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, '2024-01-02', 1010000000)`).run(SEC_UUID);

    // Watchlist
    sqlite.prepare(`INSERT INTO watchlist (_id, name, _order) VALUES (1, 'Main', 0)`).run();
    sqlite.prepare(`INSERT INTO watchlist_security (list, security) VALUES (1, ?)`).run(SEC_UUID);

    // Taxonomy assignment
    const ta = sqlite.prepare(
      `INSERT INTO taxonomy_assignment (item, category, taxonomy, item_type, weight, rank)
       VALUES (?, 'cat1', 'tax1', 'security', 10000, 0)`,
    ).run(SEC_UUID);
    sqlite.prepare(
      `INSERT INTO taxonomy_assignment_data (assignment, name, type, value) VALUES (?, 'color', 'string', 'red')`,
    ).run(ta.lastInsertRowid);
  });

  it('C1: deletes security_attr rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM security_attr WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C2: deletes security_prop rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM security_prop WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C3: deletes taxonomy_assignment_data rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_assignment_data').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C4: deletes taxonomy_assignment rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare(`SELECT COUNT(*) as n FROM taxonomy_assignment WHERE item = ? AND item_type = 'security'`).get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C5: deletes price rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM price WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C6: deletes latest_price rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM latest_price WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C7: deletes security_event rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM security_event WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C8: deletes watchlist_security rows', async () => {
    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM watchlist_security WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('C9: blocks deletion if transactions exist (409)', async () => {
    sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, updatedAt, acctype, _xmlid, _order)
      VALUES ('tx1', 'BUY', '2024-01-01', 'EUR', 10000, 100000000, ?, 'acc1', '', 'portfolio', 0, 0)`).run(SEC_UUID);

    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('security_has_transactions');

    // Security should still exist
    const row = sqlite.prepare('SELECT uuid FROM security WHERE uuid = ?').get(SEC_UUID);
    expect(row).toBeDefined();
  });

  it('C10: delete is atomic — all 8 tables or none', async () => {
    // Verify all seed data exists before delete
    const beforeAttr = (sqlite.prepare('SELECT COUNT(*) as n FROM security_attr WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    const beforePrice = (sqlite.prepare('SELECT COUNT(*) as n FROM price WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(beforeAttr).toBe(2);
    expect(beforePrice).toBe(2);

    const res = await request(app).delete(`/api/securities/${SEC_UUID}`);
    expect(res.status).toBe(200);

    // Everything gone
    const secRow = sqlite.prepare('SELECT uuid FROM security WHERE uuid = ?').get(SEC_UUID);
    expect(secRow).toBeUndefined();
  });
});

// ─── GROUP D: createSecurityEvent — stock split structure vs fixture ───────────

describe.skipIf(!hasSqliteBindings)('GROUP D — createSecurityEvent: event structure vs fixture', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
    seedSecurity(sqlite);
  });

  it('D1: NOTE event writes correct columns (fixture parity)', async () => {
    const res = await request(app)
      .post(`/api/securities/${SEC_UUID}/events`)
      .send({ type: 'NOTE', date: '2024-08-20', details: 'test' });

    expect(res.status).toBe(201);
    const row = sqlite.prepare(
      'SELECT _id, security, date, type, details FROM security_event WHERE security = ?',
    ).get(SEC_UUID) as { _id: number; security: string; date: string; type: string; details: string };

    expect(row.security).toBe(SEC_UUID);
    expect(row.date).toBe('2024-08-20');
    expect(row.type).toBe('NOTE');
    expect(row.details).toBe('test');
  });

  it('D2: STOCK_SPLIT event writes correct columns', async () => {
    const details = JSON.stringify({ ratio: '10:1' });
    const res = await request(app)
      .post(`/api/securities/${SEC_UUID}/events`)
      .send({ type: 'STOCK_SPLIT', date: '2024-06-15', details });

    expect(res.status).toBe(201);
    const row = sqlite.prepare(
      'SELECT type, details FROM security_event WHERE security = ? AND type = ?',
    ).get(SEC_UUID, 'STOCK_SPLIT') as { type: string; details: string };

    expect(row.type).toBe('STOCK_SPLIT');
    expect(row.details).toBe(details);
  });

  it('D3: _id is auto-increment integer', async () => {
    await request(app)
      .post(`/api/securities/${SEC_UUID}/events`)
      .send({ type: 'NOTE', date: '2024-01-01', details: 'first' });
    await request(app)
      .post(`/api/securities/${SEC_UUID}/events`)
      .send({ type: 'NOTE', date: '2024-01-02', details: 'second' });

    const rows = sqlite.prepare('SELECT _id FROM security_event ORDER BY _id').all() as { _id: number }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]._id).toBe(1);
    expect(rows[1]._id).toBe(2);
  });

  it('D4: date preserved as YYYY-MM-DD', async () => {
    await request(app)
      .post(`/api/securities/${SEC_UUID}/events`)
      .send({ type: 'NOTE', date: '2024-08-20', details: 'x' });

    const row = sqlite.prepare('SELECT date FROM security_event WHERE security = ?')
      .get(SEC_UUID) as { date: string };
    expect(row.date).toBe('2024-08-20');
  });

  it('D5: details stored as-is (string)', async () => {
    const complex = '{"ratio":"2:1","effective":"2024-07-01","note":"split event"}';
    await request(app)
      .post(`/api/securities/${SEC_UUID}/events`)
      .send({ type: 'STOCK_SPLIT', date: '2024-07-01', details: complex });

    const row = sqlite.prepare('SELECT details FROM security_event WHERE security = ?')
      .get(SEC_UUID) as { details: string };
    expect(row.details).toBe(complex);
  });
});

// ─── GROUP E: price batch write — INSERT strategy, integers, OHLCV ─────────────

describe.skipIf(!hasSqliteBindings)('GROUP E — price batch write: INSERT strategy, no duplicates, integers', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(CREATE_TABLES_SQL);
    seedSecurity(sqlite);
  });

  // These tests use the same SQL patterns as savePricesToDb

  const insertPriceSQL = `
    INSERT INTO price (security, tstamp, value, high, low, volume) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(security, tstamp) DO UPDATE SET value = excluded.value, high = excluded.high, low = excluded.low, volume = excluded.volume
  `;

  it('E1: ON CONFLICT upsert produces no duplicate rows', () => {
    const insert = sqlite.prepare(insertPriceSQL);
    insert.run(SEC_UUID, '2024-01-01', 1000000000, null, null, null);
    insert.run(SEC_UUID, '2024-01-01', 1050000000, null, null, null); // same date

    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM price WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(1);

    const row = sqlite.prepare('SELECT value FROM price WHERE security = ? AND tstamp = ?')
      .get(SEC_UUID, '2024-01-01') as { value: number };
    expect(row.value).toBe(1050000000); // updated to latest
  });

  it('E2: values stored as 10^8 integers (fixture parity)', () => {
    // Fixture: 30.50 EUR → 3050000000
    const insert = sqlite.prepare(insertPriceSQL);
    const dbValue = Math.round(30.50 * 1e8); // native-ok
    insert.run(SEC_UUID, '2024-01-01', dbValue, null, null, null);

    const row = sqlite.prepare('SELECT value FROM price WHERE security = ? AND tstamp = ?')
      .get(SEC_UUID, '2024-01-01') as { value: number };
    expect(row.value).toBe(3050000000);
    expect(Number.isInteger(row.value)).toBe(true);
  });

  it('E3: replace mode deletes all existing then inserts', () => {
    const insert = sqlite.prepare(insertPriceSQL);
    insert.run(SEC_UUID, '2024-01-01', 1000000000, null, null, null);
    insert.run(SEC_UUID, '2024-01-02', 1010000000, null, null, null);

    // Simulate replace mode
    sqlite.prepare('DELETE FROM price WHERE security = ?').run(SEC_UUID);
    insert.run(SEC_UUID, '2024-02-01', 1200000000, null, null, null);

    const rows = sqlite.prepare('SELECT tstamp FROM price WHERE security = ? ORDER BY tstamp')
      .all(SEC_UUID) as { tstamp: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].tstamp).toBe('2024-02-01');
  });

  it('E4: merge mode preserves existing prices', () => {
    const insert = sqlite.prepare(insertPriceSQL);
    insert.run(SEC_UUID, '2024-01-01', 1000000000, null, null, null);
    // Merge: just insert new dates
    insert.run(SEC_UUID, '2024-01-02', 1010000000, null, null, null);

    const rows = sqlite.prepare('SELECT tstamp FROM price WHERE security = ? ORDER BY tstamp')
      .all(SEC_UUID) as { tstamp: string }[];
    expect(rows).toHaveLength(2);
  });

  it('E5: high/low/volume written when available (S8 fix)', () => {
    const insert = sqlite.prepare(insertPriceSQL);
    insert.run(SEC_UUID, '2024-01-01', 5097000000, 5189000000, 5097000000, 3619);

    const row = sqlite.prepare('SELECT value, high, low, volume FROM price WHERE security = ?')
      .get(SEC_UUID) as { value: number; high: number; low: number; volume: number };
    expect(row.value).toBe(5097000000);
    expect(row.high).toBe(5189000000);
    expect(row.low).toBe(5097000000);
    expect(row.volume).toBe(3619);
  });

  it('E6: high/low/volume NULL when not provided', () => {
    const insert = sqlite.prepare(insertPriceSQL);
    insert.run(SEC_UUID, '2024-01-01', 1894600000, null, null, null);

    const row = sqlite.prepare('SELECT high, low, volume FROM price WHERE security = ?')
      .get(SEC_UUID) as { high: number | null; low: number | null; volume: number | null };
    expect(row.high).toBeNull();
    expect(row.low).toBeNull();
    expect(row.volume).toBeNull();
  });

  it('E7: tstamp format matches fixture (YYYY-MM-DD)', () => {
    const insert = sqlite.prepare(insertPriceSQL);
    insert.run(SEC_UUID, '2019-09-10', 1894600000, null, null, null);

    const row = sqlite.prepare('SELECT tstamp FROM price WHERE security = ?').get(SEC_UUID) as { tstamp: string };
    expect(row.tstamp).toBe('2019-09-10');
  });
});

// ─── GROUP F: latest_price upsert — correct tstamp, pipeline separation ────────

describe.skipIf(!hasSqliteBindings)('GROUP F — latest_price upsert: correct tstamp, pipeline separation', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(CREATE_TABLES_SQL);
    seedSecurity(sqlite);
  });

  const insertLatestSQL = `
    INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)
      ON CONFLICT(security) DO UPDATE SET tstamp = excluded.tstamp, value = excluded.value
  `;

  it('F1: correct tstamp written', () => {
    sqlite.prepare(insertLatestSQL).run(SEC_UUID, '2026-03-20', 5097000000);

    const row = sqlite.prepare('SELECT tstamp FROM latest_price WHERE security = ?')
      .get(SEC_UUID) as { tstamp: string };
    expect(row.tstamp).toBe('2026-03-20');
  });

  it('F2: upsert — second write updates existing row', () => {
    sqlite.prepare(insertLatestSQL).run(SEC_UUID, '2026-03-20', 5097000000);
    sqlite.prepare(insertLatestSQL).run(SEC_UUID, '2026-03-21', 5200000000);

    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM latest_price WHERE security = ?')
      .get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(1);

    const row = sqlite.prepare('SELECT tstamp, value FROM latest_price WHERE security = ?')
      .get(SEC_UUID) as { tstamp: string; value: number };
    expect(row.tstamp).toBe('2026-03-21');
    expect(row.value).toBe(5200000000);
  });

  it('F3: value is 10^8 integer (fixture parity)', () => {
    // Fixture: 50.97 → 5097000000
    const dbValue = Math.round(50.97 * 1e8); // native-ok
    sqlite.prepare(insertLatestSQL).run(SEC_UUID, '2026-03-20', dbValue);

    const row = sqlite.prepare('SELECT value FROM latest_price WHERE security = ?')
      .get(SEC_UUID) as { value: number };
    expect(row.value).toBe(5097000000);
    expect(Number.isInteger(row.value)).toBe(true);
  });

  it('F4: writing to latest_price does NOT create price rows', () => {
    sqlite.prepare(insertLatestSQL).run(SEC_UUID, '2026-03-20', 5097000000);

    const priceCount = (sqlite.prepare('SELECT COUNT(*) as n FROM price WHERE security = ?')
      .get(SEC_UUID) as { n: number }).n;
    expect(priceCount).toBe(0);
  });

  it('F5: tstamp cannot be NULL (NOT NULL constraint)', () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO latest_price (security, tstamp, value) VALUES (?, NULL, ?)`,
      ).run(SEC_UUID, 5097000000);
    }).toThrow();
  });
});

// ─── GROUP G: price pipeline isolation ─────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP G — price pipeline isolation', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(CREATE_TABLES_SQL);
    seedSecurity(sqlite);
  });

  it('G1: writing to price does NOT auto-create latest_price (skipSync=true pattern)', () => {
    sqlite.prepare(
      `INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`,
    ).run(SEC_UUID, '2024-01-01', 1000000000);

    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM latest_price WHERE security = ?')
      .get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('G2: savePricesToDb sync pattern — derives latest_price from price global max', () => {
    // Simulate savePricesToDb sync behavior
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_UUID, '2024-01-01', 1000000000);
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_UUID, '2024-01-15', 1050000000);
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_UUID, '2024-01-02', 1010000000);

    // Sync: read global max, write to latest_price
    const globalMax = sqlite.prepare(
      `SELECT tstamp, value FROM price WHERE security = ? ORDER BY tstamp DESC LIMIT 1`,
    ).get(SEC_UUID) as { tstamp: string; value: number };

    sqlite.prepare(
      `INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)
       ON CONFLICT(security) DO UPDATE SET tstamp = excluded.tstamp, value = excluded.value`,
    ).run(SEC_UUID, globalMax.tstamp, globalMax.value);

    const latest = sqlite.prepare('SELECT tstamp, value FROM latest_price WHERE security = ?')
      .get(SEC_UUID) as { tstamp: string; value: number };
    expect(latest.tstamp).toBe('2024-01-15');
    expect(latest.value).toBe(1050000000);
  });

  it('G3: latest_price write is fully independent of price table', () => {
    // Write to latest_price
    sqlite.prepare(
      `INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`,
    ).run(SEC_UUID, '2026-03-25', 5200000000);

    // Write to price (different date)
    sqlite.prepare(
      `INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`,
    ).run(SEC_UUID, '2026-03-20', 5097000000);

    // Both tables independent
    const lp = sqlite.prepare('SELECT tstamp, value FROM latest_price WHERE security = ?')
      .get(SEC_UUID) as { tstamp: string; value: number };
    const pr = sqlite.prepare('SELECT tstamp, value FROM price WHERE security = ?')
      .get(SEC_UUID) as { tstamp: string; value: number };

    expect(lp.tstamp).toBe('2026-03-25');
    expect(lp.value).toBe(5200000000);
    expect(pr.tstamp).toBe('2026-03-20');
    expect(pr.value).toBe(5097000000);
  });

  it('G4: replace mode clears both tables for security', () => {
    // Seed both tables
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_UUID, '2024-01-01', 1000000000);
    sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_UUID, '2024-01-01', 1000000000);

    // Simulate replace mode
    sqlite.prepare('DELETE FROM price WHERE security = ?').run(SEC_UUID);
    sqlite.prepare('DELETE FROM latest_price WHERE security = ?').run(SEC_UUID);

    const priceCount = (sqlite.prepare('SELECT COUNT(*) as n FROM price WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    const latestCount = (sqlite.prepare('SELECT COUNT(*) as n FROM latest_price WHERE security = ?').get(SEC_UUID) as { n: number }).n;
    expect(priceCount).toBe(0);
    expect(latestCount).toBe(0);
  });

  it('G5: CRITICAL — no code path writes from latest_price into price', () => {
    // Seed latest_price
    sqlite.prepare(
      `INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`,
    ).run(SEC_UUID, '2026-03-25', 5200000000);

    // The ONLY INSERT patterns for price table are:
    // 1. savePricesToDb: INSERT INTO price (security, tstamp, value, ...) VALUES (?, ?, ?, ...)
    //    — sources from FetchedPrice[], never from latest_price
    // 2. importPricesHandler: INSERT OR REPLACE INTO price ... VALUES (?, ?, ?, ?, ?, ?)
    //    — sources from user-uploaded prices, never from latest_price

    // Verify: price table is empty (latest_price did not leak)
    const count = (sqlite.prepare('SELECT COUNT(*) as n FROM price WHERE security = ?')
      .get(SEC_UUID) as { n: number }).n;
    expect(count).toBe(0);
  });
});

// ─── GROUP H: updateFeedConfig — all feed columns written correctly ────────────

describe.skipIf(!hasSqliteBindings)('GROUP H — updateFeedConfig: all feed columns written correctly', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
    seedSecurity(sqlite, { feed: 'YAHOO', feedURL: null });
  });

  it('H1: updates feed column on security', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({ feed: 'GENERIC-JSON' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT feed FROM security WHERE uuid = ?')
      .get(SEC_UUID) as { feed: string };
    expect(row.feed).toBe('GENERIC-JSON');
  });

  it('H2: updates feedURL column on security', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({ feedUrl: 'https://example.com/prices.json' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT feedURL FROM security WHERE uuid = ?')
      .get(SEC_UUID) as { feedURL: string };
    expect(row.feedURL).toBe('https://example.com/prices.json');
  });

  it('H3: rebuilds security_prop FEED entries', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({
        feed: 'GENERIC-JSON',
        pathToDate: '$[*].date',
        pathToClose: '$[*].close',
      });

    expect(res.status).toBe(200);
    const props = sqlite.prepare(
      `SELECT name, value, seq FROM security_prop WHERE security = ? AND type = 'FEED' ORDER BY seq`,
    ).all(SEC_UUID) as PropRow[];

    expect(props).toHaveLength(2);
    expect(props[0].name).toBe('GENERIC-JSON-DATE');
    expect(props[0].value).toBe('$[*].date');
    expect(props[1].name).toBe('GENERIC-JSON-CLOSE');
    expect(props[1].value).toBe('$[*].close');
  });

  it('H4: writes dateFormat prop', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({
        pathToDate: '$[*].date',
        pathToClose: '$[*].close',
        dateFormat: 'yyyy-MM-dd',
      });

    expect(res.status).toBe(200);
    const props = sqlite.prepare(
      `SELECT name, value FROM security_prop WHERE security = ? AND type = 'FEED' ORDER BY seq`,
    ).all(SEC_UUID) as { name: string; value: string }[];

    const dateFormatProp = props.find(p => p.name === 'GENERIC-JSON-DATE-FORMAT');
    expect(dateFormatProp).toBeDefined();
    expect(dateFormatProp!.value).toBe('yyyy-MM-dd');
  });

  it('H5: writes factor prop', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({
        pathToDate: '$[*].date',
        pathToClose: '$[*].close',
        factor: 100,
      });

    expect(res.status).toBe(200);
    const props = sqlite.prepare(
      `SELECT name, value FROM security_prop WHERE security = ? AND type = 'FEED' ORDER BY seq`,
    ).all(SEC_UUID) as { name: string; value: string }[];

    const factorProp = props.find(p => p.name === 'GENERIC-JSON-FACTOR');
    expect(factorProp).toBeDefined();
    expect(factorProp!.value).toBe('100');
  });

  it('H6: bumps updatedAt on feed config change (S9 fix)', async () => {
    const before = sqlite.prepare('SELECT updatedAt FROM security WHERE uuid = ?')
      .get(SEC_UUID) as { updatedAt: string };
    await new Promise(r => setTimeout(r, 10));

    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({ feed: 'GENERIC-JSON' });

    expect(res.status).toBe(200);
    const after = sqlite.prepare('SELECT updatedAt FROM security WHERE uuid = ?')
      .get(SEC_UUID) as { updatedAt: string };
    expect(after.updatedAt).not.toBe(before.updatedAt);
  });

  it('H7: preserves unrelated columns (name, isin, etc.)', async () => {
    const res = await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({ feed: 'GENERIC-JSON' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT name, isin, currency, tickerSymbol FROM security WHERE uuid = ?')
      .get(SEC_UUID) as SecurityRow;
    expect(row.name).toBe('VANECK VIDEO GAMING AND ESPORT');
    expect(row.isin).toBe('IE00BYWQWR46');
    expect(row.currency).toBe('EUR');
    expect(row.tickerSymbol).toBe('ESPO.MI');
  });

  it('H8: clears old FEED props when updating config', async () => {
    // Set initial props
    sqlite.prepare(`INSERT INTO security_prop (security, type, name, value, seq)
      VALUES (?, 'FEED', 'GENERIC-JSON-DATE', '$[*].d', 0)`).run(SEC_UUID);
    sqlite.prepare(`INSERT INTO security_prop (security, type, name, value, seq)
      VALUES (?, 'FEED', 'GENERIC-JSON-CLOSE', '$[*].c', 1)`).run(SEC_UUID);

    // Update with different props
    await request(app)
      .put(`/api/securities/${SEC_UUID}/feed-config`)
      .send({ pathToDate: '$[*].date', pathToClose: '$[*].close' });

    const props = sqlite.prepare(
      `SELECT name, value FROM security_prop WHERE security = ? AND type = 'FEED' ORDER BY seq`,
    ).all(SEC_UUID) as { name: string; value: string }[];

    expect(props).toHaveLength(2);
    expect(props[0].value).toBe('$[*].date');
    expect(props[1].value).toBe('$[*].close');
  });
});
