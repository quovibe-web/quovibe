/**
 * BUG-88 regression test — PUT /securities/:id/taxonomy must DIFF, not DELETE-ALL-INSERT.
 *
 * Before the fix, every save re-created all rows so _id churned across untouched
 * taxonomies. These cases lock the invariant that idempotent saves preserve PKs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { updateSecurityTaxonomies } from '../securities.service';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings unavailable — skip
}

const CREATE_TABLES_SQL = `
  CREATE TABLE taxonomy (
    _id INTEGER NOT NULL PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    root VARCHAR(36) NOT NULL
  );
  CREATE TABLE taxonomy_category (
    _id INTEGER NOT NULL PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    taxonomy VARCHAR(36) NOT NULL,
    parent VARCHAR(36),
    name VARCHAR(100) NOT NULL,
    color VARCHAR(100) NOT NULL,
    weight INT NOT NULL,
    rank INT NOT NULL
  );
  CREATE TABLE taxonomy_assignment (
    _id INTEGER NOT NULL PRIMARY KEY,
    taxonomy VARCHAR(36) NOT NULL,
    category VARCHAR(36) NOT NULL,
    item_type VARCHAR(32) NOT NULL,
    item VARCHAR(36) NOT NULL,
    weight INT NOT NULL DEFAULT 10000,
    rank INT NOT NULL DEFAULT 0
  );
  CREATE TABLE taxonomy_assignment_data (
    assignment INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    type VARCHAR(64) NOT NULL,
    value VARCHAR(256) NOT NULL
  );
`;

const describeIfSqlite = hasSqliteBindings ? describe : describe.skip;

describeIfSqlite('updateSecurityTaxonomies — diff semantics (BUG-88)', () => {
  let db: Database.Database;
  const securityId = 'sec-1';
  const tax1 = 'tax-1';
  const tax2 = 'tax-2';
  const cat1a = 'cat-1a';
  const cat1b = 'cat-1b';
  const cat2a = 'cat-2a';

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_TABLES_SQL);
    db.prepare('INSERT INTO taxonomy (_id, uuid, name, root) VALUES (?, ?, ?, ?)').run(1, tax1, 'T1', 'root-1');
    db.prepare('INSERT INTO taxonomy (_id, uuid, name, root) VALUES (?, ?, ?, ?)').run(2, tax2, 'T2', 'root-2');
    const insertCat = db.prepare(
      `INSERT INTO taxonomy_category (_id, uuid, taxonomy, parent, name, color, weight, rank)
       VALUES (?, ?, ?, ?, ?, '#000', ?, ?)`,
    );
    insertCat.run(10, cat1a, tax1, null, 'Cat1A', 5000, 0);
    insertCat.run(11, cat1b, tax1, null, 'Cat1B', 5000, 1);
    insertCat.run(20, cat2a, tax2, null, 'Cat2A', 10000, 0);
  });

  afterEach(() => db.close());

  const readAssignments = () =>
    db.prepare(
      `SELECT _id, taxonomy, category, weight, rank
       FROM taxonomy_assignment WHERE item = ? AND item_type = 'security'
       ORDER BY _id`,
    ).all(securityId) as Array<{ _id: number; taxonomy: string; category: string; weight: number; rank: number }>;

  it('idempotent save preserves all _id values', () => {
    const payload = [
      { taxonomyId: tax1, categoryId: cat1a, weight: 6000 },
      { taxonomyId: tax1, categoryId: cat1b, weight: 4000 },
      { taxonomyId: tax2, categoryId: cat2a, weight: 10000 },
    ];
    updateSecurityTaxonomies(db, securityId, payload);
    const before = readAssignments();
    expect(before).toHaveLength(3);

    updateSecurityTaxonomies(db, securityId, payload);
    const after = readAssignments();

    expect(after.map(r => r._id).sort()).toEqual(before.map(r => r._id).sort());
    expect(after.map(r => ({ t: r.taxonomy, c: r.category, w: r.weight }))).toEqual(
      before.map(r => ({ t: r.taxonomy, c: r.category, w: r.weight })),
    );
  });

  it('weight change preserves _id on the modified row', () => {
    updateSecurityTaxonomies(db, securityId, [
      { taxonomyId: tax1, categoryId: cat1a, weight: 5000 },
      { taxonomyId: tax2, categoryId: cat2a, weight: 10000 },
    ]);
    const [row1Before, row2Before] = readAssignments();

    updateSecurityTaxonomies(db, securityId, [
      { taxonomyId: tax1, categoryId: cat1a, weight: 7500 },
      { taxonomyId: tax2, categoryId: cat2a, weight: 10000 },
    ]);
    const after = readAssignments();

    const row1After = after.find(r => r.category === cat1a)!;
    const row2After = after.find(r => r.category === cat2a)!;
    expect(row1After._id).toBe(row1Before._id);
    expect(row1After.weight).toBe(7500);
    expect(row2After._id).toBe(row2Before._id);
    expect(row2After.weight).toBe(10000);
  });

  it('removal deletes only the dropped row (and its data); siblings keep _id', () => {
    updateSecurityTaxonomies(db, securityId, [
      { taxonomyId: tax1, categoryId: cat1a, weight: 5000 },
      { taxonomyId: tax1, categoryId: cat1b, weight: 5000 },
      { taxonomyId: tax2, categoryId: cat2a, weight: 10000 },
    ]);
    const before = readAssignments();
    expect(before).toHaveLength(3);
    const cat1bId = before.find(r => r.category === cat1b)!._id;
    const cat1aId = before.find(r => r.category === cat1a)!._id;
    const cat2aId = before.find(r => r.category === cat2a)!._id;

    db.prepare(`INSERT INTO taxonomy_assignment_data (assignment, name, type, value) VALUES (?, 'probe', 'text', 'x')`).run(cat1bId);

    updateSecurityTaxonomies(db, securityId, [
      { taxonomyId: tax1, categoryId: cat1a, weight: 5000 },
      { taxonomyId: tax2, categoryId: cat2a, weight: 10000 },
    ]);
    const after = readAssignments();
    expect(after).toHaveLength(2);
    expect(after.find(r => r._id === cat1bId)).toBeUndefined();
    expect(after.find(r => r.category === cat1a)?._id).toBe(cat1aId);
    expect(after.find(r => r.category === cat2a)?._id).toBe(cat2aId);

    const dataRows = db
      .prepare('SELECT * FROM taxonomy_assignment_data WHERE assignment = ?')
      .all(cat1bId) as unknown[];
    expect(dataRows).toHaveLength(0);
  });

  it('duplicate incoming (same taxonomy+category) sums and caps at 10000', () => {
    updateSecurityTaxonomies(db, securityId, [
      { taxonomyId: tax1, categoryId: cat1a, weight: 7000 },
      { taxonomyId: tax1, categoryId: cat1a, weight: 4000 },
    ]);
    const rows = readAssignments();
    expect(rows).toHaveLength(1);
    expect(rows[0].weight).toBe(10000);
  });
});
