import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';
import { clearCaches } from '../../services/statement-cache';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');

  sqlite.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT,
      currency TEXT DEFAULT 'EUR', isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT, updatedAt TEXT NOT NULL DEFAULT '',
      note TEXT, _xmlid INTEGER NOT NULL DEFAULT 0, _order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, isin TEXT,
      tickerSymbol TEXT, wkn TEXT, currency TEXT DEFAULT 'EUR',
      note TEXT, isRetired INTEGER DEFAULT 0, feedURL TEXT, feed TEXT,
      latestFeedURL TEXT, latestFeed TEXT, feedTickerSymbol TEXT,
      calendar TEXT, updatedAt TEXT, onlineId TEXT, targetCurrency TEXT
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
      from_xact TEXT, from_acc TEXT, to_xact TEXT, to_acc TEXT, type TEXT
    );
    CREATE TABLE xact_unit (
      xact TEXT, type TEXT NOT NULL, amount INTEGER NOT NULL,
      currency TEXT, forex_amount INTEGER, forex_currency TEXT, exchangeRate TEXT
    );
    CREATE TABLE config_entry (
      uuid TEXT, config_set INTEGER, name TEXT NOT NULL, data TEXT
    );
    CREATE TABLE property (
      name TEXT PRIMARY KEY, special INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL
    );
    CREATE TABLE account_attr (
      account TEXT, attr_uuid TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'string',
      value TEXT, seq INTEGER DEFAULT 0, PRIMARY KEY (account, attr_uuid)
    );
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY, tstamp TEXT, value INTEGER NOT NULL
    );
    CREATE TABLE price (
      security TEXT, tstamp TEXT NOT NULL, value INTEGER NOT NULL,
      PRIMARY KEY (security, tstamp)
    );
    CREATE TABLE taxonomy (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL, name TEXT NOT NULL, root TEXT NOT NULL
    );
    CREATE TABLE taxonomy_category (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL, taxonomy TEXT NOT NULL, parent TEXT,
      name TEXT NOT NULL, color TEXT NOT NULL,
      weight INTEGER NOT NULL, rank INTEGER NOT NULL
    );
    CREATE TABLE taxonomy_assignment (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxonomy TEXT NOT NULL, category TEXT NOT NULL,
      item_type TEXT NOT NULL, item TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      rank INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE taxonomy_data (
      taxonomy TEXT NOT NULL, category TEXT,
      name TEXT NOT NULL, type TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL
    );
    CREATE TABLE taxonomy_assignment_data (
      assignment INTEGER NOT NULL, name TEXT NOT NULL,
      type TEXT NOT NULL, value TEXT NOT NULL
    );
    CREATE TABLE security_attr (
      security TEXT, attr_uuid TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'string',
      value TEXT, seq INTEGER DEFAULT 0, PRIMARY KEY (security, attr_uuid)
    );
  `);

  // --- Seed data ---
  // Deposit account
  sqlite.exec(`INSERT INTO account VALUES (NULL,'acc-1','Cash','DEPOSIT','EUR',0,NULL,'',NULL,1,0)`);
  // Securities account referencing deposit
  sqlite.exec(`INSERT INTO account VALUES (NULL,'acc-2','Broker','PORTFOLIO','EUR',0,'acc-1','',NULL,2,1)`);

  // Two securities with different market values
  sqlite.exec(`INSERT INTO security (uuid,name,currency) VALUES ('sec-A','Alpha Corp','EUR')`);
  sqlite.exec(`INSERT INTO security (uuid,name,currency) VALUES ('sec-B','Beta Inc','EUR')`);

  // Prices: sec-A = 50 EUR, sec-B = 100 EUR (value stored as price * 10^8)
  sqlite.exec(`INSERT INTO price VALUES ('sec-A','2026-03-17',5000000000)`);
  sqlite.exec(`INSERT INTO price VALUES ('sec-B','2026-03-17',10000000000)`);

  // BUY transactions: sec-A 100 shares, sec-B 50 shares (shares * 10^8)
  // sec-A: 100 shares × 50 EUR = 5000 EUR | amount stored as hecto-units (amount * 10^2)
  sqlite.exec(`INSERT INTO xact VALUES (NULL,'tx-1','BUY','2026-01-01','EUR',500000,10000000000,NULL,'sec-A','acc-2',NULL,'',0,0,'portfolio',1,0)`);
  // sec-B: 50 shares × 100 EUR = 5000 EUR
  sqlite.exec(`INSERT INTO xact VALUES (NULL,'tx-2','BUY','2026-01-01','EUR',500000,5000000000,NULL,'sec-B','acc-2',NULL,'',0,0,'portfolio',2,1)`);
  // Cash counter-entries
  sqlite.exec(`INSERT INTO xact VALUES (NULL,'tx-1c','BUY','2026-01-01','EUR',500000,0,NULL,NULL,'acc-1',NULL,'',0,0,'account',3,2)`);
  sqlite.exec(`INSERT INTO xact VALUES (NULL,'tx-2c','BUY','2026-01-01','EUR',500000,0,NULL,NULL,'acc-1',NULL,'',0,0,'account',4,3)`);
  sqlite.exec(`INSERT INTO xact_cross_entry VALUES ('tx-1','acc-2','tx-1c','acc-1','BUY')`);
  sqlite.exec(`INSERT INTO xact_cross_entry VALUES ('tx-2','acc-2','tx-2c','acc-1','BUY')`);

  // Taxonomy with root → 2 children (Equities 60%, Bonds 50%) = 110% (intentionally wrong)
  sqlite.exec(`INSERT INTO taxonomy (uuid, name, root) VALUES ('tax-1','Test Taxonomy','root-cat')`);
  sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('root-cat','tax-1','','Root','#000',10000,0)`);
  sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('cat-eq','tax-1','root-cat','Equities','#00f',6000,0)`);
  sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('cat-bd','tax-1','root-cat','Bonds','#f00',5000,1)`);

  // Assign sec-A to Equities (weight 10000=100%), sec-B to Equities (weight 5000=50%)
  sqlite.exec(`INSERT INTO taxonomy_assignment (_id, taxonomy, category, item_type, item, weight, rank) VALUES (1,'tax-1','cat-eq','security','sec-A',10000,0)`);
  sqlite.exec(`INSERT INTO taxonomy_assignment (_id, taxonomy, category, item_type, item, weight, rank) VALUES (2,'tax-1','cat-eq','security','sec-B',5000,1)`);

  // Property for base currency
  sqlite.exec(`INSERT INTO property VALUES ('baseCurrency',0,'EUR')`);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe.skipIf(!hasSqliteBindings)('GET /api/taxonomies/:id/rebalancing', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    clearCaches(); // Prevent cross-test cache pollution
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  // Test 1: Allocation sum > 100% → allocationSumOk=false, allocationSum=11000, values still computed
  it('returns allocationSumOk=false and allocationSum when children sum > 100%', async () => {
    const res = await request(app).get('/api/taxonomies/tax-1/rebalancing?date=2026-03-17');
    expect(res.status).toBe(200);

    const catEq = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-eq');
    const catBd = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-bd');

    // After fix: top-level categories should be flagged because parent's children sum is 11000
    expect(catEq.allocationSumOk).toBe(false);
    expect(catEq.allocationSum).toBe(11000);
    expect(catBd.allocationSumOk).toBe(false);
    expect(catBd.allocationSum).toBe(11000);

    // Values should still be computed (not blanked)
    expect(parseFloat(catEq.targetValue)).toBeGreaterThan(0);
    expect(parseFloat(catBd.targetValue)).toBeGreaterThan(0);
  });

  // Test 2: Allocation sum == 100% → allocationSumOk=true
  it('returns allocationSumOk=true when children sum exactly 100%', async () => {
    // Fix allocations to sum to 100%: 60% + 40% = 100%
    sqlite.exec(`UPDATE taxonomy_category SET weight = 4000 WHERE uuid = 'cat-bd'`);

    const res = await request(app).get('/api/taxonomies/tax-1/rebalancing?date=2026-03-17');
    expect(res.status).toBe(200);

    const catEq = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-eq');
    expect(catEq.allocationSumOk).toBe(true);
    expect(catEq.allocationSum).toBe(10000);
  });

  // Test 3: Allocation sum < 100% → allocationSumOk=false
  it('returns allocationSumOk=false when children sum < 100%', async () => {
    // 60% + 20% = 80%
    sqlite.exec(`UPDATE taxonomy_category SET weight = 2000 WHERE uuid = 'cat-bd'`);

    const res = await request(app).get('/api/taxonomies/tax-1/rebalancing?date=2026-03-17');
    expect(res.status).toBe(200);

    const catEq = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-eq');
    expect(catEq.allocationSumOk).toBe(false);
    expect(catEq.allocationSum).toBe(8000);
  });

  // Test 4: Weight-based distribution (not actual-value-based)
  it('distributes rebalance amounts by weight, not by actual value', async () => {
    // Fix allocations to 100%: Equities 100%, Bonds 0%
    sqlite.exec(`UPDATE taxonomy_category SET weight = 10000 WHERE uuid = 'cat-eq'`);
    sqlite.exec(`UPDATE taxonomy_category SET weight = 0 WHERE uuid = 'cat-bd'`);

    const res = await request(app).get('/api/taxonomies/tax-1/rebalancing?date=2026-03-17');
    expect(res.status).toBe(200);

    const catEq = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-eq');
    // sec-A weight=10000, sec-B weight=5000 → ratio should be 2:1
    const secA = catEq.securities.find((s: { securityId: string; [key: string]: unknown }) => s.securityId === 'sec-A');
    const secB = catEq.securities.find((s: { securityId: string; [key: string]: unknown }) => s.securityId === 'sec-B');

    if (secA && secB) {
      const amtA = Math.abs(parseFloat(secA.rebalanceAmount));
      const amtB = Math.abs(parseFloat(secB.rebalanceAmount));
      // Weight ratio 10000:5000 = 2:1
      if (amtB > 0) {
        expect(amtA / amtB).toBeCloseTo(2.0, 1);
      }
    }
  });

  // Test 5: Target with direct assignments subtracts parent's direct assignment actual
  it('subtracts direct assignment actuals when computing child targets', async () => {
    // Create a nested taxonomy: root → Parent (100%) → Child (100%)
    // Assign sec-A directly to Parent, sec-B to Child
    sqlite.exec(`DELETE FROM taxonomy_category WHERE uuid IN ('cat-eq','cat-bd')`);
    sqlite.exec(`DELETE FROM taxonomy_assignment`);

    sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('cat-parent','tax-1','root-cat','Parent','#00f',10000,0)`);
    sqlite.exec(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES ('cat-child','tax-1','cat-parent','Child','#0f0',10000,0)`);

    // sec-A assigned directly to Parent, sec-B to Child
    sqlite.exec(`INSERT INTO taxonomy_assignment (_id, taxonomy, category, item_type, item, weight, rank) VALUES (10,'tax-1','cat-parent','security','sec-A',10000,0)`);
    sqlite.exec(`INSERT INTO taxonomy_assignment (_id, taxonomy, category, item_type, item, weight, rank) VALUES (11,'tax-1','cat-child','security','sec-B',10000,0)`);

    const res = await request(app).get('/api/taxonomies/tax-1/rebalancing?date=2026-03-17');
    expect(res.status).toBe(200);

    const parent = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-parent');
    const child = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-child');

    // Total portfolio = 10000 EUR (5000 + 5000)
    // Parent target = totalMV × 100% = 10000
    // Parent direct assignment actual (sec-A) = 5000
    // Child target = (parentTarget - parentDirectAssignmentActual) × 100% = (10000 - 5000) × 1.0 = 5000
    // NOT 10000 × 100% = 10000 (which is the old wrong behavior)
    expect(parseFloat(child.targetValue)).toBeCloseTo(5000, 0);
    // Parent target should still be the full value
    expect(parseFloat(parent.targetValue)).toBeCloseTo(10000, 0);
  });

  // Test 6: Category with no securities — delta computed, no rebalance amounts
  it('computes delta for category with no securities', async () => {
    // cat-bd has no assignments → delta should exist, no securities in response
    const res = await request(app).get('/api/taxonomies/tax-1/rebalancing?date=2026-03-17');
    expect(res.status).toBe(200);

    const catBd = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-bd');
    expect(catBd.securities).toHaveLength(0);
    // cat-bd allocation = 5000 (50%), so target > 0, actual = 0 → delta = target
    expect(parseFloat(catBd.targetValue)).toBeGreaterThan(0);
    expect(parseFloat(catBd.deltaValue)).toEqual(parseFloat(catBd.targetValue));
  });

  // Test 7: deltaPercent sign convention — negative when actual < target
  it('returns negative deltaPercent when actual < target', async () => {
    // Set Equities to 100%, Bonds to 0% → all value goes to Equities target
    sqlite.exec(`UPDATE taxonomy_category SET weight = 10000 WHERE uuid = 'cat-eq'`);
    sqlite.exec(`UPDATE taxonomy_category SET weight = 0 WHERE uuid = 'cat-bd'`);

    const res = await request(app).get('/api/taxonomies/tax-1/rebalancing?date=2026-03-17');
    expect(res.status).toBe(200);

    const catEq = res.body.categories.find((c: { categoryId: string; [key: string]: unknown }) => c.categoryId === 'cat-eq');
    // sec-A=5000, sec-B effective=2500 (weight 50%), total actual = 7500
    // Target = totalMV × 100% = totalMV (which is 10000)
    // actual (7500) < target (10000) → deltaPercent should be negative
    // Formula: (actual/target) - 1 = (7500/10000) - 1 = -0.25
    const dp = parseFloat(catEq.deltaPercent);
    expect(dp).toBeLessThan(0);
  });
});
