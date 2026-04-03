// Full-stack integration regression via Supertest
// Verifies the DB → service → engine → serializer pipeline end-to-end.
// Reference: docs/audit/engine-regression/reference-values.md (Sections B, C, H)
//
// Uses an in-memory SQLite DB seeded with BTP VALORE GN27 fixture data.
// All reference values are from the real ppxml2db-migrated DB.
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';
import request from 'supertest';
import type { Express } from 'express';

// ─── Skip if native SQLite bindings are unavailable ────────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Reference constants ─────────────────────────────────────────────────────

const PERIOD_START = '2025-01-01';
const PERIOD_END = '2025-12-31';

// UUIDs
const PORTFOLIO_UUID = 'aaaaaaaa-0001-0000-0000-000000000001';
const DEPOSIT_UUID = 'aaaaaaaa-0002-0000-0000-000000000002';
const BTP_UUID = '6d8b85db-ce35-41fc-96fb-67d176db41fa';

const TX_DEPOSIT = 'cccccccc-0001-0000-0000-000000000001';
const TX_BUY_SEC = 'cccccccc-0002-0000-0000-000000000001';
const TX_BUY_CASH = 'cccccccc-0002-0000-0000-000000000002';
const TX_DIV1 = 'cccccccc-0003-0000-0000-000000000001';
const TX_DIV2 = 'cccccccc-0004-0000-0000-000000000001';

// BTP VALORE GN27 reference values (Section B.1)
const BTP_SHARES = 500;
const BTP_PRICE_START = 102.57; // 2024-12-30 close
const BTP_PRICE_END = 102.27;   // 2025-12-30 close
const BTP_MVB = BTP_SHARES * BTP_PRICE_START; // 51285.00  // native-ok
const BTP_MVE = BTP_SHARES * BTP_PRICE_END;   // 51135.00  // native-ok

// Dividend reference (Section B.1, gross)
const DIV1_NET = 71094;   // 710.94 EUR in hecto
const DIV1_TAX = 10156;   // 101.56 EUR in hecto
const DIV2_NET = 87500;   // 875.00 EUR in hecto
const DIV2_TAX = 12500;   // 125.00 EUR in hecto

// ─── Schema SQL (matching ppxml2db structure) ──────────────────────────────────

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

// ─── Seed Data ────────────────────────────────────────────────────────────────
// BTP VALORE GN27: 500 shares held throughout 2025, 2 dividends
// All amounts in hecto-units (×10^2), shares/prices in ×10^8

const SEED_SQL = `
  INSERT INTO property (name, value) VALUES ('portfolio.currency', 'EUR');

  -- Accounts: 1 portfolio + 1 deposit
  INSERT INTO account (uuid, type, name, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order) VALUES
    ('${PORTFOLIO_UUID}', 'portfolio', 'Test Portfolio', NULL, 0, '${DEPOSIT_UUID}', '2025-01-01', 1, 1),
    ('${DEPOSIT_UUID}',   'account',   'Test Deposit',  'EUR', 0, NULL,              '2025-01-01', 2, 2);

  -- Security: BTP VALORE GN27
  INSERT INTO security (uuid, name, isin, currency, isRetired, updatedAt) VALUES
    ('${BTP_UUID}', 'BTP VALORE GN27', 'IT0005547408', 'EUR', 0, '2025-01-01');

  -- Historical prices (×10^8):
  -- 102.57 EUR = 10257000000, 102.27 EUR = 10227000000
  INSERT INTO price (security, tstamp, value) VALUES
    ('${BTP_UUID}', '2024-12-30', 10257000000),
    ('${BTP_UUID}', '2025-12-30', 10227000000);

  -- DEPOSIT (before period): 55,000 EUR → 5500000 hecto
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DEPOSIT}', 'DEPOSIT', '2024-06-01', 'EUR', 5500000, 0, NULL, '${DEPOSIT_UUID}', 0, 0, 'account', '2024-06-01', 1, 1);

  -- BUY 500 shares of BTP at 101.00 EUR = 50,500 EUR
  -- Securities-side: amount=5050000 hecto, shares=50000000000 (500 × 10^8)
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_SEC}', 'BUY', '2024-06-15', 'EUR', 5050000, 50000000000, '${BTP_UUID}', '${PORTFOLIO_UUID}', 0, 0, 'portfolio', '2024-06-15', 2, 2);

  -- Cash-side of BUY
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_CASH}', 'BUY', '2024-06-15', 'EUR', 5050000, 0, '${BTP_UUID}', '${DEPOSIT_UUID}', 0, 0, 'account', '2024-06-15', 3, 3);

  INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES
    ('${TX_BUY_SEC}', '${PORTFOLIO_UUID}', '${TX_BUY_CASH}', '${DEPOSIT_UUID}', 'buysell');

  -- DIVIDEND 1: 2025-06-13, net=710.94, tax=101.56
  -- ppxml2db stores DIVIDENDS (plural), account=deposit, security=BTP, shares=500
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DIV1}', 'DIVIDENDS', '2025-06-13', 'EUR', ${DIV1_NET}, 50000000000, '${BTP_UUID}', '${DEPOSIT_UUID}', 0, ${DIV1_TAX}, 'account', '2025-06-13', 4, 4);

  INSERT INTO xact_unit (xact, type, amount, currency) VALUES
    ('${TX_DIV1}', 'TAX', ${DIV1_TAX}, 'EUR');

  -- DIVIDEND 2: 2025-12-13, net=875.00, tax=125.00
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DIV2}', 'DIVIDENDS', '2025-12-13', 'EUR', ${DIV2_NET}, 50000000000, '${BTP_UUID}', '${DEPOSIT_UUID}', 0, ${DIV2_TAX}, 'account', '2025-12-13', 5, 5);

  INSERT INTO xact_unit (xact, type, amount, currency) VALUES
    ('${TX_DIV2}', 'TAX', ${DIV2_TAX}, 'EUR');
`;

