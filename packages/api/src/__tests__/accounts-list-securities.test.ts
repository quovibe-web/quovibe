// Unit test for `listSecuritiesAccounts` (BUG-54/55 Phase 2 — Task 2.1).
//
// This is a SQL-level unit test, intentionally bypassing the supertest /
// portfolio-pool stack: it exercises the service function against a raw
// `:memory:` SQLite handle prepared by `applyBootstrap`. The pattern mirrors
// other service-layer tests in this folder (e.g. account-duplicate-name.test.ts
// uses supertest because it tests the route, but service-level tests like the
// ones in db/__tests__/ work directly on a Database handle).
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../db/apply-bootstrap';
import { listSecuritiesAccounts } from '../services/accounts.service';

describe('listSecuritiesAccounts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);
  });

  it('returns empty array for fresh portfolio with no accounts', () => {
    expect(listSecuritiesAccounts(db)).toEqual([]);
  });

  it('returns only type=portfolio rows, excluding deposits', () => {
    db.prepare(`INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired) VALUES ('dep-1', 'account', 'Cash EUR', 'EUR', NULL, '2026-01-01', 1, 1, 0)`).run();
    db.prepare(`INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired) VALUES ('sec-1', 'portfolio', 'IB', NULL, 'dep-1', '2026-01-01', 2, 2, 0)`).run();
    db.prepare(`INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired) VALUES ('sec-2', 'portfolio', 'Scalable', NULL, 'dep-1', '2026-01-01', 3, 3, 0)`).run();

    const list = listSecuritiesAccounts(db);
    expect(list).toHaveLength(2);
    expect(list.map(a => a.name)).toEqual(['IB', 'Scalable']);
    expect(list[0]).toHaveProperty('referenceAccountId', 'dep-1');
  });

  it('excludes isRetired=1 rows', () => {
    db.prepare(`INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired) VALUES ('sec-1', 'portfolio', 'Active', NULL, NULL, '2026-01-01', 1, 1, 0)`).run();
    db.prepare(`INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired) VALUES ('sec-2', 'portfolio', 'Retired', NULL, NULL, '2026-01-01', 2, 2, 1)`).run();

    expect(listSecuritiesAccounts(db).map(a => a.name)).toEqual(['Active']);
  });
});
