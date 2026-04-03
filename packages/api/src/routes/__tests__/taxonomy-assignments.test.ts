import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

function createTestDb(sqlite: Database.Database): void {
  sqlite.pragma('foreign_keys = OFF');

  sqlite.exec(`
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
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
  `);
}

const taxonomyId = 'tax-uuid-1';
const rootCatId = 'root-cat-1';
const catAId = 'cat-a-1';
const catBId = 'cat-b-1';
const securityId = 'sec-uuid-1';

function seedData(sqlite: Database.Database): void {
  sqlite.exec(`INSERT INTO taxonomy (uuid, name, root) VALUES ('${taxonomyId}', 'Test Tax', '${rootCatId}')`);
  sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('${rootCatId}', '${taxonomyId}', NULL, 'Root', '#000', 0, 0)`);
  sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('${catAId}', '${taxonomyId}', '${rootCatId}', 'Cat A', '#f00', 0, 0)`);
  sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('${catBId}', '${taxonomyId}', '${rootCatId}', 'Cat B', '#0f0', 0, 1)`);
  sqlite.exec(`INSERT INTO security (uuid, name) VALUES ('${securityId}', 'Test Security')`);
}

describe.skipIf(!hasSqliteBindings)('Taxonomy Assignment CRUD', () => {
  let sqlite: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    createTestDb(sqlite);
    seedData(sqlite);
    const db = drizzle(sqlite, { schema });
    app = createApp(db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  // --- POST /api/taxonomies/:id/assignments ---

  it('POST creates assignment with default weight 10000 for first assignment', async () => {
    const res = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');

    // Verify in DB
    const row = sqlite.prepare(
      `SELECT * FROM taxonomy_assignment WHERE _id = ?`,
    ).get(res.body.id) as Record<string, unknown>;
    expect(row.item).toBe(securityId);
    expect(row.category).toBe(catAId);
    expect(row.taxonomy).toBe(taxonomyId);
    expect(row.item_type).toBe('security');
    expect(row.weight).toBe(10000);
  });

  it('POST creates second assignment with remainder weight', async () => {
    // First assignment: 10000
    await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId });

    // Second assignment: remainder = 10000 - 10000 = 0
    const res = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catBId });

    expect(res.status).toBe(201);

    const row = sqlite.prepare(
      `SELECT weight FROM taxonomy_assignment WHERE _id = ?`,
    ).get(res.body.id) as { weight: number };
    expect(row.weight).toBe(0);
  });

  it('POST merges when assigning same item to same category (capped at 10000)', async () => {
    // First assignment with weight 6000
    const res1 = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId, weight: 6000 });
    expect(res1.status).toBe(201);
    const firstId = res1.body.id;

    // Second assignment to same category — should merge, not create new
    const res2 = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId, weight: 7000 });
    expect(res2.status).toBe(201);
    // Should return same id (merged)
    expect(res2.body.id).toBe(firstId);

    // Weight should be capped at 10000 (6000 + 7000 = 13000 → 10000)
    const row = sqlite.prepare(
      `SELECT weight FROM taxonomy_assignment WHERE _id = ?`,
    ).get(firstId) as { weight: number };
    expect(row.weight).toBe(10000);
  });

  // --- PATCH /api/taxonomies/:id/assignments/:assignmentId ---

  it('PATCH moves assignment to a different category', async () => {
    // Create assignment in Cat A
    const createRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId });
    const assignmentId = createRes.body.id;

    // Move to Cat B
    const res = await request(app)
      .patch(`/api/taxonomies/${taxonomyId}/assignments/${assignmentId}`)
      .send({ categoryId: catBId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const row = sqlite.prepare(
      `SELECT category FROM taxonomy_assignment WHERE _id = ?`,
    ).get(assignmentId) as { category: string };
    expect(row.category).toBe(catBId);
  });

  it('PATCH merges weights on move when target category has same item (capped at 10000)', async () => {
    // Assignment in Cat A with weight 6000
    const res1 = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId, weight: 6000 });
    const srcId = res1.body.id;

    // Assignment in Cat B with weight 5000
    const res2 = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catBId, weight: 5000 });
    const targetId = res2.body.id;

    // Move srcId (6000) to Cat B — should merge with targetId (5000)
    const patchRes = await request(app)
      .patch(`/api/taxonomies/${taxonomyId}/assignments/${srcId}`)
      .send({ categoryId: catBId });

    expect(patchRes.status).toBe(200);

    // Source assignment should be deleted
    const srcRow = sqlite.prepare(
      `SELECT * FROM taxonomy_assignment WHERE _id = ?`,
    ).get(srcId);
    expect(srcRow).toBeUndefined();

    // Target should have merged weight capped at 10000 (5000 + 6000 = 11000 → 10000)
    const targetRow = sqlite.prepare(
      `SELECT weight FROM taxonomy_assignment WHERE _id = ?`,
    ).get(targetId) as { weight: number };
    expect(targetRow.weight).toBe(10000);
  });

  it('PATCH deletes assignment when weight set to 0', async () => {
    const createRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId });
    const assignmentId = createRes.body.id;

    const res = await request(app)
      .patch(`/api/taxonomies/${taxonomyId}/assignments/${assignmentId}`)
      .send({ weight: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Assignment should be gone
    const row = sqlite.prepare(
      `SELECT * FROM taxonomy_assignment WHERE _id = ?`,
    ).get(assignmentId);
    expect(row).toBeUndefined();
  });

  it('PATCH returns 404 for nonexistent assignment', async () => {
    const res = await request(app)
      .patch(`/api/taxonomies/${taxonomyId}/assignments/99999`)
      .send({ weight: 5000 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Assignment not found' });
  });

  // --- DELETE /api/taxonomies/:id/assignments/:assignmentId ---

  it('DELETE removes assignment and its data', async () => {
    // Create assignment
    const createRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({ itemId: securityId, itemType: 'security', categoryId: catAId });
    const assignmentId = createRes.body.id;

    // Insert some assignment_data
    sqlite.prepare(
      `INSERT INTO taxonomy_assignment_data (assignment, name, type, value) VALUES (?, ?, ?, ?)`,
    ).run(assignmentId, 'note', 'string', 'test note');

    // Delete
    const res = await request(app)
      .delete(`/api/taxonomies/${taxonomyId}/assignments/${assignmentId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Assignment should be gone
    const assignmentRow = sqlite.prepare(
      `SELECT * FROM taxonomy_assignment WHERE _id = ?`,
    ).get(assignmentId);
    expect(assignmentRow).toBeUndefined();

    // Assignment data should also be gone
    const dataRow = sqlite.prepare(
      `SELECT * FROM taxonomy_assignment_data WHERE assignment = ?`,
    ).get(assignmentId);
    expect(dataRow).toBeUndefined();
  });

  it('DELETE returns 404 for nonexistent assignment', async () => {
    const res = await request(app)
      .delete(`/api/taxonomies/${taxonomyId}/assignments/99999`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Assignment not found' });
  });
});
