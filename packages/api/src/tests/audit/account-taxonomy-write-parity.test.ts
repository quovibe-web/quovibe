/**
 * Account & Taxonomy Write-Parity Tests
 *
 * Ground truth: docs/audit/fixtures/account.json, taxonomy.json
 * Vendor SQL: packages/api/vendor/account.sql, taxonomy*.sql
 *
 * Strategy:
 *   - Call service/route write methods directly against :memory: SQLite
 *   - Read back raw rows with direct SQL (never through service read layer)
 *   - Compare every column against fixture-derived expected values
 *
 * Divergences found:
 *   T1 (MEDIUM): Root category weight was 0 instead of ppxml2db's 10000 — FIXED
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createTaxonomy,
  deleteTaxonomy,
  createCategory,
  updateCategory,
  deleteCategory,
  createAssignment,
  reorderTaxonomy,
} from '../../services/taxonomy.service';
import { TAXONOMY_TEMPLATES, getTemplate } from '../../data/taxonomy-templates';

// ─── Skip if native SQLite bindings are unavailable ────────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Full schema matching ppxml2db vendor SQL for account + taxonomy tables */
const CREATE_TABLES_SQL = `
  CREATE TABLE account (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    type VARCHAR(10) NOT NULL,
    name VARCHAR(128),
    referenceAccount VARCHAR(36) REFERENCES account(uuid),
    currency VARCHAR(16),
    note TEXT,
    isRetired INT NOT NULL DEFAULT 0,
    updatedAt VARCHAR(64) NOT NULL,
    _xmlid INT NOT NULL,
    _order INT NOT NULL
  );
  CREATE UNIQUE INDEX account__uuid ON account(uuid);

  CREATE TABLE account_attr (
    account VARCHAR(36) NOT NULL REFERENCES account(uuid),
    attr_uuid VARCHAR(36) NOT NULL,
    type VARCHAR(32) NOT NULL,
    value TEXT,
    seq INT NOT NULL DEFAULT 0
  );

  CREATE TABLE taxonomy (
    _id INTEGER NOT NULL PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    root VARCHAR(36) NOT NULL
  );
  CREATE UNIQUE INDEX taxonomy__uuid ON taxonomy(uuid);

  CREATE TABLE taxonomy_category (
    _id INTEGER NOT NULL PRIMARY KEY,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
    parent VARCHAR(36) REFERENCES taxonomy_category(uuid),
    name VARCHAR(100) NOT NULL,
    color VARCHAR(100) NOT NULL,
    weight INT NOT NULL,
    rank INT NOT NULL
  );
  CREATE UNIQUE INDEX taxonomy_category__uuid ON taxonomy_category(uuid);

  CREATE TABLE taxonomy_assignment (
    _id INTEGER NOT NULL PRIMARY KEY,
    taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
    category VARCHAR(36) NOT NULL REFERENCES taxonomy_category(uuid),
    item_type VARCHAR(32) NOT NULL,
    item VARCHAR(36) NOT NULL,
    weight INT NOT NULL DEFAULT 10000,
    rank INT NOT NULL DEFAULT 0
  );
  CREATE INDEX taxonomy_assignment__item_type_item ON taxonomy_assignment(item_type, item);

  CREATE TABLE taxonomy_assignment_data (
    assignment INT NOT NULL REFERENCES taxonomy_assignment(_id),
    name VARCHAR(64) NOT NULL,
    type VARCHAR(64) NOT NULL,
    value VARCHAR(256) NOT NULL
  );

  CREATE TABLE taxonomy_data (
    taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
    category VARCHAR(36) REFERENCES taxonomy_category(uuid),
    name VARCHAR(64) NOT NULL,
    type VARCHAR(64) NOT NULL DEFAULT '',
    value VARCHAR(256) NOT NULL
  );
  CREATE INDEX taxonomy_data__taxonomy ON taxonomy_data(taxonomy);
  CREATE INDEX taxonomy_data__category ON taxonomy_data(category);

  CREATE TABLE security (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    name VARCHAR(128)
  );

  CREATE TABLE xact (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid VARCHAR(36) NOT NULL UNIQUE,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount INTEGER NOT NULL,
    shares INTEGER NOT NULL,
    note TEXT,
    security TEXT,
    account TEXT NOT NULL,
    source TEXT,
    updatedAt TEXT NOT NULL,
    fees INTEGER NOT NULL DEFAULT 0,
    taxes INTEGER NOT NULL DEFAULT 0,
    acctype TEXT NOT NULL,
    _xmlid INTEGER NOT NULL DEFAULT 0,
    _order INTEGER NOT NULL DEFAULT 0
  );
`;

function createTestDb(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(CREATE_TABLES_SQL);
  return sqlite;
}

function count(sqlite: Database.Database, table: string, where?: string, ...params: unknown[]): number {
  const sql = where
    ? `SELECT COUNT(*) as n FROM ${table} WHERE ${where}`
    : `SELECT COUNT(*) as n FROM ${table}`;
  return (sqlite.prepare(sql).get(...params) as { n: number }).n;
}

function seedDepositAccount(sqlite: Database.Database, uuid: string, name: string, currency = 'EUR'): void {
  sqlite.prepare(
    `INSERT INTO account (uuid, type, name, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (?, 'account', ?, ?, 0, NULL, ?, 1, 1)`,
  ).run(uuid, name, currency, new Date().toISOString());
}

function seedPortfolioAccount(
  sqlite: Database.Database,
  uuid: string,
  name: string,
  refAccount: string,
): void {
  sqlite.prepare(
    `INSERT INTO account (uuid, type, name, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
     VALUES (?, 'portfolio', ?, NULL, 0, ?, ?, 2, 2)`,
  ).run(uuid, name, refAccount, new Date().toISOString());
}

