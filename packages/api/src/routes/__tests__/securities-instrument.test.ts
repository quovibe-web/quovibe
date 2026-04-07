import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

let hasSqliteBindings = false;
try { new Database(':memory:').close(); hasSqliteBindings = true; } catch {}

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      isin TEXT, tickerSymbol TEXT, wkn TEXT,
      currency TEXT DEFAULT 'EUR',
      note TEXT, isRetired INTEGER DEFAULT 0,
      feedURL TEXT, feed TEXT, latestFeedURL TEXT, latestFeed TEXT,
      feedTickerSymbol TEXT, calendar TEXT,
      updatedAt TEXT NOT NULL DEFAULT '',
      onlineId TEXT,
      targetCurrency TEXT
    );
    CREATE TABLE attribute_type (
      _id INTEGER PRIMARY KEY, id TEXT NOT NULL,
      name TEXT NOT NULL, columnLabel TEXT,
      target TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
      converterClass TEXT NOT NULL DEFAULT '', props_json TEXT
    );
    CREATE TABLE security_attr (
      security TEXT NOT NULL, attr_uuid TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'string', value TEXT,
      seq INT NOT NULL DEFAULT 0,
      PRIMARY KEY (security, attr_uuid)
    );
    CREATE TABLE security_prop (
      security TEXT NOT NULL, type TEXT NOT NULL,
      name TEXT NOT NULL, value TEXT, seq INTEGER DEFAULT 0
    );
    CREATE TABLE taxonomy (
      _id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL, name TEXT NOT NULL, root TEXT NOT NULL
    );
    CREATE TABLE taxonomy_category (
      _id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL,
      taxonomy TEXT NOT NULL, parent TEXT, name TEXT NOT NULL,
      color TEXT NOT NULL, weight INTEGER NOT NULL, rank INTEGER NOT NULL
    );
    CREATE TABLE taxonomy_assignment (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy TEXT NOT NULL, category TEXT NOT NULL, item_type TEXT NOT NULL,
      item TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 10000, rank INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE taxonomy_assignment_data (
      assignment INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL
    );
    CREATE TABLE latest_price (security TEXT PRIMARY KEY, tstamp TEXT, value INTEGER NOT NULL, open INTEGER, high INTEGER, low INTEGER, volume INTEGER);
    CREATE TABLE price (security TEXT, tstamp TEXT NOT NULL, value INTEGER NOT NULL, open INTEGER, high INTEGER, low INTEGER, volume INTEGER, PRIMARY KEY (security, tstamp));
    CREATE TABLE property (name TEXT PRIMARY KEY, special INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL);
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
    INSERT INTO attribute_type (_id, id, name, columnLabel, target, type, converterClass)
    VALUES (1, 'attr-logo', 'Logo', 'Logo', 'SECURITY', 'STRING', '');
  `);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe.skipIf(!hasSqliteBindings)('securities extended endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  it('POST /api/securities creates security with calendar', async () => {
    const res = await request(app).post('/api/securities').send({
      name: 'NVIDIA',
      currency: 'USD',
      calendar: 'NYSE',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('NVIDIA');
    expect(res.body.calendar).toBe('NYSE');
  });

  it('PUT /api/securities/:id updates calendar and isRetired', async () => {
    const create = await request(app).post('/api/securities').send({ name: 'Test', currency: 'EUR' });
    const id = create.body.id as string;

    const res = await request(app).put(`/api/securities/${id}`).send({
      calendar: 'LSE',
      isRetired: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.calendar).toBe('LSE');
    expect(res.body.isRetired).toBe(true);
  });

  it('GET /api/securities/:id returns attributes and taxonomyAssignments', async () => {
    const create = await request(app).post('/api/securities').send({ name: 'VWCE', currency: 'EUR' });
    const id = create.body.id as string;

    sqlite.prepare('INSERT INTO security_attr (security, attr_uuid, value) VALUES (?, ?, ?)').run(id, 'attr-logo', 'https://logo.png');

    const res = await request(app).get(`/api/securities/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.attributes).toBeDefined();
    expect(res.body.attributes).toHaveLength(1);
    expect(res.body.attributes[0]).toMatchObject({ typeId: 'attr-logo', value: 'https://logo.png' });
    expect(res.body.taxonomyAssignments).toBeDefined();
    expect(res.body.taxonomyAssignments).toHaveLength(0);
  });

  it('PUT /api/securities/:id/attributes replaces all attributes atomically', async () => {
    const create = await request(app).post('/api/securities').send({ name: 'AAPL', currency: 'USD' });
    const id = create.body.id as string;

    // First PUT — set one attribute
    const put1 = await request(app)
      .put(`/api/securities/${id}/attributes`)
      .send({ attributes: [{ typeId: 'attr-logo', value: 'https://first.png' }] });
    expect(put1.status).toBe(200);
    expect(put1.body.ok).toBe(true);

    // Verify it was saved
    const get1 = await request(app).get(`/api/securities/${id}`);
    expect(get1.body.attributes).toHaveLength(1);
    expect(get1.body.attributes[0].value).toBe('https://first.png');

    // Second PUT — replace with different value
    const put2 = await request(app)
      .put(`/api/securities/${id}/attributes`)
      .send({ attributes: [{ typeId: 'attr-logo', value: 'https://second.png' }] });
    expect(put2.status).toBe(200);

    const get2 = await request(app).get(`/api/securities/${id}`);
    expect(get2.body.attributes).toHaveLength(1);
    expect(get2.body.attributes[0].value).toBe('https://second.png');

    // Third PUT — clear all
    const put3 = await request(app)
      .put(`/api/securities/${id}/attributes`)
      .send({ attributes: [] });
    expect(put3.status).toBe(200);
    const get3 = await request(app).get(`/api/securities/${id}`);
    expect(get3.body.attributes).toHaveLength(0);
  });

  it('PUT /api/securities/:id/taxonomy replaces all assignments atomically', async () => {
    sqlite.exec(`
      INSERT INTO taxonomy (_id, uuid, name, root) VALUES (1, 'tax-1', 'Asset Classes', 'root-1');
      INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('root-1', 'tax-1', NULL, 'Root', '#000', 0, 0);
      INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('cat-1', 'tax-1', 'root-1', 'Equity', '#00f', 0, 0);
    `);

    const create = await request(app).post('/api/securities').send({ name: 'MSFT', currency: 'USD' });
    const id = create.body.id as string;

    const put1 = await request(app)
      .put(`/api/securities/${id}/taxonomy`)
      .send({ assignments: [{ categoryId: 'cat-1', taxonomyId: 'tax-1', weight: 100 }] });
    expect(put1.status).toBe(200);
    expect(put1.body.ok).toBe(true);

    const get1 = await request(app).get(`/api/securities/${id}`);
    expect(get1.body.taxonomyAssignments).toHaveLength(1);
    expect(get1.body.taxonomyAssignments[0]).toMatchObject({ categoryId: 'cat-1', taxonomyId: 'tax-1', weight: 100 });

    await request(app)
      .put(`/api/securities/${id}/taxonomy`)
      .send({ assignments: [] });
    const get2 = await request(app).get(`/api/securities/${id}`);
    expect(get2.body.taxonomyAssignments).toHaveLength(0);
  });
});
