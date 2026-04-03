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
    CREATE TABLE attribute_type (
      _id INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      columnLabel TEXT,
      source TEXT,
      target TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      converterClass TEXT NOT NULL DEFAULT '',
      props_json TEXT
    );
    INSERT INTO attribute_type (_id, id, name, columnLabel, target, type, converterClass)
    VALUES (1, 'attr-logo', 'Logo', 'Logo', 'name.abuchen.portfolio.model.Security', 'STRING', 'ImageConverter');
    INSERT INTO attribute_type (_id, id, name, columnLabel, target, type, converterClass)
    VALUES (2, 'attr-ter', 'TER', 'TER %', 'name.abuchen.portfolio.model.Security', 'PERCENT', '');
    INSERT INTO attribute_type (_id, id, name, columnLabel, target, type, converterClass)
    VALUES (3, 'attr-logo-acc', 'Logo', 'Logo', 'name.abuchen.portfolio.model.Account', 'STRING', 'ImageConverter');
    INSERT INTO attribute_type (_id, id, name, columnLabel, target, type, converterClass)
    VALUES (4, 'attr-logo-port', 'Logo', 'Logo', 'name.abuchen.portfolio.model.Portfolio', 'STRING', 'ImageConverter');
  `);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe.skipIf(!hasSqliteBindings)('GET /api/attribute-types', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    app = createApp(db as Parameters<typeof createApp>[0], sqlite);
  });

  it('returns only Security attribute types with converterClass', async () => {
    const res = await request(app).get('/api/attribute-types');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      id: 'attr-logo',
      name: 'Logo',
      converterClass: 'ImageConverter',
    });
    expect(res.body[1]).toMatchObject({
      id: 'attr-ter',
      name: 'TER',
      converterClass: '',
    });
  });
});
