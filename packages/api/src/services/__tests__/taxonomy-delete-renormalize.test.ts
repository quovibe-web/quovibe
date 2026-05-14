/**
 * BUG-90 regression — `deleteCategory(…, { renormalize: true })` rescales
 * remaining assignments of affected items so each item's pre-delete SUM(weight)
 * in the taxonomy is preserved. Rounding residual is absorbed by the
 * largest-weight remaining assignment so Σ lands exactly on preTotal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTaxonomy, createCategory, createAssignment, deleteCategory } from '../taxonomy.service';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings missing
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
  CREATE TABLE taxonomy_data (
    taxonomy VARCHAR(36) NOT NULL,
    category VARCHAR(36),
    name VARCHAR(64) NOT NULL,
    type VARCHAR(64) NOT NULL DEFAULT '',
    value VARCHAR(256) NOT NULL
  );
`;

const describeIfSqlite = hasSqliteBindings ? describe : describe.skip;

describeIfSqlite('deleteCategory renormalize flag (BUG-90)', () => {
  let db: Database.Database;
  let taxonomyUuid: string;
  let rootId: string;
  let catA: string;
  let catB: string;
  let catC: string;
  const item = 'sec-apple';

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_TABLES_SQL);
    const tx = createTaxonomy(db, 'T');
    taxonomyUuid = tx.uuid;
    rootId = (db.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxonomyUuid) as { root: string }).root;
    catA = createCategory(db, taxonomyUuid, rootId, 'A').id;
    catB = createCategory(db, taxonomyUuid, rootId, 'B').id;
    catC = createCategory(db, taxonomyUuid, rootId, 'C').id;
  });

  afterEach(() => db.close());

  const sumForItem = (itemId: string): number => {
    const row = db
      .prepare(`SELECT COALESCE(SUM(weight), 0) AS total FROM taxonomy_assignment WHERE item = ? AND taxonomy = ?`)
      .get(itemId, taxonomyUuid) as { total: number };
    return row.total;
  };

  it('default (renormalize=false) leaves remaining weights alone', () => {
    createAssignment(db, taxonomyUuid, item, 'security', catA, 6000);
    createAssignment(db, taxonomyUuid, item, 'security', catB, 4000);
    expect(sumForItem(item)).toBe(10000);

    deleteCategory(db, taxonomyUuid, catA);
    expect(sumForItem(item)).toBe(4000); // drifted — documents current (pre-fix) behavior
  });

  it('renormalize=true scales remaining rows back to preTotal', () => {
    createAssignment(db, taxonomyUuid, item, 'security', catA, 6000); // 60%
    createAssignment(db, taxonomyUuid, item, 'security', catB, 4000); // 40%
    expect(sumForItem(item)).toBe(10000);

    deleteCategory(db, taxonomyUuid, catA, { renormalize: true });
    expect(sumForItem(item)).toBe(10000); // catB scaled 40% → 100%
    const remaining = db
      .prepare(`SELECT category, weight FROM taxonomy_assignment WHERE item = ? AND taxonomy = ?`)
      .all(item, taxonomyUuid) as { category: string; weight: number }[];
    expect(remaining).toEqual([{ category: catB, weight: 10000 }]);
  });

  it('renormalize=true with postTotal === 0 leaves nothing to scale (no crash, no drift)', () => {
    createAssignment(db, taxonomyUuid, item, 'security', catA, 10000);
    expect(sumForItem(item)).toBe(10000);

    deleteCategory(db, taxonomyUuid, catA, { renormalize: true });
    expect(sumForItem(item)).toBe(0);
  });

  it('renormalize=true with three siblings and rounding drift absorbs residual into the largest', () => {
    // 7000 + 2000 + 1000 = 10000 (pre). Delete catA; post = 2000 + 1000 = 3000.
    // Expected scale factor 10000/3000; catB: 2000 * 10000/3000 ≈ 6666.67 → 6667,
    // catC: 1000 * 10000/3000 ≈ 3333.33 → 3333. Sum 10000 exactly (rare — this path
    // exercises the ≈ case). Ensure total equals preTotal either way.
    createAssignment(db, taxonomyUuid, item, 'security', catA, 7000);
    createAssignment(db, taxonomyUuid, item, 'security', catB, 2000);
    createAssignment(db, taxonomyUuid, item, 'security', catC, 1000);

    deleteCategory(db, taxonomyUuid, catA, { renormalize: true });

    expect(sumForItem(item)).toBe(10000);
    const rows = db
      .prepare(`SELECT category, weight FROM taxonomy_assignment WHERE item = ? AND taxonomy = ? ORDER BY _id`)
      .all(item, taxonomyUuid) as { category: string; weight: number }[];
    expect(rows.length).toBe(2);
    // Largest pre-weight remaining is catB (2000) — it should come out larger than catC.
    const bWeight = rows.find(r => r.category === catB)!.weight;
    const cWeight = rows.find(r => r.category === catC)!.weight;
    expect(bWeight).toBeGreaterThan(cWeight);
  });

  it('renormalize=true does not affect items not in the deleted category', () => {
    const otherItem = 'sec-msft';
    createAssignment(db, taxonomyUuid, item, 'security', catA, 5000);
    createAssignment(db, taxonomyUuid, otherItem, 'security', catB, 3000);

    deleteCategory(db, taxonomyUuid, catA, { renormalize: true });

    expect(sumForItem(otherItem)).toBe(3000);
  });
});
