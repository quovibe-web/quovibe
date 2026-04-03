/**
 * Read-Path Parity Tests — Performance & Taxonomy Routes
 *
 * Ground truth: docs/audit/read-path/00-read-path-spec.md (sections A9, A11, A24, A25)
 *               docs/audit/fixtures/taxonomy.json
 *
 * Strategy:
 *   - INSERT raw fixture rows directly into the test DB (NOT via service write layer)
 *   - Call GET routes via Supertest
 *   - Assert JSON response field types and value contracts
 *
 * Type convention (established in sessions B+C):
 *   - Performance/calculation: ALL Decimal fields → .toString() → string
 *   - Performance/chart: ALL Decimal fields → .toString() → string
 *   - Taxonomy detail: weight → raw integer (number), no computed values
 *   - Rebalancing: allocation/allocationSum → raw integer (number),
 *                  actualValue/targetValue/deltaValue/deltaPercent → .toFixed() → string
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';
import type { Express } from 'express';

// ─── Skip if native SQLite bindings are unavailable ────────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Fixture UUIDs ─────────────────────────────────────────────────────────────

// Accounts
const PORTFOLIO_UUID = '5ebdc254-bdd9-4ad9-8a57-a2f860089bfa';
const DEPOSIT_UUID   = '74011cf8-c166-4d2c-ac4c-af5e57017213';

// Securities
const SECURITY_A = '04db1b60-9230-4c5b-a070-613944e91dc3'; // active, has prices + latest_price
const SECURITY_B = 'b994772a-0642-499b-8bb2-caab851cdb12'; // retired, no shares held

// Transactions
const TX_DEPOSIT   = 'bbbbbbbb-0001-0000-0000-000000000001';
const TX_BUY_SEC   = 'bbbbbbbb-0002-0000-0000-000000000001';
const TX_BUY_CASH  = 'bbbbbbbb-0002-0000-0000-000000000002';

// Taxonomy (asset classes)
const TAXONOMY_UUID  = 'eb10d69f-a020-4f6a-b2ab-f086efee7da6';
const ROOT_CAT_UUID  = '2144f59b-393c-4946-8fc9-5739646827fd';
const CAT_EQUITIES   = 'cccc0001-0001-0000-0000-000000000001';
const CAT_BONDS      = 'cccc0002-0001-0000-0000-000000000002';

// ─── Period constants ──────────────────────────────────────────────────────────

const PERIOD_START = '2026-03-14';
const PERIOD_END   = '2026-03-21';

// ─── Schema SQL ────────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE account (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT,
    type TEXT,
    currency TEXT DEFAULT 'EUR',
    isRetired INTEGER DEFAULT 0,
    referenceAccount TEXT,
    updatedAt TEXT NOT NULL DEFAULT '',
    note TEXT,
    _xmlid INTEGER NOT NULL DEFAULT 0,
    _order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE security (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT,
    isin TEXT,
    tickerSymbol TEXT,
    wkn TEXT,
    currency TEXT DEFAULT 'EUR',
    note TEXT,
    isRetired INTEGER DEFAULT 0,
    feedURL TEXT,
    feed TEXT,
    latestFeedURL TEXT,
    latestFeed TEXT,
    feedTickerSymbol TEXT,
    calendar TEXT,
    updatedAt TEXT,
    onlineId TEXT,
    targetCurrency TEXT
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
    from_xact TEXT,
    from_acc TEXT,
    to_xact TEXT,
    to_acc TEXT,
    type TEXT
  );
  CREATE TABLE xact_unit (
    xact TEXT,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT,
    forex_amount INTEGER,
    forex_currency TEXT,
    exchangeRate TEXT
  );
  CREATE TABLE property (
    name TEXT PRIMARY KEY,
    special INTEGER NOT NULL DEFAULT 0,
    value TEXT NOT NULL
  );
  CREATE TABLE config_entry (
    uuid TEXT,
    config_set INTEGER,
    name TEXT NOT NULL,
    data TEXT
  );
  CREATE TABLE security_attr (
    security TEXT,
    attr_uuid TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'string',
    value TEXT,
    seq INTEGER DEFAULT 0,
    PRIMARY KEY (security, attr_uuid)
  );
  CREATE TABLE security_prop (
    security TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    seq INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE attribute_type (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    columnLabel TEXT NOT NULL DEFAULT '',
    source TEXT,
    target TEXT NOT NULL DEFAULT '',
    converterClass TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE taxonomy (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    root TEXT
  );
  CREATE TABLE taxonomy_category (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    taxonomy TEXT,
    name TEXT NOT NULL,
    parent TEXT,
    color TEXT,
    weight INTEGER,
    rank INTEGER DEFAULT 0
  );
  CREATE TABLE taxonomy_assignment (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    taxonomy TEXT,
    item TEXT,
    item_type TEXT,
    category TEXT,
    weight INTEGER,
    rank INTEGER
  );
  CREATE TABLE taxonomy_assignment_data (
    assignment INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE taxonomy_data (
    taxonomy TEXT,
    category TEXT,
    name TEXT NOT NULL,
    value TEXT
  );
  CREATE TABLE account_attr (
    account TEXT,
    attr_uuid TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'string',
    value TEXT,
    seq INTEGER DEFAULT 0,
    PRIMARY KEY (account, attr_uuid)
  );
  CREATE TABLE latest_price (
    security TEXT PRIMARY KEY,
    tstamp TEXT,
    value INTEGER NOT NULL,
    high INTEGER,
    low INTEGER,
    volume INTEGER
  );
  CREATE TABLE price (
    security TEXT,
    tstamp TEXT NOT NULL,
    value INTEGER NOT NULL,
    high INTEGER,
    low INTEGER,
    volume INTEGER,
    PRIMARY KEY (security, tstamp)
  );
  CREATE TABLE security_event (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    security TEXT NOT NULL,
    type TEXT NOT NULL,
    date TEXT NOT NULL,
    details TEXT
  );
  CREATE TABLE watchlist_security (
    list INTEGER NOT NULL,
    security TEXT
  );
  CREATE TABLE IF NOT EXISTS vf_exchange_rate (
    date TEXT NOT NULL,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate TEXT NOT NULL,
    PRIMARY KEY (date, from_currency, to_currency)
  );
`;

// ─── Seed Data ─────────────────────────────────────────────────────────────────
// All values are raw ppxml2db integers: prices/shares ×10^8, amounts hecto-units ×10^2.
//
// Portfolio at 2026-03-21:
//   SECURITY_A: 5 shares × 51.50 = 257.50 EUR
//   Deposit balance: (200000 - 25485) / 100 = 1745.15 EUR
//   Total MV: 257.50 + 1745.15 = 2002.65 EUR
//
// Taxonomy "Asset Classes":
//   Root (weight=10000)
//   ├── Equities (weight=7000) → SECURITY_A 100% (assignment weight=10000)
//   └── Fixed Income (weight=3000) → no assigned holdings
//
// Rebalancing expected:
//   Equities: actual=257.50, target=2002.65×0.7=1401.855
//   Fixed Income: actual=0.00, target=2002.65×0.3=600.795

const SEED_SQL = `
  -- Property: base currency
  INSERT INTO property (name, value) VALUES ('portfolio.currency', 'EUR');

  -- Accounts
  INSERT INTO account (uuid, type, name, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order) VALUES
    ('${PORTFOLIO_UUID}', 'portfolio', 'Directa (Titoli)',    NULL,  0, '${DEPOSIT_UUID}', '2026-03-24', 1, 1),
    ('${DEPOSIT_UUID}',   'account',   'Directa (Liquidità)', 'EUR', 0, NULL,              '2026-03-24', 2, 2);

  -- Securities
  INSERT INTO security (uuid, name, isin, tickerSymbol, currency, isRetired, updatedAt) VALUES
    ('${SECURITY_A}', 'VANECK VIDEO GAMING AND ESPORT', 'IE00BYWQWR46', 'ESPO.MI', 'EUR', 0, '2026-03-24'),
    ('${SECURITY_B}', '21SHARES BITCOIN ETP OE',        'CH0454664001', '2BTC.DE', 'EUR', 1, '2026-03-24');

  -- Historical prices for SECURITY_A (×10^8): 2026-03-14 to 2026-03-20
  INSERT INTO price (security, tstamp, value) VALUES
    ('${SECURITY_A}', '2026-03-14', 5200000000),
    ('${SECURITY_A}', '2026-03-16', 5363000000),
    ('${SECURITY_A}', '2026-03-17', 5302000000),
    ('${SECURITY_A}', '2026-03-18', 5235000000),
    ('${SECURITY_A}', '2026-03-19', 5137000000),
    ('${SECURITY_A}', '2026-03-20', 5097000000);

  -- Latest price for SECURITY_A: more recent than last historical (2026-03-21 > 2026-03-20)
  INSERT INTO latest_price (security, tstamp, value, high, low, volume) VALUES
    ('${SECURITY_A}', '2026-03-21', 5150000000, 5189000000, 5097000000, 3619);

  -- ──── DEPOSIT ────────────────────────────────────────────────────────────────
  -- amount=200000 hecto → 2000.00 EUR
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DEPOSIT}', 'DEPOSIT', '2026-03-14', 'EUR', 200000, 0, NULL, '${DEPOSIT_UUID}', 0, 0, 'account', '2026-03-24', 1, 1);

  -- ──── BUY pair: 5 shares of SECURITY_A ──────────────────────────────────────
  -- Securities-side: amount=25485 hecto (254.85 EUR), shares=500000000 (5), fees=500 hecto (5.00 EUR)
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_SEC}', 'BUY', '2026-03-17', 'EUR', 25485, 500000000, '${SECURITY_A}', '${PORTFOLIO_UUID}', 500, 0, 'portfolio', '2026-03-24', 2, 2);

  -- Cash-side
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_CASH}', 'BUY', '2026-03-17', 'EUR', 25485, 0, '${SECURITY_A}', '${DEPOSIT_UUID}', 0, 0, 'account', '2026-03-24', 3, 3);

  INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES
    ('${TX_BUY_SEC}', '${PORTFOLIO_UUID}', '${TX_BUY_CASH}', '${DEPOSIT_UUID}', 'buysell');

  -- ──── Taxonomy: "Asset Classes" ──────────────────────────────────────────────
  INSERT INTO taxonomy (uuid, name, root) VALUES
    ('${TAXONOMY_UUID}', 'Asset Classes', '${ROOT_CAT_UUID}');

  -- Root category (parent=null, weight=10000 = 100%)
  INSERT INTO taxonomy_category (uuid, taxonomy, name, parent, color, weight, rank) VALUES
    ('${ROOT_CAT_UUID}', '${TAXONOMY_UUID}', 'Asset Classes', NULL, '#9bb4c2', 10000, 0);

  -- Child categories
  INSERT INTO taxonomy_category (uuid, taxonomy, name, parent, color, weight, rank) VALUES
    ('${CAT_EQUITIES}', '${TAXONOMY_UUID}', 'Equities',     '${ROOT_CAT_UUID}', '#00ff00', 7000, 0),
    ('${CAT_BONDS}',    '${TAXONOMY_UUID}', 'Fixed Income',  '${ROOT_CAT_UUID}', '#0000ff', 3000, 1);

  -- Assignment: 100% of SECURITY_A → Equities
  INSERT INTO taxonomy_assignment (taxonomy, item, item_type, category, weight, rank) VALUES
    ('${TAXONOMY_UUID}', '${SECURITY_A}', 'security', '${CAT_EQUITIES}', 10000, 0);
`;

// ─── DB factory ────────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(CREATE_TABLES_SQL);
  sqlite.exec(SEED_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Assert a field is a finite numeric string (Decimal.toString() convention). */