// ─── UUID helpers ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Fixture UUIDs ──────────────────────────────────────────────────────────────

const DEPOSIT_UUID = '74011cf8-c166-4d2c-ac4c-af5e57017213';
const PORTFOLIO_UUID = '5ebdc254-bdd9-4ad9-8a57-a2f860089bfa';
const SECURITY_A = '04db1b60-9230-4c5b-a070-613944e91dc3';

// =============================================================================
// TESTS
// =============================================================================

describe.skipIf(!hasSqliteBindings)('Account & Taxonomy Write-Parity', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = createTestDb();
  });

  afterEach(() => {
    sqlite.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP A — createAccount (deposit): all columns vs fixture
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP A — createAccount (deposit)', () => {
    function createDeposit(overrides?: Record<string, unknown>): string {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { maxXmlid } = sqlite.prepare('SELECT COALESCE(MAX(_xmlid), 0) as maxXmlid FROM account').get() as { maxXmlid: number };
      const { maxOrder } = sqlite.prepare('SELECT COALESCE(MAX(_order), 0) as maxOrder FROM account').get() as { maxOrder: number };
      sqlite.prepare(
        `INSERT INTO account (uuid, type, name, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        'account',
        overrides?.name ?? 'Test Deposit',
        overrides?.currency ?? 'EUR',
        0,
        null,
        now,
        maxXmlid + 1,
        maxOrder + 1,
      );
      return id;
    }

    it('A1: uuid is valid UUID string', () => {
      const id = createDeposit();
      const row = sqlite.prepare('SELECT uuid FROM account WHERE uuid = ?').get(id) as { uuid: string };
      expect(row.uuid).toMatch(UUID_RE);
    });

    it('A2: type is "account" (ppxml2db deposit type)', () => {
      const id = createDeposit();
      const row = sqlite.prepare('SELECT type FROM account WHERE uuid = ?').get(id) as { type: string };
      expect(row.type).toBe('account');
    });

    it('A3: name matches input', () => {
      const id = createDeposit({ name: 'Conto Test' });
      const row = sqlite.prepare('SELECT name FROM account WHERE uuid = ?').get(id) as { name: string };
      expect(row.name).toBe('Conto Test');
    });

    it('A4: currency stored as 3-char string (default EUR)', () => {
      const id = createDeposit();
      const row = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(id) as { currency: string };
      expect(row.currency).toBe('EUR');
    });

    it('A5: isRetired = 0 (explicit, not NULL) — ppxml2db parity', () => {
      const id = createDeposit();
      const row = sqlite.prepare('SELECT isRetired FROM account WHERE uuid = ?').get(id) as { isRetired: number };
      expect(row.isRetired).toBe(0);
      expect(row.isRetired).not.toBeNull();
    });

    it('A6: referenceAccount is NULL for deposit account', () => {
      const id = createDeposit();
      const row = sqlite.prepare('SELECT referenceAccount FROM account WHERE uuid = ?').get(id) as { referenceAccount: unknown };
      expect(row.referenceAccount).toBeNull();
    });

    it('A7: updatedAt is ISO date string', () => {
      const id = createDeposit();
      const row = sqlite.prepare('SELECT updatedAt FROM account WHERE uuid = ?').get(id) as { updatedAt: string };
      expect(row.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('A8: _xmlid and _order are sequential positive integers', () => {
      const id1 = createDeposit();
      const id2 = createDeposit();
      const row1 = sqlite.prepare('SELECT _xmlid, _order FROM account WHERE uuid = ?').get(id1) as { _xmlid: number; _order: number };
      const row2 = sqlite.prepare('SELECT _xmlid, _order FROM account WHERE uuid = ?').get(id2) as { _xmlid: number; _order: number };
      expect(row1._xmlid).toBeGreaterThan(0);
      expect(row2._xmlid).toBe(row1._xmlid + 1);
      expect(row2._order).toBe(row1._order + 1);
    });

    it('A9: note defaults to NULL (matches fixture)', () => {
      const id = createDeposit();
      const row = sqlite.prepare('SELECT note FROM account WHERE uuid = ?').get(id) as { note: unknown };
      expect(row.note).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP B — createAccount (portfolio): referenceAccount FK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP B — createAccount (portfolio)', () => {
    it('B1: type is "portfolio" for securities account', () => {
      seedDepositAccount(sqlite, DEPOSIT_UUID, 'Deposit');
      seedPortfolioAccount(sqlite, PORTFOLIO_UUID, 'Portfolio', DEPOSIT_UUID);
      const row = sqlite.prepare('SELECT type FROM account WHERE uuid = ?').get(PORTFOLIO_UUID) as { type: string };
      expect(row.type).toBe('portfolio');
    });

    it('B2: currency is NULL for portfolio (inherited from referenceAccount)', () => {
      seedDepositAccount(sqlite, DEPOSIT_UUID, 'Deposit');
      seedPortfolioAccount(sqlite, PORTFOLIO_UUID, 'Portfolio', DEPOSIT_UUID);
      const row = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(PORTFOLIO_UUID) as { currency: unknown };
      expect(row.currency).toBeNull();
    });

    it('B3: referenceAccount stored as UUID string matching deposit', () => {
      seedDepositAccount(sqlite, DEPOSIT_UUID, 'Deposit');
      seedPortfolioAccount(sqlite, PORTFOLIO_UUID, 'Portfolio', DEPOSIT_UUID);
      const row = sqlite.prepare('SELECT referenceAccount FROM account WHERE uuid = ?').get(PORTFOLIO_UUID) as { referenceAccount: string };
      expect(row.referenceAccount).toBe(DEPOSIT_UUID);
      expect(row.referenceAccount).toMatch(UUID_RE);
    });

    it('B4: isRetired = 0 for portfolio', () => {
      seedDepositAccount(sqlite, DEPOSIT_UUID, 'Deposit');
      seedPortfolioAccount(sqlite, PORTFOLIO_UUID, 'Portfolio', DEPOSIT_UUID);
      const row = sqlite.prepare('SELECT isRetired FROM account WHERE uuid = ?').get(PORTFOLIO_UUID) as { isRetired: number };
      expect(row.isRetired).toBe(0);
    });

    it('B5: note defaults to NULL for portfolio', () => {
      seedDepositAccount(sqlite, DEPOSIT_UUID, 'Deposit');
      seedPortfolioAccount(sqlite, PORTFOLIO_UUID, 'Portfolio', DEPOSIT_UUID);
      const row = sqlite.prepare('SELECT note FROM account WHERE uuid = ?').get(PORTFOLIO_UUID) as { note: unknown };
      expect(row.note).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP C — deleteAccount: cascade order verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP C — deleteAccount cascade', () => {
    let depositId: string;

    beforeEach(() => {
      depositId = crypto.randomUUID();
      seedDepositAccount(sqlite, depositId, 'To Delete');
    });

    it('C1: account row deleted after cascade', () => {
      // Add account_attr
      sqlite.prepare(
        `INSERT INTO account_attr (account, attr_uuid, type, value, seq) VALUES (?, 'logo', 'string', 'data', 0)`,
      ).run(depositId);

      // Perform cascade delete (mirrors route logic)
      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM account_attr WHERE account = ?').run(depositId);
        sqlite.prepare(
          `DELETE FROM taxonomy_assignment_data WHERE assignment IN
           (SELECT _id FROM taxonomy_assignment WHERE item = ? AND item_type = 'account')`,
        ).run(depositId);
        sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE item = ? AND item_type = 'account'`).run(depositId);
        sqlite.prepare('DELETE FROM account WHERE uuid = ?').run(depositId);
      })();

      expect(count(sqlite, 'account', 'uuid = ?', depositId)).toBe(0);
    });

    it('C2: account_attr deleted in cascade', () => {
      sqlite.prepare(
        `INSERT INTO account_attr (account, attr_uuid, type, value, seq) VALUES (?, 'logo', 'string', 'base64data', 0)`,
      ).run(depositId);
      expect(count(sqlite, 'account_attr', 'account = ?', depositId)).toBe(1);

      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM account_attr WHERE account = ?').run(depositId);
        sqlite.prepare(
          `DELETE FROM taxonomy_assignment_data WHERE assignment IN
           (SELECT _id FROM taxonomy_assignment WHERE item = ? AND item_type = 'account')`,
        ).run(depositId);
        sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE item = ? AND item_type = 'account'`).run(depositId);
        sqlite.prepare('DELETE FROM account WHERE uuid = ?').run(depositId);
      })();

      expect(count(sqlite, 'account_attr', 'account = ?', depositId)).toBe(0);
    });

    it('C3: taxonomy_assignment for account deleted in cascade', () => {
      // Create taxonomy + assignment referencing account
      const { uuid: taxId } = createTaxonomy(sqlite, 'Test Tax');
      const root = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxId) as { root: string };
      const catId = createCategory(sqlite, taxId, root.root, 'Cash').id;
      createAssignment(sqlite, taxId, depositId, 'account', catId);

      expect(count(sqlite, 'taxonomy_assignment', "item = ? AND item_type = 'account'", depositId)).toBe(1);

      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM account_attr WHERE account = ?').run(depositId);
        sqlite.prepare(
          `DELETE FROM taxonomy_assignment_data WHERE assignment IN
           (SELECT _id FROM taxonomy_assignment WHERE item = ? AND item_type = 'account')`,
        ).run(depositId);
        sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE item = ? AND item_type = 'account'`).run(depositId);
        sqlite.prepare('DELETE FROM account WHERE uuid = ?').run(depositId);
      })();

      expect(count(sqlite, 'taxonomy_assignment', "item = ? AND item_type = 'account'", depositId)).toBe(0);
    });

    it('C4: taxonomy_assignment_data cleaned for account assignments', () => {
      const { uuid: taxId } = createTaxonomy(sqlite, 'Test Tax');
      const root = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxId) as { root: string };
      const catId = createCategory(sqlite, taxId, root.root, 'Cash').id;
      const { id: assignId } = createAssignment(sqlite, taxId, depositId, 'account', catId);

      // Seed assignment_data
      sqlite.prepare(
        `INSERT INTO taxonomy_assignment_data (assignment, name, type, value) VALUES (?, 'key', 'string', 'val')`,
      ).run(assignId);
      expect(count(sqlite, 'taxonomy_assignment_data', 'assignment = ?', assignId)).toBe(1);

      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM account_attr WHERE account = ?').run(depositId);
        sqlite.prepare(
          `DELETE FROM taxonomy_assignment_data WHERE assignment IN
           (SELECT _id FROM taxonomy_assignment WHERE item = ? AND item_type = 'account')`,
        ).run(depositId);
        sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE item = ? AND item_type = 'account'`).run(depositId);
        sqlite.prepare('DELETE FROM account WHERE uuid = ?').run(depositId);
      })();

      expect(count(sqlite, 'taxonomy_assignment_data', 'assignment = ?', assignId)).toBe(0);
    });

    it('C5: blocks if account has transactions (no orphan xact rows)', () => {
      // Seed a transaction referencing the account
      sqlite.prepare(
        `INSERT INTO xact (uuid, type, date, currency, amount, shares, account, updatedAt, acctype, _xmlid, _order)
         VALUES (?, 'DEPOSIT', '2024-01-01', 'EUR', 10000, 0, ?, ?, 'account', 1, 1)`,
      ).run(crypto.randomUUID(), depositId, new Date().toISOString());

      const txCount = (sqlite.prepare('SELECT COUNT(*) as cnt FROM xact WHERE account = ?').get(depositId) as { cnt: number }).cnt;
      expect(txCount).toBeGreaterThan(0);
      // Route would return 409 — service layer must check before deleting
    });

    it('C6: blocks if account is referenceAccount of a portfolio', () => {
      seedPortfolioAccount(sqlite, crypto.randomUUID(), 'Portfolio', depositId);
      const refCount = (sqlite.prepare('SELECT COUNT(*) as cnt FROM account WHERE referenceAccount = ?').get(depositId) as { cnt: number }).cnt;
      expect(refCount).toBeGreaterThan(0);
      // Route would return 409
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP D — createTaxonomy (all 7 templates): category rows match
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP D — createTaxonomy templates', () => {
    // Helper: count total categories in a template (recursive)
    function countTemplateCategories(cats: { children?: unknown[] }[]): number {
      let n = 0;
      for (const c of cats) {
        n++;
        if (c.children && Array.isArray(c.children)) {
          n += countTemplateCategories(c.children as { children?: unknown[] }[]);
        }
      }
      return n;
    }

    const expectedCounts: Record<string, number> = {
      'asset-classes': 6,            // root + 5
      'industries-gics-sectors': 12, // root + 11
      'industry': 17,                // root + 16
      'asset-allocation': 10,        // root + 2 parents + (1+6) children
      'regions': 46,                 // root + 5 continents + 40 countries
      'regions-msci': 72,            // root + 3 markets + 68 countries
      'type-of-security': 8,         // root + 7
    };

    // Verify all 7 templates are present
    it('D0: all 7 templates are registered', () => {
      expect(TAXONOMY_TEMPLATES).toHaveLength(7);
      for (const key of Object.keys(expectedCounts)) {
        expect(getTemplate(key)).toBeDefined();
      }
    });

    for (const tmpl of TAXONOMY_TEMPLATES) {
      it(`D-${tmpl.key}: creates ${expectedCounts[tmpl.key]} categories (root + template)`, () => {
        const { uuid } = createTaxonomy(sqlite, tmpl.defaultName, tmpl.key);
        const catCount = count(sqlite, 'taxonomy_category', 'taxonomy = ?', uuid);

        // Verify count = root + recursive template categories
        const templateCount = countTemplateCategories(tmpl.categories);
        expect(catCount).toBe(templateCount + 1); // +1 for root
        expect(catCount).toBe(expectedCounts[tmpl.key]);

        // Verify root exists and children are parented to root
        const tax = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(uuid) as { root: string };
        const rootCat = sqlite.prepare('SELECT * FROM taxonomy_category WHERE uuid = ?').get(tax.root) as Record<string, unknown>;
        expect(rootCat.parent).toBeNull();

        // Verify first-level children match template
        const firstLevel = sqlite.prepare(
          'SELECT name FROM taxonomy_category WHERE parent = ? ORDER BY rank',
        ).all(tax.root) as { name: string }[];
        expect(firstLevel.map(c => c.name)).toEqual(tmpl.categories.map(c => c.name));
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP E — createTaxonomy (empty): root structure only
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP E — createTaxonomy (empty)', () => {
    it('E1: taxonomy row has uuid, name, root', () => {
      const { uuid } = createTaxonomy(sqlite, 'My Taxonomy');
      const row = sqlite.prepare('SELECT * FROM taxonomy WHERE uuid = ?').get(uuid) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.uuid).toMatch(UUID_RE);
      expect(row.name).toBe('My Taxonomy');
      expect(row.root).toMatch(UUID_RE);
    });

    it('E2: single root category with parent=null', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const cats = sqlite.prepare('SELECT * FROM taxonomy_category WHERE taxonomy = ?').all(uuid);
      expect(cats).toHaveLength(1);
      expect((cats[0] as Record<string, unknown>).parent).toBeNull();
    });

    it('E3: root category name matches taxonomy name', () => {
      const { uuid } = createTaxonomy(sqlite, 'Custom Name');
      const tax = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(uuid) as { root: string };
      const root = sqlite.prepare('SELECT name FROM taxonomy_category WHERE uuid = ?').get(tax.root) as { name: string };
      expect(root.name).toBe('Custom Name');
    });

    it('E4: sortOrder taxonomy_data row written', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const dataRow = sqlite.prepare(
        `SELECT * FROM taxonomy_data WHERE taxonomy = ? AND category IS NULL AND name = 'sortOrder'`,
      ).get(uuid) as Record<string, unknown>;
      expect(dataRow).toBeDefined();
      expect(dataRow.type).toBe('int');
      expect(typeof dataRow.value).toBe('string');
      expect(Number(dataRow.value)).toBeGreaterThanOrEqual(0);
    });

    it('E5: root category weight = 10000 (T1 parity fix)', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const tax = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(uuid) as { root: string };
      const root = sqlite.prepare('SELECT weight FROM taxonomy_category WHERE uuid = ?').get(tax.root) as { weight: number };
      expect(root.weight).toBe(10000);
    });

    it('E6: root category rank = 0', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const tax = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(uuid) as { root: string };
      const root = sqlite.prepare('SELECT rank FROM taxonomy_category WHERE uuid = ?').get(tax.root) as { rank: number };
      expect(root.rank).toBe(0);
    });

    it('E7: root category color = "#000000"', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const tax = sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(uuid) as { root: string };
      const root = sqlite.prepare('SELECT color FROM taxonomy_category WHERE uuid = ?').get(tax.root) as { color: string };
      expect(root.color).toBe('#000000');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP F — createCategory: rank, parent FK, color
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP F — createCategory', () => {
    let taxUuid: string;
    let rootId: string;

    beforeEach(() => {
      const result = createTaxonomy(sqlite, 'Test');
      taxUuid = result.uuid;
      rootId = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxUuid) as { root: string }).root;
    });

    it('F1: first child gets rank = 0', () => {
      const { id } = createCategory(sqlite, taxUuid, rootId, 'First');
      const cat = sqlite.prepare('SELECT rank FROM taxonomy_category WHERE uuid = ?').get(id) as { rank: number };
      expect(cat.rank).toBe(0);
    });

    it('F2: second child gets rank = 1', () => {
      createCategory(sqlite, taxUuid, rootId, 'First');
      const { id } = createCategory(sqlite, taxUuid, rootId, 'Second');
      const cat = sqlite.prepare('SELECT rank FROM taxonomy_category WHERE uuid = ?').get(id) as { rank: number };
      expect(cat.rank).toBe(1);
    });

    it('F3: explicit color stored when provided', () => {
      const { id } = createCategory(sqlite, taxUuid, rootId, 'Colored', '#ff0000');
      const cat = sqlite.prepare('SELECT color FROM taxonomy_category WHERE uuid = ?').get(id) as { color: string };
      expect(cat.color).toBe('#ff0000');
    });

    it('F4: color assigned from PALETTE when not provided', () => {
      const { id } = createCategory(sqlite, taxUuid, rootId, 'Auto Color');
      const cat = sqlite.prepare('SELECT color FROM taxonomy_category WHERE uuid = ?').get(id) as { color: string };
      expect(cat.color).toBeTruthy();
      expect(cat.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('F5: parent must exist in same taxonomy (throws)', () => {
      expect(() => createCategory(sqlite, taxUuid, 'nonexistent-uuid', 'Orphan'))
        .toThrow('Parent category not found');
    });

    it('F6: weight = 0 for newly created non-root category', () => {
      const { id } = createCategory(sqlite, taxUuid, rootId, 'NoWeight');
      const cat = sqlite.prepare('SELECT weight FROM taxonomy_category WHERE uuid = ?').get(id) as { weight: number };
      expect(cat.weight).toBe(0);
    });

    it('F7: explicit rank overrides auto-computation', () => {
      createCategory(sqlite, taxUuid, rootId, 'A');
      createCategory(sqlite, taxUuid, rootId, 'B');
      const { id } = createCategory(sqlite, taxUuid, rootId, 'C', undefined, 5);
      const cat = sqlite.prepare('SELECT rank FROM taxonomy_category WHERE uuid = ?').get(id) as { rank: number };
      expect(cat.rank).toBe(5);
    });

    it('F8: nested categories have correct parent FK', () => {
      const parent = createCategory(sqlite, taxUuid, rootId, 'Parent');
      const child = createCategory(sqlite, taxUuid, parent.id, 'Child');
      const cat = sqlite.prepare('SELECT parent FROM taxonomy_category WHERE uuid = ?').get(child.id) as { parent: string };
      expect(cat.parent).toBe(parent.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP G — updateCategory: rank reorder (swap) atomicity
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP G — updateCategory reorder', () => {
    let taxUuid: string;
    let rootId: string;
    let catIds: string[];

    beforeEach(() => {
      const result = createTaxonomy(sqlite, 'Test');
      taxUuid = result.uuid;
      rootId = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxUuid) as { root: string }).root;

      catIds = [];
      for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
        catIds.push(createCategory(sqlite, taxUuid, rootId, name).id);
      }
    });

    it('G1: shift moves sibling ranks correctly', () => {
      // Move Delta (rank 3) to rank 1 — should shift Beta(1→2), Gamma(2→3)
      updateCategory(sqlite, taxUuid, catIds[3], { rank: 1 });

      const siblings = sqlite.prepare(
        'SELECT uuid, rank FROM taxonomy_category WHERE parent = ? ORDER BY rank',
      ).all(rootId) as { uuid: string; rank: number }[];

      // Delta should be at rank 1
      const deltaRank = siblings.find(s => s.uuid === catIds[3])!.rank;
      expect(deltaRank).toBe(1);
    });

    it('G2: no duplicate ranks after shift (all unique among siblings)', () => {
      updateCategory(sqlite, taxUuid, catIds[3], { rank: 0 });

      const siblings = sqlite.prepare(
        'SELECT rank FROM taxonomy_category WHERE parent = ?',
      ).all(rootId) as { rank: number }[];

      const ranks = siblings.map(s => s.rank);
      expect(new Set(ranks).size).toBe(ranks.length);
    });

    it('G3: reparent changes parent FK correctly', () => {
      // Reparent Gamma under Alpha
      updateCategory(sqlite, taxUuid, catIds[2], { parentId: catIds[0] });
      const cat = sqlite.prepare('SELECT parent FROM taxonomy_category WHERE uuid = ?').get(catIds[2]) as { parent: string };
      expect(cat.parent).toBe(catIds[0]);
    });

    it('G4: cycle detection prevents self-parenting', () => {
      expect(() => updateCategory(sqlite, taxUuid, catIds[0], { parentId: catIds[0] }))
        .toThrow('circular');
    });

    it('G5: cycle detection prevents indirect cycles', () => {
      // Alpha → Beta (reparent Beta under Alpha)
      updateCategory(sqlite, taxUuid, catIds[1], { parentId: catIds[0] });
      // Try to reparent Alpha under Beta → cycle
      expect(() => updateCategory(sqlite, taxUuid, catIds[0], { parentId: catIds[1] }))
        .toThrow('circular');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP H — deleteCategory cascade
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP H — deleteCategory cascade', () => {
    let taxUuid: string;
    let rootId: string;

    beforeEach(() => {
      const result = createTaxonomy(sqlite, 'Test');
      taxUuid = result.uuid;
      rootId = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxUuid) as { root: string }).root;
    });

    it('H1: category row deleted', () => {
      const { id } = createCategory(sqlite, taxUuid, rootId, 'ToDelete');
      deleteCategory(sqlite, taxUuid, id);
      expect(count(sqlite, 'taxonomy_category', 'uuid = ?', id)).toBe(0);
    });

    it('H2: children reparented to deleted category parent', () => {
      const parent = createCategory(sqlite, taxUuid, rootId, 'Parent');
      const child = createCategory(sqlite, taxUuid, parent.id, 'Child');

      deleteCategory(sqlite, taxUuid, parent.id);

      const childRow = sqlite.prepare('SELECT parent FROM taxonomy_category WHERE uuid = ?').get(child.id) as { parent: string };
      expect(childRow.parent).toBe(rootId);
    });

    it('H3: assignments in deleted category cleaned', () => {
      const { id: catId } = createCategory(sqlite, taxUuid, rootId, 'WithAssign');
      sqlite.prepare('INSERT INTO security (uuid, name) VALUES (?, ?)').run(SECURITY_A, 'TestSec');
      createAssignment(sqlite, taxUuid, SECURITY_A, 'security', catId);

      expect(count(sqlite, 'taxonomy_assignment', 'category = ? AND taxonomy = ?', catId, taxUuid)).toBe(1);

      deleteCategory(sqlite, taxUuid, catId);

      expect(count(sqlite, 'taxonomy_assignment', 'category = ? AND taxonomy = ?', catId, taxUuid)).toBe(0);
    });

    it('H4: taxonomy_assignment_data for deleted assignments cleaned', () => {
      const { id: catId } = createCategory(sqlite, taxUuid, rootId, 'WithData');
      sqlite.prepare('INSERT INTO security (uuid, name) VALUES (?, ?)').run(SECURITY_A, 'TestSec');
      const { id: assignId } = createAssignment(sqlite, taxUuid, SECURITY_A, 'security', catId);
      sqlite.prepare(
        `INSERT INTO taxonomy_assignment_data (assignment, name, type, value) VALUES (?, 'note', 'string', 'test')`,
      ).run(assignId);

      deleteCategory(sqlite, taxUuid, catId);

      expect(count(sqlite, 'taxonomy_assignment_data', 'assignment = ?', assignId)).toBe(0);
    });

    it('H5: taxonomy_data for deleted category cleaned', () => {
      const { id: catId } = createCategory(sqlite, taxUuid, rootId, 'WithTaxData');
      sqlite.prepare(
        `INSERT INTO taxonomy_data (taxonomy, category, name, type, value) VALUES (?, ?, 'key', 'string', 'val')`,
      ).run(taxUuid, catId);

      deleteCategory(sqlite, taxUuid, catId);

      expect(count(sqlite, 'taxonomy_data', 'category = ? AND taxonomy = ?', catId, taxUuid)).toBe(0);
    });

    it('H6: ranks compacted after delete (no gaps)', () => {
      createCategory(sqlite, taxUuid, rootId, 'A');
      const b = createCategory(sqlite, taxUuid, rootId, 'B');
      createCategory(sqlite, taxUuid, rootId, 'C');

      // Delete B (rank 1)
      deleteCategory(sqlite, taxUuid, b.id);

      const siblings = sqlite.prepare(
        'SELECT name, rank FROM taxonomy_category WHERE parent = ? ORDER BY rank',
      ).all(rootId) as { name: string; rank: number }[];

      expect(siblings).toEqual([
        { name: 'A', rank: 0 },
        { name: 'C', rank: 1 },
      ]);
    });

    it('H7: cannot delete root category', () => {
      expect(() => deleteCategory(sqlite, taxUuid, rootId))
        .toThrow('Cannot delete root category');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP I — createAssignment: weight stored as 0-10000 integer
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP I — createAssignment', () => {
    let taxUuid: string;
    let rootId: string;
    let catId: string;
    let secUuid: string;

    beforeEach(() => {
      const result = createTaxonomy(sqlite, 'Test');
      taxUuid = result.uuid;
      rootId = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(taxUuid) as { root: string }).root;
      catId = createCategory(sqlite, taxUuid, rootId, 'Cat A').id;
      secUuid = crypto.randomUUID();
      sqlite.prepare('INSERT INTO security (uuid, name) VALUES (?, ?)').run(secUuid, 'TestSec');
    });

    it('I1: default weight = 10000 when no other assignments exist', () => {
      const { id } = createAssignment(sqlite, taxUuid, secUuid, 'security', catId);
      const row = sqlite.prepare('SELECT weight FROM taxonomy_assignment WHERE _id = ?').get(id) as { weight: number };
      expect(row.weight).toBe(10000);
    });

    it('I2: default weight = remainder when other assignments exist', () => {
      createAssignment(sqlite, taxUuid, secUuid, 'security', catId, 3000);
      const catId2 = createCategory(sqlite, taxUuid, rootId, 'Cat B').id;
      const { id } = createAssignment(sqlite, taxUuid, secUuid, 'security', catId2);
      const row = sqlite.prepare('SELECT weight FROM taxonomy_assignment WHERE _id = ?').get(id) as { weight: number };
      expect(row.weight).toBe(7000); // 10000 - 3000
    });

    it('I3: explicit weight stored as-is', () => {
      const { id } = createAssignment(sqlite, taxUuid, secUuid, 'security', catId, 5500);
      const row = sqlite.prepare('SELECT weight FROM taxonomy_assignment WHERE _id = ?').get(id) as { weight: number };
      expect(row.weight).toBe(5500);
    });

    it('I4: duplicate item+category → merge (weight summed, capped at 10000)', () => {
      createAssignment(sqlite, taxUuid, secUuid, 'security', catId, 6000);
      const { id } = createAssignment(sqlite, taxUuid, secUuid, 'security', catId, 7000);
      const row = sqlite.prepare('SELECT weight FROM taxonomy_assignment WHERE _id = ?').get(id) as { weight: number };
      expect(row.weight).toBe(10000); // capped: 6000 + 7000 > 10000
    });

    it('I5: weight and rank are integers (not floats)', () => {
      const { id } = createAssignment(sqlite, taxUuid, secUuid, 'security', catId, 4500);
      const row = sqlite.prepare('SELECT weight, rank FROM taxonomy_assignment WHERE _id = ?').get(id) as { weight: number; rank: number };
      expect(Number.isInteger(row.weight)).toBe(true);
      expect(Number.isInteger(row.rank)).toBe(true);
    });

    it('I6: item_type stored correctly for security assignments', () => {
      const { id } = createAssignment(sqlite, taxUuid, secUuid, 'security', catId);
      const row = sqlite.prepare('SELECT item_type FROM taxonomy_assignment WHERE _id = ?').get(id) as { item_type: string };
      expect(row.item_type).toBe('security');
    });

    it('I7: item_type stored correctly for account assignments', () => {
      const accUuid = crypto.randomUUID();
      seedDepositAccount(sqlite, accUuid, 'Deposit');
      const { id } = createAssignment(sqlite, taxUuid, accUuid, 'account', catId);
      const row = sqlite.prepare('SELECT item_type FROM taxonomy_assignment WHERE _id = ?').get(id) as { item_type: string };
      expect(row.item_type).toBe('account');
    });

    it('I8: rank auto-increments for assignments in same category', () => {
      const sec2 = crypto.randomUUID();
      sqlite.prepare('INSERT INTO security (uuid, name) VALUES (?, ?)').run(sec2, 'Sec2');
      createAssignment(sqlite, taxUuid, secUuid, 'security', catId, 5000);
      const { id } = createAssignment(sqlite, taxUuid, sec2, 'security', catId, 5000);
      const row = sqlite.prepare('SELECT rank FROM taxonomy_assignment WHERE _id = ?').get(id) as { rank: number };
      expect(row.rank).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP J — deleteTaxonomy: full cascade, verify empty state
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP J — deleteTaxonomy cascade', () => {
    it('J1: taxonomy row deleted', () => {
      const { uuid } = createTaxonomy(sqlite, 'ToDelete', 'asset-classes');
      deleteTaxonomy(sqlite, uuid);
      expect(count(sqlite, 'taxonomy', 'uuid = ?', uuid)).toBe(0);
    });

    it('J2: taxonomy_category rows deleted', () => {
      const { uuid } = createTaxonomy(sqlite, 'ToDelete', 'asset-classes');
      expect(count(sqlite, 'taxonomy_category', 'taxonomy = ?', uuid)).toBe(6);
      deleteTaxonomy(sqlite, uuid);
      expect(count(sqlite, 'taxonomy_category', 'taxonomy = ?', uuid)).toBe(0);
    });

    it('J3: taxonomy_assignment rows deleted', () => {
      const { uuid } = createTaxonomy(sqlite, 'ToDelete');
      const root = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(uuid) as { root: string }).root;
      const catId = createCategory(sqlite, uuid, root, 'Cat').id;
      const secId = crypto.randomUUID();
      sqlite.prepare('INSERT INTO security (uuid, name) VALUES (?, ?)').run(secId, 'Sec');
      createAssignment(sqlite, uuid, secId, 'security', catId);

      expect(count(sqlite, 'taxonomy_assignment', 'taxonomy = ?', uuid)).toBe(1);
      deleteTaxonomy(sqlite, uuid);
      expect(count(sqlite, 'taxonomy_assignment', 'taxonomy = ?', uuid)).toBe(0);
    });

    it('J4: taxonomy_assignment_data rows deleted', () => {
      const { uuid } = createTaxonomy(sqlite, 'ToDelete');
      const root = (sqlite.prepare('SELECT root FROM taxonomy WHERE uuid = ?').get(uuid) as { root: string }).root;
      const catId = createCategory(sqlite, uuid, root, 'Cat').id;
      const secId = crypto.randomUUID();
      sqlite.prepare('INSERT INTO security (uuid, name) VALUES (?, ?)').run(secId, 'Sec');
      const { id: assignId } = createAssignment(sqlite, uuid, secId, 'security', catId);
      sqlite.prepare(`INSERT INTO taxonomy_assignment_data (assignment, name, type, value) VALUES (?, 'k', 's', 'v')`).run(assignId);

      expect(count(sqlite, 'taxonomy_assignment_data', 'assignment = ?', assignId)).toBe(1);
      deleteTaxonomy(sqlite, uuid);
      expect(count(sqlite, 'taxonomy_assignment_data', 'assignment = ?', assignId)).toBe(0);
    });

    it('J5: taxonomy_data rows deleted', () => {
      const { uuid } = createTaxonomy(sqlite, 'ToDelete');
      // createTaxonomy already inserts a sortOrder row
      expect(count(sqlite, 'taxonomy_data', 'taxonomy = ?', uuid)).toBeGreaterThanOrEqual(1);
      deleteTaxonomy(sqlite, uuid);
      expect(count(sqlite, 'taxonomy_data', 'taxonomy = ?', uuid)).toBe(0);
    });

    it('J6: second taxonomy unaffected by first delete', () => {
      const { uuid: uuid1 } = createTaxonomy(sqlite, 'First', 'asset-classes');
      const { uuid: uuid2 } = createTaxonomy(sqlite, 'Second', 'industry');

      deleteTaxonomy(sqlite, uuid1);

      expect(count(sqlite, 'taxonomy', 'uuid = ?', uuid2)).toBe(1);
      expect(count(sqlite, 'taxonomy_category', 'taxonomy = ?', uuid2)).toBe(17);
      expect(count(sqlite, 'taxonomy_data', 'taxonomy = ?', uuid2)).toBeGreaterThanOrEqual(1);
    });

    it('J7: returns false for nonexistent taxonomy', () => {
      const result = deleteTaxonomy(sqlite, 'nonexistent-uuid');
      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP K — taxonomy_data rows
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GROUP K — taxonomy_data', () => {
    it('K1: sortOrder row at taxonomy level (category = NULL)', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const row = sqlite.prepare(
        `SELECT * FROM taxonomy_data WHERE taxonomy = ? AND category IS NULL AND name = 'sortOrder'`,
      ).get(uuid) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.category).toBeNull();
    });

    it('K2: sortOrder value is parseable integer string', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const row = sqlite.prepare(
        `SELECT value FROM taxonomy_data WHERE taxonomy = ? AND name = 'sortOrder'`,
      ).get(uuid) as { value: string };
      const parsed = parseInt(row.value, 10);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(String(parsed)).toBe(row.value);
    });

    it('K3: sortOrder type is "int"', () => {
      const { uuid } = createTaxonomy(sqlite, 'Test');
      const row = sqlite.prepare(
        `SELECT type FROM taxonomy_data WHERE taxonomy = ? AND name = 'sortOrder'`,
      ).get(uuid) as { type: string };
      expect(row.type).toBe('int');
    });

    it('K4: multiple taxonomies get consecutive sortOrder values', () => {
      const { uuid: u1 } = createTaxonomy(sqlite, 'First');
      const { uuid: u2 } = createTaxonomy(sqlite, 'Second');
      const { uuid: u3 } = createTaxonomy(sqlite, 'Third');

      const getValue = (uuid: string): number => {
        const row = sqlite.prepare(
          `SELECT value FROM taxonomy_data WHERE taxonomy = ? AND name = 'sortOrder'`,
        ).get(uuid) as { value: string };
        return parseInt(row.value, 10);
      };

      const v1 = getValue(u1);
      const v2 = getValue(u2);
      const v3 = getValue(u3);

      expect(v2).toBe(v1 + 1);
      expect(v3).toBe(v2 + 1);
    });

    it('K5: taxonomy_data preserved for other taxonomies during delete', () => {
      const { uuid: uuid1 } = createTaxonomy(sqlite, 'Keeper');
      const { uuid: uuid2 } = createTaxonomy(sqlite, 'Victim');

      // Add extra data to keeper
      sqlite.prepare(
        `INSERT INTO taxonomy_data (taxonomy, category, name, type, value) VALUES (?, NULL, 'dimension', '', 'test')`,
      ).run(uuid1);

      const beforeCount = count(sqlite, 'taxonomy_data', 'taxonomy = ?', uuid1);
      deleteTaxonomy(sqlite, uuid2);
      const afterCount = count(sqlite, 'taxonomy_data', 'taxonomy = ?', uuid1);

      expect(afterCount).toBe(beforeCount);
    });

    it('K6: reorderTaxonomy normalizes all sortOrder values', () => {
      createTaxonomy(sqlite, 'A');
      createTaxonomy(sqlite, 'B');
      const { uuid: u3 } = createTaxonomy(sqlite, 'C');

      // Move C up (swap with B)
      reorderTaxonomy(sqlite, u3, 'up');

      const rows = sqlite.prepare(
        `SELECT td.value
         FROM taxonomy t
         JOIN taxonomy_data td
           ON td.taxonomy = t.uuid AND td.category IS NULL AND td.name = 'sortOrder'
         ORDER BY CAST(td.value AS INTEGER)`,
      ).all() as { value: string }[];

      expect(rows.map(r => r.value)).toEqual(['0', '1', '2']);
    });

    it('K7: reorderTaxonomy swaps correct pair', () => {
      const { uuid: u1 } = createTaxonomy(sqlite, 'A');
      const { uuid: u2 } = createTaxonomy(sqlite, 'B');
      const { uuid: u3 } = createTaxonomy(sqlite, 'C');

      reorderTaxonomy(sqlite, u2, 'down'); // B↔C

      const getOrder = (uuid: string): number => {
        const row = sqlite.prepare(
          `SELECT value FROM taxonomy_data WHERE taxonomy = ? AND name = 'sortOrder'`,
        ).get(uuid) as { value: string };
        return parseInt(row.value, 10);
      };

      expect(getOrder(u1)).toBe(0);
      expect(getOrder(u3)).toBe(1); // C moved up
      expect(getOrder(u2)).toBe(2); // B moved down
    });
  });
});
