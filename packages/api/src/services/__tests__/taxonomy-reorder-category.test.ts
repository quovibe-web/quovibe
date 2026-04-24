/**
 * BUG-87 regression test — reorderCategory swaps adjacent siblings and
 * returns false at sibling-set boundaries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTaxonomy, createCategory, reorderCategory } from '../taxonomy.service';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // bindings missing
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

describeIfSqlite('reorderCategory (BUG-87)', () => {
  let db: Database.Database;
  let taxonomyUuid: string;
  let rootId: string;
  let catA: string;
  let catB: string;
  let catC: string;

  const siblings = () =>
    db.prepare(
      `SELECT uuid, rank FROM taxonomy_category WHERE parent = ? ORDER BY rank`,
    ).all(rootId) as { uuid: string; rank: number }[];

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_TABLES_SQL);
    const tx = createTaxonomy(db, 'T1');
    taxonomyUuid = tx.uuid;
    rootId = (db.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxonomyUuid) as { root: string }).root;
    catA = createCategory(db, taxonomyUuid, rootId, 'A').id;
    catB = createCategory(db, taxonomyUuid, rootId, 'B').id;
    catC = createCategory(db, taxonomyUuid, rootId, 'C').id;
  });

  afterEach(() => db.close());

  it('swaps middle category up', () => {
    const ok = reorderCategory(db, taxonomyUuid, catB, 'up');
    expect(ok).toBe(true);
    expect(siblings().map(s => s.uuid)).toEqual([catB, catA, catC]);
  });

  it('swaps middle category down', () => {
    const ok = reorderCategory(db, taxonomyUuid, catB, 'down');
    expect(ok).toBe(true);
    expect(siblings().map(s => s.uuid)).toEqual([catA, catC, catB]);
  });

  it('returns false at first-sibling + up; DB unchanged', () => {
    const before = siblings();
    const ok = reorderCategory(db, taxonomyUuid, catA, 'up');
    expect(ok).toBe(false);
    expect(siblings()).toEqual(before);
  });

  it('returns false at last-sibling + down; DB unchanged', () => {
    const before = siblings();
    const ok = reorderCategory(db, taxonomyUuid, catC, 'down');
    expect(ok).toBe(false);
    expect(siblings()).toEqual(before);
  });

  it('returns false on root category', () => {
    const ok = reorderCategory(db, taxonomyUuid, rootId, 'up');
    expect(ok).toBe(false);
  });

  it('ranks stay dense (0,1,2,…) after a swap', () => {
    reorderCategory(db, taxonomyUuid, catB, 'down');
    expect(siblings().map(s => s.rank)).toEqual([0, 1, 2]);
  });

  it('reorders correctly even when starting ranks have gaps', () => {
    // Simulate drift: set ranks to 0, 5, 10
    db.prepare('UPDATE taxonomy_category SET rank = ? WHERE uuid = ?').run(0, catA);
    db.prepare('UPDATE taxonomy_category SET rank = ? WHERE uuid = ?').run(5, catB);
    db.prepare('UPDATE taxonomy_category SET rank = ? WHERE uuid = ?').run(10, catC);

    const ok = reorderCategory(db, taxonomyUuid, catC, 'up');
    expect(ok).toBe(true);
    expect(siblings().map(s => s.uuid)).toEqual([catA, catC, catB]);
    expect(siblings().map(s => s.rank)).toEqual([0, 1, 2]);
  });
});
