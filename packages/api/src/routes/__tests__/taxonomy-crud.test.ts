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
    CREATE TABLE security (_id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
    CREATE TABLE account (_id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
  `);
}

// ─── Taxonomy CRUD ──────────────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('Taxonomy & Category CRUD', () => {
  let sqlite: Database.Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    createTestDb(sqlite);
    const db = drizzle(sqlite, { schema });
    app = createApp(db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  // ── POST /api/taxonomies ────────────────────────────────────────────────

  it('POST /api/taxonomies — creates empty taxonomy with root category', async () => {
    const res = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'My Taxonomy' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('My Taxonomy');

    const taxonomyId = res.body.id as string;

    // Verify taxonomy row
    const tax = sqlite.prepare('SELECT * FROM taxonomy WHERE uuid = ?').get(taxonomyId) as
      Record<string, unknown> | undefined;
    expect(tax).toBeDefined();
    expect(tax!.name).toBe('My Taxonomy');
    expect(tax!.root).toBeDefined();

    // Verify root category was created
    const rootUuid = tax!.root as string;
    const root = sqlite.prepare('SELECT * FROM taxonomy_category WHERE uuid = ?').get(rootUuid) as
      Record<string, unknown> | undefined;
    expect(root).toBeDefined();
    expect(root!.taxonomy).toBe(taxonomyId);
    expect(root!.parent).toBeNull();

    // Only the root category should exist
    const catCount = (sqlite.prepare(
      'SELECT COUNT(*) as n FROM taxonomy_category WHERE taxonomy = ?',
    ).get(taxonomyId) as { n: number }).n;
    expect(catCount).toBe(1);
  });

  it('POST /api/taxonomies — creates from asset-classes template (6 categories = root + 5)', async () => {
    const res = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Asset Classes', template: 'asset-classes' });

    expect(res.status).toBe(201);
    const taxonomyId = res.body.id as string;

    // asset-classes template has 5 categories: Cash, Equity, Debt, Real Estate, Commodity
    // Plus 1 root = 6 total
    const categories = sqlite.prepare(
      'SELECT * FROM taxonomy_category WHERE taxonomy = ?',
    ).all(taxonomyId) as Record<string, unknown>[];
    expect(categories).toHaveLength(6);

    // Verify root exists
    const tax = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxonomyId) as
      { root: string };
    const rootCat = categories.find((c) => c.uuid === tax.root);
    expect(rootCat).toBeDefined();
    expect(rootCat!.parent).toBeNull();

    // Verify children are parented to root
    const children = categories.filter((c) => c.parent === tax.root);
    expect(children).toHaveLength(5);
    const childNames = children.map((c) => c.name as string).sort();
    expect(childNames).toEqual(['Cash', 'Commodity', 'Debt', 'Equity', 'Real Estate']);
  });

  it('POST /api/taxonomies — returns 400 for invalid template', async () => {
    const res = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Bad', template: 'nonexistent-template' });

    expect(res.status).toBe(400);
  });

  // ── PATCH /api/taxonomies/:id ───────────────────────────────────────────

  it('PATCH /api/taxonomies/:id — renames taxonomy', async () => {
    const createRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Original Name' });
    expect(createRes.status).toBe(201);
    const taxonomyId = createRes.body.id as string;

    const patchRes = await request(app)
      .patch(`/api/taxonomies/${taxonomyId}`)
      .send({ name: 'Renamed Taxonomy' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ok).toBe(true);

    // Verify in DB
    const tax = sqlite.prepare('SELECT name FROM taxonomy WHERE uuid = ?').get(taxonomyId) as
      { name: string };
    expect(tax.name).toBe('Renamed Taxonomy');
  });

  it('PATCH /api/taxonomies/:id — returns 404 for nonexistent taxonomy', async () => {
    const res = await request(app)
      .patch('/api/taxonomies/00000000-0000-0000-0000-000000000000')
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  // ── DELETE /api/taxonomies/:id ──────────────────────────────────────────

  it('DELETE /api/taxonomies/:id — deletes taxonomy and cascades all related data', async () => {
    // Create taxonomy with template
    const createRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'To Delete', template: 'asset-classes' });
    expect(createRes.status).toBe(201);
    const taxonomyId = createRes.body.id as string;

    // Get a category UUID for seeding related data
    const categories = sqlite.prepare(
      'SELECT uuid FROM taxonomy_category WHERE taxonomy = ? AND parent IS NOT NULL',
    ).all(taxonomyId) as { uuid: string }[];
    const catUuid = categories[0].uuid;

    // Seed assignment + taxonomy_data to verify cascade
    sqlite.prepare(
      `INSERT INTO taxonomy_assignment (item, category, taxonomy, item_type, weight, rank)
       VALUES ('sec-1', ?, ?, 'security', 10000, 0)`,
    ).run(catUuid, taxonomyId);
    const assignmentId = (sqlite.prepare(
      'SELECT _id FROM taxonomy_assignment WHERE taxonomy = ?',
    ).get(taxonomyId) as { _id: number })._id;

    sqlite.prepare(
      `INSERT INTO taxonomy_data (category, name, value, taxonomy, type)
       VALUES (?, 'note', 'test', ?, '')`,
    ).run(catUuid, taxonomyId);

    sqlite.prepare(
      `INSERT INTO taxonomy_assignment_data (assignment, name, type, value)
       VALUES (?, 'key', 'string', 'val')`,
    ).run(assignmentId);

    // Verify data exists before delete
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy WHERE uuid = ?').get(taxonomyId) as { n: number }).n).toBe(1);
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_category WHERE taxonomy = ?').get(taxonomyId) as { n: number }).n).toBe(6);
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_assignment WHERE taxonomy = ?').get(taxonomyId) as { n: number }).n).toBe(1);
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_data WHERE taxonomy = ?').get(taxonomyId) as { n: number }).n).toBe(2); // 1 manual + 1 sortOrder from createTaxonomy
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_assignment_data WHERE assignment = ?').get(assignmentId) as { n: number }).n).toBe(1);

    // Delete
    const delRes = await request(app).delete(`/api/taxonomies/${taxonomyId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // Verify all cleaned up
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy WHERE uuid = ?').get(taxonomyId) as { n: number }).n).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_category WHERE taxonomy = ?').get(taxonomyId) as { n: number }).n).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_assignment WHERE taxonomy = ?').get(taxonomyId) as { n: number }).n).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_data WHERE taxonomy = ?').get(taxonomyId) as { n: number }).n).toBe(0);
    expect((sqlite.prepare('SELECT COUNT(*) as n FROM taxonomy_assignment_data WHERE assignment = ?').get(assignmentId) as { n: number }).n).toBe(0);
  });

  it('DELETE /api/taxonomies/:id — returns 404 for nonexistent taxonomy', async () => {
    const res = await request(app).delete('/api/taxonomies/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  // ── POST /api/taxonomies/:id/categories ─────────────────────────────────

  it('POST /api/taxonomies/:id/categories — creates subcategory', async () => {
    const createRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Test Taxonomy' });
    expect(createRes.status).toBe(201);
    const taxonomyId = createRes.body.id as string;

    // Get root category
    const tax = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxonomyId) as
      { root: string };
    const rootId = tax.root;

    const catRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/categories`)
      .send({ name: 'Equities', parentId: rootId, color: '#0000ff' });

    expect(catRes.status).toBe(201);
    expect(catRes.body.id).toBeDefined();

    // Verify in DB
    const cat = sqlite.prepare('SELECT * FROM taxonomy_category WHERE uuid = ?').get(catRes.body.id as string) as
      Record<string, unknown>;
    expect(cat.name).toBe('Equities');
    expect(cat.parent).toBe(rootId);
    expect(cat.taxonomy).toBe(taxonomyId);
    expect(cat.color).toBe('#0000ff');
  });

  it('POST /api/taxonomies/:id/categories — returns 400 for invalid parentId', async () => {
    const createRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Test Taxonomy' });
    expect(createRes.status).toBe(201);
    const taxonomyId = createRes.body.id as string;

    const catRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/categories`)
      .send({ name: 'Orphan', parentId: 'nonexistent-parent-uuid' });

    expect(catRes.status).toBe(400);
    expect(catRes.body.error).toBeDefined();
  });

  // ── PATCH /api/taxonomies/:id/categories/:catId ─────────────────────────

  it('PATCH /api/taxonomies/:id/categories/:catId — renames category', async () => {
    // Create taxonomy + subcategory
    const createRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Test' });
    const taxonomyId = createRes.body.id as string;
    const rootId = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxonomyId) as
      { root: string }).root;

    const catRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/categories`)
      .send({ name: 'Old Name', parentId: rootId });
    expect(catRes.status).toBe(201);
    const catId = catRes.body.id as string;

    const patchRes = await request(app)
      .patch(`/api/taxonomies/${taxonomyId}/categories/${catId}`)
      .send({ name: 'New Name' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ok).toBe(true);

    const cat = sqlite.prepare('SELECT name FROM taxonomy_category WHERE uuid = ?').get(catId) as
      { name: string };
    expect(cat.name).toBe('New Name');
  });

  it('PATCH /api/taxonomies/:id/categories/:catId — reparents category', async () => {
    // Create taxonomy with two children under root
    const createRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Test' });
    const taxonomyId = createRes.body.id as string;
    const rootId = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxonomyId) as
      { root: string }).root;

    const cat1Res = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/categories`)
      .send({ name: 'Parent Cat', parentId: rootId });
    const cat1Id = cat1Res.body.id as string;

    const cat2Res = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/categories`)
      .send({ name: 'Child Cat', parentId: rootId });
    const cat2Id = cat2Res.body.id as string;

    // Reparent cat2 under cat1
    const patchRes = await request(app)
      .patch(`/api/taxonomies/${taxonomyId}/categories/${cat2Id}`)
      .send({ parentId: cat1Id });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.ok).toBe(true);

    const cat = sqlite.prepare('SELECT parent FROM taxonomy_category WHERE uuid = ?').get(cat2Id) as
      { parent: string };
    expect(cat.parent).toBe(cat1Id);
  });

  // ── DELETE /api/taxonomies/:id/categories/:catId ────────────────────────

  it('DELETE /api/taxonomies/:id/categories/:catId — deletes and reparents children', async () => {
    // Create taxonomy: root → parent → child
    const createRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Test' });
    const taxonomyId = createRes.body.id as string;
    const rootId = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxonomyId) as
      { root: string }).root;

    const parentRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/categories`)
      .send({ name: 'Middle', parentId: rootId });
    const middleId = parentRes.body.id as string;

    const childRes = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/categories`)
      .send({ name: 'Leaf', parentId: middleId });
    const leafId = childRes.body.id as string;

    // Delete the middle category
    const delRes = await request(app)
      .delete(`/api/taxonomies/${taxonomyId}/categories/${middleId}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // Middle is gone
    const middle = sqlite.prepare('SELECT uuid FROM taxonomy_category WHERE uuid = ?').get(middleId);
    expect(middle).toBeUndefined();

    // Leaf is reparented to root (middle's parent)
    const leaf = sqlite.prepare('SELECT parent FROM taxonomy_category WHERE uuid = ?').get(leafId) as
      { parent: string };
    expect(leaf.parent).toBe(rootId);
  });

  // ── PATCH /api/taxonomies/:id/reorder ──────────────────────────────────

  describe('Reorder taxonomies (move up / move down)', () => {
    let taxIds: string[];

    /** Create 5 taxonomies A..E and return their IDs in order. */
    async function createFiveTaxonomies(): Promise<string[]> {
      const ids: string[] = [];
      for (const name of ['Tax A', 'Tax B', 'Tax C', 'Tax D', 'Tax E']) {
        const res = await request(app)
          .post('/api/taxonomies')
          .send({ name });
        expect(res.status).toBe(201);
        ids.push(res.body.id as string);
      }
      return ids;
    }

    /** Get the ordered list of taxonomy names from GET /api/taxonomies. */
    async function getOrder(): Promise<string[]> {
      const res = await request(app).get('/api/taxonomies');
      return (res.body as { name: string }[]).map((t) => t.name);
    }

    beforeEach(async () => {
      taxIds = await createFiveTaxonomies();
    });

    it('move up shifts exactly one position', async () => {
      // Move Tax D (idx 3) up → should become idx 2
      const res = await request(app)
        .patch(`/api/taxonomies/${taxIds[3]}/reorder`)
        .send({ direction: 'up' });
      expect(res.status).toBe(200);

      const order = await getOrder();
      expect(order).toEqual(['Tax A', 'Tax B', 'Tax D', 'Tax C', 'Tax E']);
    });

    it('move down shifts exactly one position', async () => {
      // Move Tax B (idx 1) down → should become idx 2
      const res = await request(app)
        .patch(`/api/taxonomies/${taxIds[1]}/reorder`)
        .send({ direction: 'down' });
      expect(res.status).toBe(200);

      const order = await getOrder();
      expect(order).toEqual(['Tax A', 'Tax C', 'Tax B', 'Tax D', 'Tax E']);
    });

    it('move up at top returns 400', async () => {
      const res = await request(app)
        .patch(`/api/taxonomies/${taxIds[0]}/reorder`)
        .send({ direction: 'up' });
      expect(res.status).toBe(400);
    });

    it('move down at bottom returns 400', async () => {
      const res = await request(app)
        .patch(`/api/taxonomies/${taxIds[4]}/reorder`)
        .send({ direction: 'down' });
      expect(res.status).toBe(400);
    });

    it('move E up 4 times → E ends at top, one position per step', async () => {
      const eId = taxIds[4]; // Tax E, initially at position 4

      for (let i = 0; i < 4; i++) {
        const res = await request(app)
          .patch(`/api/taxonomies/${eId}/reorder`)
          .send({ direction: 'up' });
        expect(res.status).toBe(200);
      }

      const order = await getOrder();
      expect(order).toEqual(['Tax E', 'Tax A', 'Tax B', 'Tax C', 'Tax D']);
    });

    it('move E up 5 times → 4 succeed, 5th returns 400 (already at top)', async () => {
      const eId = taxIds[4];

      for (let i = 0; i < 4; i++) {
        const res = await request(app)
          .patch(`/api/taxonomies/${eId}/reorder`)
          .send({ direction: 'up' });
        expect(res.status).toBe(200);
      }

      // 5th move should fail — already at top
      const res = await request(app)
        .patch(`/api/taxonomies/${eId}/reorder`)
        .send({ direction: 'up' });
      expect(res.status).toBe(400);
    });

    it('normalizes sortOrder to consecutive values after swap', async () => {
      // Move Tax C up once
      await request(app)
        .patch(`/api/taxonomies/${taxIds[2]}/reorder`)
        .send({ direction: 'up' });

      // All taxonomies should have explicit, consecutive sortOrder entries (0, 1, 2, 3, 4)
      const rows = sqlite.prepare(
        `SELECT td.value
         FROM taxonomy t
         JOIN taxonomy_data td
           ON td.taxonomy = t.uuid AND td.category IS NULL AND td.name = 'sortOrder'
         ORDER BY CAST(td.value AS INTEGER)`,
      ).all() as { value: string }[];

      expect(rows.map((r) => r.value)).toEqual(['0', '1', '2', '3', '4']);
    });

    it('mixed-mode: works correctly when some taxonomies lack sortOrder entries', async () => {
      // Simulate ppxml2db import: delete all sortOrder entries
      sqlite.prepare(
        `DELETE FROM taxonomy_data WHERE category IS NULL AND name = 'sortOrder'`,
      ).run();

      // Move Tax E up — should still work and normalize all sortOrders
      const res = await request(app)
        .patch(`/api/taxonomies/${taxIds[4]}/reorder`)
        .send({ direction: 'up' });
      expect(res.status).toBe(200);

      const order = await getOrder();
      expect(order).toEqual(['Tax A', 'Tax B', 'Tax C', 'Tax E', 'Tax D']);

      // All should now have explicit sortOrder entries
      const count = (sqlite.prepare(
        `SELECT COUNT(*) as n FROM taxonomy_data WHERE category IS NULL AND name = 'sortOrder'`,
      ).get() as { n: number }).n;
      expect(count).toBe(5);
    });
  });
});
