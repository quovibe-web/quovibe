/**
 * Watchlist Write-Parity Tests
 *
 * Ground truth: docs/audit/fixtures/watchlist.json
 *
 * Strategy:
 *   - Call API endpoints via supertest
 *   - Read back raw rows with direct SQL (never through service read layer)
 *   - Compare every column against expected values
 *   - watchlist_security rows in the real DB are all empty; synthetic data is used
 *     for add/remove/reorder/duplicate security tests, per the fixture note.
 *
 * Groups:
 *   A — POST /api/watchlists (create)
 *   B — GET  /api/watchlists (list with securities)
 *   C — PUT  /api/watchlists/:id (rename)
 *   D — DELETE /api/watchlists/:id (delete + cascade)
 *   E — POST /api/watchlists/:id/duplicate
 *   F — POST /api/watchlists/:id/securities (add security)
 *   G — DELETE /api/watchlists/:id/securities/:securityId (remove)
 *   H — PUT  /api/watchlists/reorder (reorder watchlists)
 *   I — PUT  /api/watchlists/:id/securities/reorder
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

// ─── Skip if native SQLite bindings are unavailable ────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Schema SQL ─────────────────────────────────────────────────────────────
// Minimal schema required by the watchlist routes and their dependencies.

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

// ─── Helpers ────────────────────────────────────────────────────────────────

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

interface WatchlistRow {
  _id: number;
  name: string;
  _order: number;
}

interface WatchlistSecurityRow {
  list: number;
  security: string;
}

// Fixture-derived UUIDs from docs/audit/fixtures/security.json
const SEC_UUID_1 = '04db1b60-9230-4c5b-a070-613944e91dc3';
const SEC_UUID_2 = 'b1d2c3e4-f5a6-7890-abcd-ef1234567890';

function seedSecurity(sqlite: Database.Database, uuid: string, name: string) {
  sqlite.prepare(`
    INSERT INTO security (uuid, name, currency, isin, tickerSymbol, isRetired, updatedAt)
    VALUES (?, ?, 'EUR', NULL, NULL, 0, '2024-01-01T00:00:00Z')
  `).run(uuid, name);
}

function seedWatchlist(sqlite: Database.Database, name: string, order: number): number {
  const result = sqlite.prepare(
    'INSERT INTO watchlist (name, _order) VALUES (?, ?) RETURNING _id'
  ).get(name, order) as { _id: number };
  return result._id;
}

function seedWatchlistSecurity(sqlite: Database.Database, listId: number, securityUuid: string) {
  sqlite.prepare('INSERT INTO watchlist_security (list, security) VALUES (?, ?)').run(listId, securityUuid);
}

// ─── GROUP A: POST /api/watchlists (create) ──────────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP A — create watchlist', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('A1: writes name and _order=0 when DB is empty', async () => {
    const res = await request(app)
      .post('/api/watchlists')
      .send({ name: 'Watchlist (ETF - ETN - ETC)' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Watchlist (ETF - ETN - ETC)');
    expect(res.body.id).toBeDefined();

    const row = sqlite.prepare('SELECT * FROM watchlist WHERE _id = ?').get(res.body.id) as WatchlistRow;
    expect(row.name).toBe('Watchlist (ETF - ETN - ETC)');
    expect(row._order).toBe(0);
  });

  it('A2: _order increments from existing max', async () => {
    seedWatchlist(sqlite, 'First', 39156);

    const res = await request(app)
      .post('/api/watchlists')
      .send({ name: 'Second' });

    expect(res.status).toBe(201);
    const row = sqlite.prepare('SELECT _order FROM watchlist WHERE _id = ?').get(res.body.id) as { _order: number };
    expect(row._order).toBe(39157);
  });

  it('A3: response includes empty securities array', async () => {
    const res = await request(app)
      .post('/api/watchlists')
      .send({ name: 'Empty' });

    expect(res.status).toBe(201);
    expect(res.body.securities).toEqual([]);
  });

  it('A4: rejects missing name with 400', async () => {
    const res = await request(app)
      .post('/api/watchlists')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─── GROUP B: GET /api/watchlists (list) ─────────────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP B — list watchlists', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('B1: returns empty array when no watchlists', async () => {
    const res = await request(app).get('/api/watchlists');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('B2: returns watchlists ordered by _order ASC', async () => {
    seedWatchlist(sqlite, 'Watchlist (Index)', 39170);
    seedWatchlist(sqlite, 'Watchlist (ETF - ETN - ETC)', 39156);
    seedWatchlist(sqlite, 'Watchlist (Obbligazioni)', 39162);

    const res = await request(app).get('/api/watchlists');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].name).toBe('Watchlist (ETF - ETN - ETC)');
    expect(res.body[1].name).toBe('Watchlist (Obbligazioni)');
    expect(res.body[2].name).toBe('Watchlist (Index)');
  });

  it('B3: returns empty securities array for watchlist with no securities', async () => {
    seedWatchlist(sqlite, 'Watchlist (ETF - ETN - ETC)', 39156);

    const res = await request(app).get('/api/watchlists');
    expect(res.status).toBe(200);
    expect(res.body[0].securities).toEqual([]);
  });

  it('B4: returns securities with price data for watchlist with assigned securities', async () => {
    const listId = seedWatchlist(sqlite, 'Watchlist (ETF - ETN - ETC)', 39156);
    seedSecurity(sqlite, SEC_UUID_1, 'VANECK VIDEO GAMING AND ESPORT');
    // Seed latest_price: value=3050000000 → 30.50
    sqlite.prepare(
      'INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)'
    ).run(SEC_UUID_1, '2026-03-28', 305000000000);
    // Seed historical price: value=3000000000 → 30.00 (previousClose)
    sqlite.prepare(
      'INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)'
    ).run(SEC_UUID_1, '2026-03-27', 300000000000);
    seedWatchlistSecurity(sqlite, listId, SEC_UUID_1);

    const res = await request(app).get('/api/watchlists');
    expect(res.status).toBe(200);
    const secs = res.body[0].securities;
    expect(secs).toHaveLength(1);
    expect(secs[0].id).toBe(SEC_UUID_1);
    expect(secs[0].name).toBe('VANECK VIDEO GAMING AND ESPORT');
    expect(secs[0].currency).toBe('EUR');
    expect(secs[0].latestPrice).toBeCloseTo(3050, 0);
    expect(secs[0].latestPriceDate).toBe('2026-03-28');
    expect(secs[0].previousClose).toBeCloseTo(3000, 0);
  });

  it('B5: latestPrice and previousClose are null when no price data', async () => {
    const listId = seedWatchlist(sqlite, 'Watchlist (ETF - ETN - ETC)', 39156);
    seedSecurity(sqlite, SEC_UUID_1, 'VANECK VIDEO GAMING AND ESPORT');
    seedWatchlistSecurity(sqlite, listId, SEC_UUID_1);

    const res = await request(app).get('/api/watchlists');
    expect(res.status).toBe(200);
    const sec = res.body[0].securities[0];
    expect(sec.latestPrice).toBeNull();
    expect(sec.previousClose).toBeNull();
  });
});

// ─── GROUP C: PUT /api/watchlists/:id (rename) ───────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP C — rename watchlist', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('C1: updates name in DB', async () => {
    const id = seedWatchlist(sqlite, 'Old Name', 0);

    const res = await request(app)
      .put(`/api/watchlists/${id}`)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    const row = sqlite.prepare('SELECT name FROM watchlist WHERE _id = ?').get(id) as { name: string };
    expect(row.name).toBe('New Name');
  });

  it('C2: returns 404 for unknown id', async () => {
    const res = await request(app)
      .put('/api/watchlists/9999')
      .send({ name: 'Whatever' });

    expect(res.status).toBe(404);
  });
});

// ─── GROUP D: DELETE /api/watchlists/:id ─────────────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP D — delete watchlist', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('D1: removes watchlist row from DB', async () => {
    const id = seedWatchlist(sqlite, 'To Delete', 0);

    const res = await request(app).delete(`/api/watchlists/${id}`);

    expect(res.status).toBe(204);
    const row = sqlite.prepare('SELECT _id FROM watchlist WHERE _id = ?').get(id);
    expect(row).toBeUndefined();
  });

  it('D2: cascades — removes watchlist_security rows for that list', async () => {
    const id = seedWatchlist(sqlite, 'To Delete', 0);
    seedSecurity(sqlite, SEC_UUID_1, 'Some Security');
    seedWatchlistSecurity(sqlite, id, SEC_UUID_1);

    await request(app).delete(`/api/watchlists/${id}`);

    const rows = sqlite.prepare('SELECT * FROM watchlist_security WHERE list = ?').all(id);
    expect(rows).toHaveLength(0);
  });

  it('D3: returns 404 for unknown id', async () => {
    const res = await request(app).delete('/api/watchlists/9999');
    expect(res.status).toBe(404);
  });
});

// ─── GROUP E: POST /api/watchlists/:id/duplicate ─────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP E — duplicate watchlist', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('E1: creates new watchlist with " (copy)" suffix', async () => {
    const id = seedWatchlist(sqlite, 'Watchlist (ETF - ETN - ETC)', 39156);

    const res = await request(app).post(`/api/watchlists/${id}/duplicate`);

    expect(res.status).toBe(201);
    const row = sqlite.prepare('SELECT name FROM watchlist WHERE _id = ?').get(res.body.id) as { name: string };
    expect(row.name).toBe('Watchlist (ETF - ETN - ETC) (copy)');
  });

  it('E2: duplicate copies all watchlist_security rows', async () => {
    const id = seedWatchlist(sqlite, 'Original', 0);
    seedSecurity(sqlite, SEC_UUID_1, 'Security A');
    seedSecurity(sqlite, SEC_UUID_2, 'Security B');
    seedWatchlistSecurity(sqlite, id, SEC_UUID_1);
    seedWatchlistSecurity(sqlite, id, SEC_UUID_2);

    const res = await request(app).post(`/api/watchlists/${id}/duplicate`);

    expect(res.status).toBe(201);
    const newId = res.body.id as number;
    const rows = sqlite.prepare(
      'SELECT security FROM watchlist_security WHERE list = ? ORDER BY security'
    ).all(newId) as Array<{ security: string }>;
    expect(rows.map(r => r.security).sort()).toEqual([SEC_UUID_1, SEC_UUID_2].sort());
  });

  it('E3: duplicate _order is max+1', async () => {
    seedWatchlist(sqlite, 'First', 39156);
    const id = seedWatchlist(sqlite, 'Second', 39162);

    const res = await request(app).post(`/api/watchlists/${id}/duplicate`);

    expect(res.status).toBe(201);
    const row = sqlite.prepare('SELECT _order FROM watchlist WHERE _id = ?').get(res.body.id) as { _order: number };
    expect(row._order).toBe(39163);
  });

  it('E4: returns 404 for unknown id', async () => {
    const res = await request(app).post('/api/watchlists/9999/duplicate');
    expect(res.status).toBe(404);
  });
});

// ─── GROUP F: POST /api/watchlists/:id/securities (add) ──────────────────

describe.skipIf(!hasSqliteBindings)('GROUP F — add security to watchlist', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('F1: inserts watchlist_security row', async () => {
    const id = seedWatchlist(sqlite, 'Watchlist (ETF - ETN - ETC)', 39156);
    seedSecurity(sqlite, SEC_UUID_1, 'VANECK VIDEO GAMING AND ESPORT');

    const res = await request(app)
      .post(`/api/watchlists/${id}/securities`)
      .send({ securityId: SEC_UUID_1 });

    expect(res.status).toBe(201);
    const row = sqlite.prepare(
      'SELECT * FROM watchlist_security WHERE list = ? AND security = ?'
    ).get(id, SEC_UUID_1) as WatchlistSecurityRow | undefined;
    expect(row).toBeDefined();
    expect(row!.list).toBe(id);
    expect(row!.security).toBe(SEC_UUID_1);
  });

  it('F2: returns 409 when security already in watchlist', async () => {
    const id = seedWatchlist(sqlite, 'Watchlist', 0);
    seedSecurity(sqlite, SEC_UUID_1, 'Security');
    seedWatchlistSecurity(sqlite, id, SEC_UUID_1);

    const res = await request(app)
      .post(`/api/watchlists/${id}/securities`)
      .send({ securityId: SEC_UUID_1 });

    expect(res.status).toBe(409);
  });

  it('F3: returns 404 for unknown watchlist', async () => {
    const res = await request(app)
      .post('/api/watchlists/9999/securities')
      .send({ securityId: SEC_UUID_1 });

    expect(res.status).toBe(404);
  });
});

// ─── GROUP G: DELETE /api/watchlists/:id/securities/:securityId ──────────

describe.skipIf(!hasSqliteBindings)('GROUP G — remove security from watchlist', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('G1: removes the watchlist_security row', async () => {
    const id = seedWatchlist(sqlite, 'Watchlist', 0);
    seedSecurity(sqlite, SEC_UUID_1, 'Security');
    seedWatchlistSecurity(sqlite, id, SEC_UUID_1);

    const res = await request(app).delete(`/api/watchlists/${id}/securities/${SEC_UUID_1}`);

    expect(res.status).toBe(204);
    const row = sqlite.prepare(
      'SELECT * FROM watchlist_security WHERE list = ? AND security = ?'
    ).get(id, SEC_UUID_1);
    expect(row).toBeUndefined();
  });

  it('G2: does not remove other securities in the same watchlist', async () => {
    const id = seedWatchlist(sqlite, 'Watchlist', 0);
    seedSecurity(sqlite, SEC_UUID_1, 'Security A');
    seedSecurity(sqlite, SEC_UUID_2, 'Security B');
    seedWatchlistSecurity(sqlite, id, SEC_UUID_1);
    seedWatchlistSecurity(sqlite, id, SEC_UUID_2);

    await request(app).delete(`/api/watchlists/${id}/securities/${SEC_UUID_1}`);

    const row = sqlite.prepare(
      'SELECT * FROM watchlist_security WHERE list = ? AND security = ?'
    ).get(id, SEC_UUID_2);
    expect(row).toBeDefined();
  });

  it('G3: returns 404 for unknown watchlist', async () => {
    const res = await request(app).delete(`/api/watchlists/9999/securities/${SEC_UUID_1}`);
    expect(res.status).toBe(404);
  });
});

// ─── GROUP H: PUT /api/watchlists/reorder ────────────────────────────────

describe.skipIf(!hasSqliteBindings)('GROUP H — reorder watchlists', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('H1: assigns _order = position index for each id', async () => {
    const id1 = seedWatchlist(sqlite, 'First', 0);
    const id2 = seedWatchlist(sqlite, 'Second', 1);
    const id3 = seedWatchlist(sqlite, 'Third', 2);

    const res = await request(app)
      .put('/api/watchlists/reorder')
      .send({ ids: [id3, id1, id2] });

    expect(res.status).toBe(200);

    const r1 = sqlite.prepare('SELECT _order FROM watchlist WHERE _id = ?').get(id3) as { _order: number };
    const r2 = sqlite.prepare('SELECT _order FROM watchlist WHERE _id = ?').get(id1) as { _order: number };
    const r3 = sqlite.prepare('SELECT _order FROM watchlist WHERE _id = ?').get(id2) as { _order: number };
    expect(r1._order).toBe(0);
    expect(r2._order).toBe(1);
    expect(r3._order).toBe(2);
  });
});

// ─── GROUP I: PUT /api/watchlists/:id/securities/reorder ─────────────────

describe.skipIf(!hasSqliteBindings)('GROUP I — reorder securities in watchlist', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ app, sqlite } = createTestApp());
  });

  it('I1: re-inserts securities in the specified order', async () => {
    const id = seedWatchlist(sqlite, 'Watchlist', 0);
    seedSecurity(sqlite, SEC_UUID_1, 'Security A');
    seedSecurity(sqlite, SEC_UUID_2, 'Security B');
    seedWatchlistSecurity(sqlite, id, SEC_UUID_1);
    seedWatchlistSecurity(sqlite, id, SEC_UUID_2);

    const res = await request(app)
      .put(`/api/watchlists/${id}/securities/reorder`)
      .send({ securityIds: [SEC_UUID_2, SEC_UUID_1] });

    expect(res.status).toBe(200);
    // After reorder: rowid order reflects insertion order (SEC_UUID_2 first)
    const rows = sqlite.prepare(
      'SELECT security FROM watchlist_security WHERE list = ? ORDER BY rowid'
    ).all(id) as Array<{ security: string }>;
    expect(rows[0].security).toBe(SEC_UUID_2);
    expect(rows[1].security).toBe(SEC_UUID_1);
  });

  it('I2: returns 404 for unknown watchlist', async () => {
    const res = await request(app)
      .put('/api/watchlists/9999/securities/reorder')
      .send({ securityIds: [SEC_UUID_1] });

    expect(res.status).toBe(404);
  });
});