// ─── DB Factory ────────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(CREATE_TABLES_SQL);
  sqlite.exec(SEED_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

(hasSqliteBindings ? describe : describe.skip)(
  'GROUP C — Full-Stack Integration Regression',
  () => {
    let app: Express;

    beforeAll(() => {
      const testDb = createTestDb();
      app = createApp(testDb.db as Parameters<typeof createApp>[0], testDb.sqlite);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // R7.1 — GET /api/performance/calculation
    // Verifies the full portfolio calculation pipeline.
    // With only BTP + cash, we can verify structural correctness and key values.
    // ─────────────────────────────────────────────────────────────────────────
    describe('R7.1 — GET /api/performance/calculation', () => {
      it('returns 200 with correct structure', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        expect(res.status).toBe(200);
        const body = res.body;

        // All Decimal fields are serialized as strings
        expect(typeof body.initialValue).toBe('string');
        expect(typeof body.finalValue).toBe('string');
        expect(typeof body.ttwror).toBe('string');
        expect(typeof body.ttwrorPa).toBe('string');
        expect(typeof body.absoluteChange).toBe('string');
        expect(typeof body.delta).toBe('string');
      });

      it('IRR converges and is positive (dividends > price decline)', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        expect(res.status).toBe(200);
        expect(res.body.irrConverged).toBe(true);
        expect(parseFloat(res.body.irr)).toBeGreaterThan(0);
      });

      it('TTWROR is positive and within expected range', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        expect(res.status).toBe(200);
        const ttwror = parseFloat(res.body.ttwror);

        // With BTP's 2-price data + dividends, TTWROR should be positive
        // and in a reasonable range (1-5%)
        expect(ttwror).toBeGreaterThan(0.01);
        expect(ttwror).toBeLessThan(0.05);
      });

      it('dividends total matches gross: 812.50 + 1000.00 = 1812.50', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        expect(res.status).toBe(200);
        const dividends = parseFloat(res.body.earnings.dividends);

        // Gross dividends: 710.94 + 101.56 = 812.50, 875.00 + 125.00 = 1000.00
        // Total = 1812.50
        expect(dividends).toBeCloseTo(1812.5, 1);
      });

      it('capital gains unrealized = MVE - purchaseValue (BTP only)', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        expect(res.status).toBe(200);
        const unrealized = parseFloat(res.body.capitalGains.unrealized);
        const realized = parseFloat(res.body.capitalGains.realized);

        // No SELL → realized = 0
        expect(realized).toBe(0);
        // BUY before period → purchaseValue = MVB = 51285 (ref H.1)
        // Unrealized = MVE - purchaseValue = 51135 - 51285 = -150
        expect(unrealized).toBeCloseTo(-150, 0);
      });

      it('performance-neutral transfers: no deposits/removals in period', async () => {
        const res = await request(app)
          .get('/api/performance/calculation')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        expect(res.status).toBe(200);
        const pnt = res.body.performanceNeutralTransfers;
        expect(parseFloat(pnt.deposits)).toBe(0);
        expect(parseFloat(pnt.removals)).toBe(0);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // R7.2 — GET /api/performance/securities
    // Verifies per-security performance matches reference trace.
    // ─────────────────────────────────────────────────────────────────────────
    describe('R7.2 — GET /api/performance/securities', () => {
      it('returns BTP with correct shares and MVB/MVE', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        expect(res.status).toBe(200);
        const securities = res.body as Array<Record<string, string>>;
        const btp = securities.find((s) => s.securityId === BTP_UUID);

        expect(btp).toBeDefined();
        expect(btp!.shares).toBe('500');

        // MVB = 500 × 102.57 = 51285
        expect(parseFloat(btp!.mvb)).toBeCloseTo(BTP_MVB, 0);

        // MVE = 500 × 102.27 = 51135
        expect(parseFloat(btp!.mve)).toBeCloseTo(BTP_MVE, 0);
      });

      it('BTP unrealizedGain = -150 (MVE - MVB, ref H.1)', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        const securities = res.body as Array<Record<string, string>>;
        const btp = securities.find((s) => s.securityId === BTP_UUID)!;

        // BUY before period → purchaseValue = MVB = 51285 (ref H.1)
        // unrealizedGain = MVE - purchaseValue = 51135 - 51285 = -150
        const unrealizedGain = parseFloat(btp.unrealizedGain);
        expect(unrealizedGain).toBeCloseTo(-150, 0);
      });

      it('BTP TTWROR positive (dividends offset price decline)', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        const securities = res.body as Array<Record<string, string>>;
        const btp = securities.find((s) => s.securityId === BTP_UUID)!;

        const ttwror = parseFloat(btp.ttwror);
        // With dividends grossing 1812.50 on a 51285 base, TTWROR should be ~3%
        expect(ttwror).toBeGreaterThan(0.02);
        expect(ttwror).toBeLessThan(0.05);
      });

      it('BTP IRR converges', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        const securities = res.body as Array<Record<string, string>>;
        const btp = securities.find((s) => s.securityId === BTP_UUID)!;

        expect(btp.irrConverged).toBe(true);
        const irr = parseFloat(btp.irr);
        // IRR should be close to TTWROR (~3%)
        expect(irr).toBeGreaterThan(0.02);
        expect(irr).toBeLessThan(0.05);
      });

      it('BTP dividends = gross total 1812.50', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        const securities = res.body as Array<Record<string, string>>;
        const btp = securities.find((s) => s.securityId === BTP_UUID)!;

        expect(parseFloat(btp.dividends)).toBeCloseTo(1812.5, 1);
      });

      it('BTP realizedGain = 0 (no SELL in period)', async () => {
        const res = await request(app)
          .get('/api/performance/securities')
          .query({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

        const securities = res.body as Array<Record<string, string>>;
        const btp = securities.find((s) => s.securityId === BTP_UUID)!;

        expect(parseFloat(btp.realizedGain)).toBe(0);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // R7.3 — GET /api/reports/statement-of-assets
    // Verifies that each security's MV = shares × price at reference date.
    // ─────────────────────────────────────────────────────────────────────────
    describe('R7.3 — GET /api/reports/statement-of-assets', () => {
      it('returns correct structure with securities and deposit accounts', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: PERIOD_END });

        expect(res.status).toBe(200);
        const body = res.body;

        expect(body.date).toBe(PERIOD_END);
        expect(Array.isArray(body.securities)).toBe(true);
        expect(Array.isArray(body.depositAccounts)).toBe(true);
        expect(body.totals).toBeDefined();
        expect(typeof body.totals.marketValue).toBe('string');
        expect(typeof body.totals.securityValue).toBe('string');
        expect(typeof body.totals.cashValue).toBe('string');
      });

      it('BTP market value = 500 × 102.27 = 51,135.00 ± 0.01', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: PERIOD_END });

        expect(res.status).toBe(200);
        const securities = res.body.securities as Array<{
          securityId: string;
          shares: string;
          pricePerShare: string;
          marketValue: string;
        }>;

        const btp = securities.find((s) => s.securityId === BTP_UUID);
        expect(btp).toBeDefined();
        expect(btp!.shares).toBe('500');
        expect(parseFloat(btp!.marketValue)).toBeCloseTo(BTP_MVE, 1);
      });

      it('deposit balance reflects BUY deduction + dividend inflows', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: PERIOD_END });

        expect(res.status).toBe(200);
        const accounts = res.body.depositAccounts as Array<{
          accountId: string;
          balance: string;
        }>;

        const deposit = accounts.find((a) => a.accountId === DEPOSIT_UUID);
        expect(deposit).toBeDefined();

        // Balance = 55000 (DEPOSIT) - 50500 (BUY) + 710.94 (DIV1 net) + 875.00 (DIV2 net)
        // = 6085.94
        const balance = parseFloat(deposit!.balance);
        expect(balance).toBeCloseTo(6085.94, 1);
      });

      it('totals = securityValue + cashValue', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: PERIOD_END });

        expect(res.status).toBe(200);
        const totals = res.body.totals;
        const mv = parseFloat(totals.marketValue);
        const sec = parseFloat(totals.securityValue);
        const cash = parseFloat(totals.cashValue);

        expect(mv).toBeCloseTo(sec + cash, 2); // native-ok
      });

      it('security value matches portfolio MV (single security)', async () => {
        const res = await request(app)
          .get('/api/reports/statement-of-assets')
          .query({ date: PERIOD_END });

        expect(res.status).toBe(200);
        const secValue = parseFloat(res.body.totals.securityValue);

        // Single security: total security value = BTP MV
        expect(secValue).toBeCloseTo(BTP_MVE, 1);
      });
    });
  },
);
