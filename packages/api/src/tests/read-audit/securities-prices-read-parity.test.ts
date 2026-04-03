/**
 * Read-Path Parity Tests — Securities, Prices, Performance & Reports
 *
 * Ground truth: docs/audit/fixtures/security.json, price.json, latest-price.json
 * Spec: docs/audit/read-path/00-read-path-spec.md
 *
 * Strategy:
 *   - INSERT raw fixture rows directly into the test DB using raw SQL (NOT the service write layer)
 *   - Call the GET route via Supertest
 *   - Assert the JSON response field values match the expected converted values
 *   - Also assert the JS types (typeof checks)
 *
 * Type convention notes:
 *   - Securities latestPrice: expected as NUMBER (simple ÷1e8 conversion, like transaction amounts)
 *   - Performance routes: return STRING for all Decimal fields (intentional, for precision preservation)
 *   - Statement-of-assets: return STRING (same convention as performance)
 *   - Exchange rates: return STRING (stored as TEXT in vf_exchange_rate, not ×10^8)
 *   These conventions are verified by the existing test suite (performance.test.ts, statement-shares.test.ts).
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

const PORTFOLIO_UUID = '5ebdc254-bdd9-4ad9-8a57-a2f860089bfa';
const DEPOSIT_UUID   = '74011cf8-c166-4d2c-ac4c-af5e57017213';

// Securities
const SECURITY_A = '04db1b60-9230-4c5b-a070-613944e91dc3'; // active, prices + latest_price (latest > hist)
const SECURITY_B = 'b994772a-0642-499b-8bb2-caab851cdb12'; // retired, prices only, NO latest_price
const SECURITY_C = '6d8b85db-ce35-41fc-96fb-67d176db41fa'; // active, NO prices at all

// Transaction UUIDs
const TX_DEPOSIT   = 'bbbbbbbb-0001-0000-0000-000000000001';
const TX_BUY_SEC   = 'bbbbbbbb-0002-0000-0000-000000000001';
const TX_BUY_CASH  = 'bbbbbbbb-0002-0000-0000-000000000002';

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
    uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root TEXT
  );
  CREATE TABLE taxonomy_category (
    uuid TEXT PRIMARY KEY,
    taxonomy TEXT,
    name TEXT NOT NULL,
    parent TEXT,
    weight INTEGER
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
// All values are raw ppxml2db integers: prices/shares in ×10^8, amounts in hecto-units (×10^2).

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
    ('${SECURITY_B}', '21SHARES BITCOIN ETP OE',        'CH0454664001', '2BTC.DE', 'EUR', 1, '2026-03-24'),
    ('${SECURITY_C}', 'BTP VALORE GN27',                'IT0005547408', 'M.510540','EUR', 0, '2026-03-24');

  -- Historical prices for SECURITY_A (×10^8): 5 rows, 2026-03-16 to 2026-03-20
  INSERT INTO price (security, tstamp, value) VALUES
    ('${SECURITY_A}', '2026-03-16', 5363000000),
    ('${SECURITY_A}', '2026-03-17', 5302000000),
    ('${SECURITY_A}', '2026-03-18', 5235000000),
    ('${SECURITY_A}', '2026-03-19', 5137000000),
    ('${SECURITY_A}', '2026-03-20', 5097000000);

  -- Latest price for SECURITY_A: MORE RECENT than last historical (2026-03-21 > 2026-03-20)
  INSERT INTO latest_price (security, tstamp, value, high, low, volume) VALUES
    ('${SECURITY_A}', '2026-03-21', 5150000000, 5189000000, 5097000000, 3619);

  -- Historical prices for SECURITY_B (×10^8): older data, no latest_price
  INSERT INTO price (security, tstamp, value) VALUES
    ('${SECURITY_B}', '2025-09-01', 3400000000),
    ('${SECURITY_B}', '2025-09-02', 3420000000),
    ('${SECURITY_B}', '2025-09-03', 3450000000);

  -- SECURITY_C: deliberately NO prices at all (tests T1.3 null case)

  -- ──── DEPOSIT ──────────────────────────────────────────────────────────────
  -- amount=200000 hecto → 2000.00 EUR
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DEPOSIT}', 'DEPOSIT', '2026-03-14', 'EUR', 200000, 0, NULL, '${DEPOSIT_UUID}', 0, 0, 'account', '2026-03-24', 1, 1);

  -- ──── BUY pair: 5 shares of SECURITY_A ─────────────────────────────────────
  -- Securities-side: amount=25485 hecto (254.85 EUR), shares=500000000 (5), fees=500 hecto (5.00 EUR)
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_SEC}', 'BUY', '2026-03-17', 'EUR', 25485, 500000000, '${SECURITY_A}', '${PORTFOLIO_UUID}', 500, 0, 'portfolio', '2026-03-24', 2, 2);

  -- Cash-side
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_CASH}', 'BUY', '2026-03-17', 'EUR', 25485, 0, '${SECURITY_A}', '${DEPOSIT_UUID}', 0, 0, 'account', '2026-03-24', 3, 3);

  INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES
    ('${TX_BUY_SEC}', '${PORTFOLIO_UUID}', '${TX_BUY_CASH}', '${DEPOSIT_UUID}', 'buysell');

  INSERT INTO xact_unit (xact, type, amount, currency) VALUES
    ('${TX_BUY_SEC}', 'FEE', 500, 'EUR');

  -- ──── Exchange rate ────────────────────────────────────────────────────────
  INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES
    ('2026-03-20', 'EUR', 'USD', '1.0844');
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

// ═════════════════════════════════════════════════════════════════════════════════
// Test suite
// ═════════════════════════════════════════════════════════════════════════════════

(hasSqliteBindings ? describe : describe.skip)(
  'Read-Path Parity: Securities, Prices, Performance & Reports',
  () => {
    let app: Express;

    beforeAll(() => {
      const testDb = createTestDb();
      app = createApp(testDb.db as Parameters<typeof createApp>[0], testDb.sqlite);
    });

    // ═══ GROUP A — GET /api/securities (list) ══════════════════════════════════

    describe('GROUP A — GET /api/securities (list)', () => {
      it('T1.1 — latestPrice: raw 5150000000 (×10^8) → response 51.5 (number)', async () => {
        const res = await request(app).get('/api/securities').query({ includeRetired: 'true', limit: 50 });
        expect(res.status).toBe(200);
        const sec = res.body.data.find((s: Record<string, unknown>) => s.id === SECURITY_A);
        expect(sec).toBeDefined();
        // latest_price (2026-03-21, 51.5) is more recent than last historical (2026-03-20, 50.97)
        expect(sec.latestPrice).toBe(51.5);
        expect(typeof sec.latestPrice).toBe('number');
      });

      it('T1.2 — latestDate: returned as YYYY-MM-DD string, not null when present', async () => {
        const res = await request(app).get('/api/securities').query({ includeRetired: 'true', limit: 50 });
        const sec = res.body.data.find((s: Record<string, unknown>) => s.id === SECURITY_A);
        expect(sec.latestDate).toBe('2026-03-21');
        expect(typeof sec.latestDate).toBe('string');
        expect(sec.latestDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('T1.3 — latestPrice NULL when no latest_price row and no historical prices', async () => {
        const res = await request(app).get('/api/securities').query({ includeRetired: 'true', limit: 50 });
        const sec = res.body.data.find((s: Record<string, unknown>) => s.id === SECURITY_C);
        expect(sec).toBeDefined();
        expect(sec.latestPrice).toBeNull();
        // latestDate should also be null
        expect(sec.latestDate).toBeNull();
      });

      it('T1.4 — isRetired: 0/1 INTEGER → boolean in response', async () => {
        const res = await request(app).get('/api/securities').query({ includeRetired: 'true', limit: 50 });
        const active = res.body.data.find((s: Record<string, unknown>) => s.id === SECURITY_A);
        const retired = res.body.data.find((s: Record<string, unknown>) => s.id === SECURITY_B);
        expect(typeof active.isRetired).toBe('boolean');
        expect(active.isRetired).toBe(false);
        expect(typeof retired.isRetired).toBe('boolean');
        expect(retired.isRetired).toBe(true);
      });

      it('T1.5 — Decimal leak: latestPrice typeof === number (not string/object)', async () => {
        const res = await request(app).get('/api/securities').query({ includeRetired: 'true', limit: 50 });
        const secA = res.body.data.find((s: Record<string, unknown>) => s.id === SECURITY_A);
        expect(typeof secA.latestPrice).toBe('number');
        // SECURITY_B has historical prices, effective latestPrice from last historical close
        const secB = res.body.data.find((s: Record<string, unknown>) => s.id === SECURITY_B);
        // raw 3450000000 → 34.5
        expect(secB.latestPrice).toBe(34.5);
        expect(typeof secB.latestPrice).toBe('number');
      });

      it('T1.6 — currency: string, never null', async () => {
        const res = await request(app).get('/api/securities').query({ includeRetired: 'true', limit: 50 });
        for (const sec of res.body.data) {
          expect(typeof sec.currency).toBe('string');
          expect(sec.currency).not.toBeNull();
        }
      });
    });

    // ═══ GROUP B — GET /api/securities/:id (detail) ════════════════════════════

    describe('GROUP B — GET /api/securities/:id (detail)', () => {
      it('T2.1 — historical prices: each price.value ÷ 10^8 correctly converted', async () => {
        const res = await request(app).get(`/api/securities/${SECURITY_A}`);
        expect(res.status).toBe(200);
        const prices = res.body.prices as { date: string; value: string }[];
        expect(prices.length).toBe(5);
        // Verify specific conversions
        // First: raw 5363000000 → 53.63
        expect(prices[0].value).toBe('53.63');
        // Last: raw 5097000000 → 50.97
        expect(prices[prices.length - 1].value).toBe('50.97');
      });

      it('T2.2 — historical prices sorted by date ascending', async () => {
        const res = await request(app).get(`/api/securities/${SECURITY_A}`);
        const dates = (res.body.prices as { date: string }[]).map(p => p.date);
        for (let i = 1; i < dates.length; i++) { // native-ok
          expect(dates[i] >= dates[i - 1]).toBe(true);
        }
      });

      it('T2.3 — price date format: YYYY-MM-DD string', async () => {
        const res = await request(app).get(`/api/securities/${SECURITY_A}`);
        for (const p of res.body.prices as { date: string }[]) {
          expect(typeof p.date).toBe('string');
          expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      });

      it('T2.4 — latest_price injection: latestPrice/latestDate reflect latest_price when more recent', async () => {
        const res = await request(app).get(`/api/securities/${SECURITY_A}`);
        // latest_price (2026-03-21, value 5150000000 → 51.5) is more recent than
        // last historical (2026-03-20, value 5097000000 → 50.97)
        expect(res.body.latestDate).toBe('2026-03-21');
        // latestPrice should be 51.5 (from latest_price, converted ÷ 1e8)
        expect(res.body.latestPrice).toBe(51.5);
      });

      it('T2.5 — latest_price NOT in historical prices array', async () => {
        const res = await request(app).get(`/api/securities/${SECURITY_A}`);
        const dates = (res.body.prices as { date: string }[]).map(p => p.date);
        // The latest_price date (2026-03-21) must NOT appear in the historical timeseries
        expect(dates).not.toContain('2026-03-21');
        // Historical array should have exactly 5 entries (2026-03-16 to 2026-03-20)
        expect(dates).toEqual([
          '2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20',
        ]);
      });
    });

    // ═══ GROUP C — GET /api/performance/securities ═════════════════════════════
    // NOTE: The task spec references GET /api/securities/:id/performance, which does not exist.
    // The actual route is GET /api/performance/securities (returns list of all securities).
    //
    // Convention: Performance routes return Decimal fields as STRING (Decimal.toString())
    // for precision preservation. This is verified by the existing performance.test.ts.
    // Tests below verify no Decimal object leak (typeof !== 'object').

    describe('GROUP C — GET /api/performance/securities', () => {
      it('T3.1 — irr: string or null (no Decimal object leak)', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: '2026-03-14', periodEnd: '2026-03-21' });
        expect(res.status).toBe(200);
        const sec = (res.body as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(sec).toBeDefined();
        // irr is string | null — never a Decimal object
        expect(sec!.irr === null || typeof sec!.irr === 'string').toBe(true);
        if (sec!.irr !== null) {
          expect(typeof sec!.irr).not.toBe('object');
          // Verify it parses as a finite number
          expect(Number.isFinite(parseFloat(sec!.irr as string))).toBe(true);
        }
      });

      it('T3.2 — ttwror: string (no Decimal leak)', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: '2026-03-14', periodEnd: '2026-03-21' });
        const sec = (res.body as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(typeof sec!.ttwror).toBe('string');
        expect(Number.isFinite(parseFloat(sec!.ttwror as string))).toBe(true);
      });

      it('T3.3 — purchaseValue: string (engine Decimal → toString)', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: '2026-03-14', periodEnd: '2026-03-21' });
        const sec = (res.body as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(typeof sec!.purchaseValue).toBe('string');
        expect(parseFloat(sec!.purchaseValue as string)).toBeGreaterThan(0);
      });

      it('T3.4 — mve (market value end): string', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: '2026-03-14', periodEnd: '2026-03-21' });
        const sec = (res.body as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(typeof sec!.mve).toBe('string');
        expect(parseFloat(sec!.mve as string)).toBeGreaterThan(0);
      });

      it('T3.5 — unrealizedGain, realizedGain: string (can be negative)', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: '2026-03-14', periodEnd: '2026-03-21' });
        const sec = (res.body as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(typeof sec!.unrealizedGain).toBe('string');
        expect(typeof sec!.realizedGain).toBe('string');
        // Both should parse as finite numbers
        expect(Number.isFinite(parseFloat(sec!.unrealizedGain as string))).toBe(true);
        expect(Number.isFinite(parseFloat(sec!.realizedGain as string))).toBe(true);
      });

      it('T3.6 — irrConverged: boolean', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: '2026-03-14', periodEnd: '2026-03-21' });
        const sec = (res.body as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(typeof sec!.irrConverged).toBe('boolean');
      });
    });

    // ═══ GROUP D — GET /api/reports/statement-of-assets ════════════════════════
    // Convention: Statement fields use STRING (Decimal.toString()) for precision.
    // Tests verify correct values and no Decimal object leaks.

    describe('GROUP D — GET /api/reports/statement-of-assets', () => {
      it('T4.1 — marketValue per security: string, parseable, > 0', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: '2026-03-21' });
        expect(res.status).toBe(200);
        const sec = (res.body.securities as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(sec).toBeDefined();
        expect(typeof sec!.marketValue).toBe('string');
        expect(parseFloat(sec!.marketValue as string)).toBeGreaterThan(0);
      });

      it('T4.2 — shares per security: string, ×10^8 correctly converted to 5', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: '2026-03-21' });
        const sec = (res.body.securities as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        expect(typeof sec!.shares).toBe('string');
        expect(parseFloat(sec!.shares as string)).toBe(5);
      });

      it('T4.3 — price used: latest_price (51.5) when more recent than historical (50.97)', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: '2026-03-21' });
        const sec = (res.body.securities as Record<string, unknown>[]).find(
          (s: Record<string, unknown>) => s.securityId === SECURITY_A,
        );
        // pricePerShare should be 51.5 (latest_price 2026-03-21 > hist 2026-03-20)
        expect(parseFloat(sec!.pricePerShare as string)).toBe(51.5);
        // marketValue = 5 shares × 51.5 = 257.5
        expect(parseFloat(sec!.marketValue as string)).toBe(257.5);
      });
    });

    // ═══ GROUP E — GET /api/prices/exchange-rates ══════════════════════════════
    // Exchange rates are stored as TEXT in vf_exchange_rate (e.g. "1.0844").
    // The route returns Decimal.toString() → string.

    describe('GROUP E — GET /api/prices/exchange-rates', () => {
      it('T5.1 — rate: string (TEXT storage in vf_exchange_rate, returned via Decimal.toString())', async () => {
        const res = await request(app)
          .get('/api/prices/exchange-rates')
          .query({ from: 'EUR', to: 'USD', date: '2026-03-20' });
        expect(res.status).toBe(200);
        // vf_exchange_rate stores rate as TEXT "1.0844"
        // getRate() → new Decimal("1.0844") → route returns .toString() → "1.0844"
        expect(typeof res.body.rate).toBe('string');
        expect(res.body.rate).toBe('1.0844');
      });
    });
  },
);