function expectNumericString(value: unknown, _label: string) {
  expect(typeof value).toBe('string');
  expect(value).not.toBe('');
  const n = Number(value);
  expect(Number.isFinite(n)).toBe(true);
}

/** Assert no Decimal object leak (should be primitive string or number, not object). */
function expectNotDecimalObject(value: unknown) {
  if (value !== null) {
    expect(typeof value).not.toBe('object');
  }
}

// ═════════════════════════════════════════════════════════════════════════════════
// Test suite
// ═════════════════════════════════════════════════════════════════════════════════

(hasSqliteBindings ? describe : describe.skip)(
  'Read-Path Parity: Performance & Taxonomy',
  () => {
    let app: Express;

    beforeAll(() => {
      const testDb = createTestDb();
      app = createApp(testDb.db as Parameters<typeof createApp>[0], testDb.sqlite);
    });

    // ═══ GROUP A — GET /api/performance/calculation ═══════════════════════════

    describe('GROUP A — GET /api/performance/calculation', () => {
      it('T1.1 — initialValue, finalValue: numeric strings (not number, not Decimal)', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        expectNumericString(res.body.initialValue, 'initialValue');
        expectNumericString(res.body.finalValue, 'finalValue');
        expectNotDecimalObject(res.body.initialValue);
        expectNotDecimalObject(res.body.finalValue);

        // finalValue should be > 0 (we have holdings)
        expect(parseFloat(res.body.finalValue)).toBeGreaterThan(0);
      });

      it('T1.2 — irr, ttwror, ttwrorPa: string or null, never Decimal object', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        // ttwror and ttwrorPa: always string
        expectNumericString(res.body.ttwror, 'ttwror');
        expectNumericString(res.body.ttwrorPa, 'ttwrorPa');
        expectNotDecimalObject(res.body.ttwror);
        expectNotDecimalObject(res.body.ttwrorPa);

        // irr: string or null
        if (res.body.irr !== null) {
          expectNumericString(res.body.irr, 'irr');
          expectNotDecimalObject(res.body.irr);
        } else {
          expect(res.body.irr).toBeNull();
        }
      });

      it('T1.3 — capitalGains.unrealized, realized, foreignCurrencyGains: strings', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        const cg = res.body.capitalGains;
        expect(cg).toBeDefined();
        expectNumericString(cg.unrealized, 'unrealized');
        expectNumericString(cg.realized, 'realized');
        expectNumericString(cg.foreignCurrencyGains, 'foreignCurrencyGains');
        expectNumericString(cg.total, 'total');
      });

      it('T1.4 — fees.total, taxes.total: strings (can represent negative for refunds)', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        expectNumericString(res.body.fees.total, 'fees.total');
        expectNumericString(res.body.taxes.total, 'taxes.total');
        expectNotDecimalObject(res.body.fees.total);
        expectNotDecimalObject(res.body.taxes.total);

        // Note: the BUY's fees field (5.00 EUR) is INTRINSIC (included in cost basis),
        // not a standalone FEES transaction. So fees.total in portfolio calc = 0.
        // fees.total would only be > 0 if there were FEES-type transactions.
        expect(parseFloat(res.body.fees.total)).toBe(0);
      });

      it('T1.5 — performanceNeutralTransfers: strings, sub-fields present', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        const pnt = res.body.performanceNeutralTransfers;
        expect(pnt).toBeDefined();
        expectNumericString(pnt.total, 'pnt.total');
        expectNumericString(pnt.deposits, 'pnt.deposits');
        expectNumericString(pnt.removals, 'pnt.removals');
        expectNumericString(pnt.deliveryInbound, 'pnt.deliveryInbound');
        expectNumericString(pnt.deliveryOutbound, 'pnt.deliveryOutbound');

        // deposits should be > 0 (we have a 2000 EUR deposit)
        expect(parseFloat(pnt.deposits)).toBeGreaterThan(0);
      });

      it('T1.6 — absoluteChange, delta: strings', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        expectNumericString(res.body.absoluteChange, 'absoluteChange');
        expectNumericString(res.body.delta, 'delta');
        expectNumericString(res.body.deltaValue, 'deltaValue');
        expectNotDecimalObject(res.body.absoluteChange);
        expectNotDecimalObject(res.body.delta);
      });
    });

    // ═══ GROUP B — GET /api/performance/chart ═════════════════════════════════

    describe('GROUP B — GET /api/performance/chart', () => {
      it('T2.1 — each data point: date as YYYY-MM-DD string', async () => {
        const res = await request(app)
          .get('/api/performance/chart')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);

        for (const point of res.body) {
          expect(typeof point.date).toBe('string');
          expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      });

      it('T2.2 — marketValue: string (Decimal.toString())', async () => {
        const res = await request(app)
          .get('/api/performance/chart')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        for (const point of res.body) {
          expectNumericString(point.marketValue, 'marketValue');
          expectNotDecimalObject(point.marketValue);
        }
      });

      it('T2.3 — ttwrorCumulative: string, fractional (e.g. 0.0823, not 8.23)', async () => {
        const res = await request(app)
          .get('/api/performance/chart')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        for (const point of res.body) {
          expectNumericString(point.ttwrorCumulative, 'ttwrorCumulative');
          expectNotDecimalObject(point.ttwrorCumulative);
          // Cumulative TTWROR should be fractional (reasonable range for a 1-week period)
          const val = parseFloat(point.ttwrorCumulative);
          expect(Math.abs(val)).toBeLessThan(10); // sanity: not 823% in 1 week
        }
      });

      it('T2.4 — transfersAccumulated: string', async () => {
        const res = await request(app)
          .get('/api/performance/chart')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });
        expect(res.status).toBe(200);

        for (const point of res.body) {
          expectNumericString(point.transfersAccumulated, 'transfersAccumulated');
          expectNotDecimalObject(point.transfersAccumulated);
        }
      });
    });

    // ═══ GROUP C — GET /api/taxonomies/:id (taxonomy detail) ═════════════════

    describe('GROUP C — GET /api/taxonomies/:id (taxonomy detail)', () => {
      it('T3.1 — category.weight: 0-10000 INTEGER stored → returned as-is (number)', async () => {
        const res = await request(app).get(`/api/taxonomies/${TAXONOMY_UUID}`);
        expect(res.status).toBe(200);

        // rootId points to the root category
        expect(res.body.rootId).toBe(ROOT_CAT_UUID);

        // categories = root children (Equities, Fixed Income)
        const cats = res.body.categories as Record<string, unknown>[];
        expect(cats.length).toBe(2);

        const equities = cats.find((c) => c.id === CAT_EQUITIES);
        expect(equities).toBeDefined();
        expect(equities!.weight).toBe(7000);
        expect(typeof equities!.weight).toBe('number');

        const bonds = cats.find((c) => c.id === CAT_BONDS);
        expect(bonds).toBeDefined();
        expect(bonds!.weight).toBe(3000);
        expect(typeof bonds!.weight).toBe('number');
      });

      it('T3.2 — assignment.weight: 0-10000 INTEGER → returned as-is (number)', async () => {
        const res = await request(app).get(`/api/taxonomies/${TAXONOMY_UUID}`);
        expect(res.status).toBe(200);

        const cats = res.body.categories as Record<string, unknown>[];
        const equities = cats.find((c) => c.id === CAT_EQUITIES) as Record<string, unknown>;
        const assignments = equities.assignments as Record<string, unknown>[];
        expect(assignments.length).toBe(1);

        expect(assignments[0].weight).toBe(10000);
        expect(typeof assignments[0].weight).toBe('number');
        expect(assignments[0].itemId).toBe(SECURITY_A);
      });

      it('T3.3 — taxonomy detail has NO computed actualValue/targetValue/percentage (those are in rebalancing)', async () => {
        // Document: the taxonomy detail route returns tree structure only.
        // actualValue, targetValue, and percentage exist in the rebalancing route (GROUP D).
        const res = await request(app).get(`/api/taxonomies/${TAXONOMY_UUID}`);
        expect(res.status).toBe(200);

        const cats = res.body.categories as Record<string, unknown>[];
        const equities = cats.find((c) => c.id === CAT_EQUITIES);
        // These fields should NOT exist in taxonomy detail
        expect(equities).not.toHaveProperty('actualValue');
        expect(equities).not.toHaveProperty('targetValue');
        expect(equities).not.toHaveProperty('percentage');
      });

      it('T3.4 — weight is consistent: frontend divides by 10000 for display (raw basis points)', async () => {
        // Verify the weight convention: raw DB value 7000 = 70%, 3000 = 30%
        // The frontend is responsible for ÷10000 conversion.
        const res = await request(app).get(`/api/taxonomies/${TAXONOMY_UUID}`);
        expect(res.status).toBe(200);

        const cats = res.body.categories as Record<string, unknown>[];
        for (const cat of cats) {
          const w = cat.weight as number;
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(10000);
          // Must be integer, not float
          expect(Number.isInteger(w)).toBe(true);
        }
      });

      it('T3.5 — 404 for non-existent taxonomy', async () => {
        const res = await request(app).get('/api/taxonomies/00000000-0000-0000-0000-000000000000');
        expect(res.status).toBe(404);
      });
    });

    // ═══ GROUP D — GET /api/taxonomies/:id/rebalancing ═══════════════════════

    describe('GROUP D — GET /api/taxonomies/:id/rebalancing', () => {
      it('T4.1 — deltaPercent: string, positive = overweight, negative = underweight', async () => {
        const res = await request(app)
          .get(`/api/taxonomies/${TAXONOMY_UUID}/rebalancing`)
          .query({ date: PERIOD_END });
        expect(res.status).toBe(200);

        const cats = res.body.categories as Record<string, unknown>[];
        const equities = cats.find((c) => c.name === 'Equities');
        expect(equities).toBeDefined();

        // deltaPercent = actual/target - 1
        // Equities: actual=257.50, target≈1401.86 → deltaPercent ≈ -0.8163 (underweight)
        const dp = equities!.deltaPercent;
        expect(typeof dp).toBe('string');
        expectNotDecimalObject(dp);
        expect(parseFloat(dp as string)).toBeLessThan(0); // underweight

        // Fixed Income: actual=0, target>0 → deltaPercent = 0/target - 1 = -1 (100% underweight)
        const bonds = cats.find((c) => c.name === 'Fixed Income');
        expect(bonds).toBeDefined();
        expect(typeof bonds!.deltaPercent).toBe('string');
      });

      it('T4.2 — allocation, allocationSum: raw integers (number), sibling sum = 10000', async () => {
        const res = await request(app)
          .get(`/api/taxonomies/${TAXONOMY_UUID}/rebalancing`)
          .query({ date: PERIOD_END });
        expect(res.status).toBe(200);

        const cats = res.body.categories as Record<string, unknown>[];
        const equities = cats.find((c) => c.name === 'Equities');

        // allocation: raw basis points (number)
        expect(equities!.allocation).toBe(7000);
        expect(typeof equities!.allocation).toBe('number');

        // allocationSum: sibling sum should be 10000 (7000 + 3000)
        expect(equities!.allocationSum).toBe(10000);
        expect(typeof equities!.allocationSum).toBe('number');
        expect(equities!.allocationSumOk).toBe(true);
      });

      it('T4.3 — actualValue, targetValue, deltaValue: strings (Decimal.toFixed), no Decimal leak', async () => {
        const res = await request(app)
          .get(`/api/taxonomies/${TAXONOMY_UUID}/rebalancing`)
          .query({ date: PERIOD_END });
        expect(res.status).toBe(200);

        const cats = res.body.categories as Record<string, unknown>[];
        for (const cat of cats) {
          expectNumericString(cat.actualValue, 'actualValue');
          expectNumericString(cat.targetValue, 'targetValue');
          expectNumericString(cat.deltaValue, 'deltaValue');
          expectNotDecimalObject(cat.actualValue);
          expectNotDecimalObject(cat.targetValue);
          expectNotDecimalObject(cat.deltaValue);
        }

        // Equities: actualValue should be ~257.50 (5 shares × 51.50)
        const equities = cats.find((c) => c.name === 'Equities');
        expect(parseFloat(equities!.actualValue as string)).toBeCloseTo(257.5, 1);

        // totalPortfolioValue: string
        expectNumericString(res.body.totalPortfolioValue, 'totalPortfolioValue');
        expectNotDecimalObject(res.body.totalPortfolioValue);
      });

      it('T4.4 — securities[].weight: raw integer, securities[].actualValue: string', async () => {
        const res = await request(app)
          .get(`/api/taxonomies/${TAXONOMY_UUID}/rebalancing`)
          .query({ date: PERIOD_END });
        expect(res.status).toBe(200);

        const cats = res.body.categories as Record<string, unknown>[];
        const equities = cats.find((c) => c.name === 'Equities') as Record<string, unknown>;
        const secs = equities.securities as Record<string, unknown>[];
        expect(secs.length).toBe(1);

        const sec = secs[0];
        expect(sec.weight).toBe(10000);
        expect(typeof sec.weight).toBe('number');
        expectNumericString(sec.actualValue, 'sec.actualValue');
        expectNumericString(sec.rebalanceAmount, 'sec.rebalanceAmount');
        expectNumericString(sec.rebalanceShares, 'sec.rebalanceShares');
        expect(typeof sec.currentPrice).toBe('string');
      });

      it('T4.5 — 404 for non-existent taxonomy', async () => {
        const res = await request(app)
          .get('/api/taxonomies/00000000-0000-0000-0000-000000000000/rebalancing')
          .query({ date: PERIOD_END });
        expect(res.status).toBe(404);
      });
    });

    // ═══ GROUP E — Contract consistency across routes ═════════════════════════

    describe('GROUP E — Contract consistency across routes', () => {
      it('T5.1 — ttwror: same fractional scale in /calculation and /chart', async () => {
        const [calcRes, chartRes] = await Promise.all([
          request(app)
            .get('/api/performance/calculation')
            .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END }),
          request(app)
            .get('/api/performance/chart')
            .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END }),
        ]);

        expect(calcRes.status).toBe(200);
        expect(chartRes.status).toBe(200);

        const calcTtwror = parseFloat(calcRes.body.ttwror);
        // The last chart point's ttwrorCumulative should match the calculation's ttwror
        const chartPoints = chartRes.body as Record<string, unknown>[];
        const lastPoint = chartPoints[chartPoints.length - 1];
        const chartTtwror = parseFloat(lastPoint.ttwrorCumulative as string);

        // Both should be on the same scale (fractional, e.g. 0.05 = 5%)
        // Allow small tolerance due to rounding
        expect(Math.abs(calcTtwror - chartTtwror)).toBeLessThan(0.01);

        // Both should be of the same type (string)
        expect(typeof calcRes.body.ttwror).toBe('string');
        expect(typeof lastPoint.ttwrorCumulative).toBe('string');
      });

      it('T5.2 — all date fields across routes use YYYY-MM-DD format', async () => {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        const [chartRes, rebalRes] = await Promise.all([
          request(app)
            .get('/api/performance/chart')
            .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END }),
          request(app)
            .get(`/api/taxonomies/${TAXONOMY_UUID}/rebalancing`)
            .query({ date: PERIOD_END }),
        ]);

        // Chart dates
        for (const point of chartRes.body) {
          expect(point.date).toMatch(dateRegex);
        }

        // Rebalancing: no date fields in the response body itself,
        // but the request date parameter is validated
        expect(rebalRes.status).toBe(200);
      });

      it('T5.3 — numeric types consistent: performance uses string, rebalancing uses string for computed values', async () => {
        const [calcRes, rebalRes] = await Promise.all([
          request(app)
            .get('/api/performance/calculation')
            .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END }),
          request(app)
            .get(`/api/taxonomies/${TAXONOMY_UUID}/rebalancing`)
            .query({ date: PERIOD_END }),
        ]);

        // Performance: string for all Decimal fields
        expect(typeof calcRes.body.initialValue).toBe('string');
        expect(typeof calcRes.body.ttwror).toBe('string');

        // Rebalancing: string for computed values, number for raw weights
        const cat = (rebalRes.body.categories as Record<string, unknown>[])[0];
        expect(typeof cat.actualValue).toBe('string');    // computed → string
        expect(typeof cat.allocation).toBe('number');      // raw DB → number
      });
    });
  },
);
