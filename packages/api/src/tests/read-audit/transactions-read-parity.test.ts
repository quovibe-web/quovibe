/**
 * Read-Path Parity Tests — Transactions & Accounts
 *
 * Ground truth: docs/audit/fixtures/xact-buy.json, xact-cash-types.json, account.json
 * Spec: docs/audit/read-path/00-read-path-spec.md
 *
 * Strategy:
 *   - INSERT raw fixture rows directly into the test DB using raw SQL (NOT the service write layer)
 *   - Call the GET route via Supertest
 *   - Assert the JSON response field values match the expected converted values
 *   - Also assert the JS types (typeof checks: must be number, not string, not object)
 *
 * This approach isolates the read path completely from the write path.
 * The fixture rows ARE the ppxml2db ground truth.
 *
 * Findings fixed by this session:
 *   R2 (HIGH): fees/taxes returned as raw hecto-unit integers → now ÷100 and returned as number
 *   R1 (MEDIUM): amount/shares inconsistency (string vs number) → now number everywhere
 *   NEW: GET /api/transactions/:id route added
 *   NEW: account balance returned as number (was string)
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
const RETIRED_UUID   = 'e6180b02-8157-41a4-8bee-2d9c6575d6ba';

const SECURITY_A = '04db1b60-9230-4c5b-a070-613944e91dc3';
const SECURITY_B = '99401ac3-2a74-4078-b15d-56c5868db9dd';
const SECURITY_C = '6d8b85db-ce35-41fc-96fb-67d176db41fa';

// Transaction UUIDs
const TX_DEPOSIT     = 'aaaaaaaa-0001-0000-0000-000000000001';
const TX_DEPOSIT2    = 'aaaaaaaa-0001-0000-0000-000000000002';
const TX_BUY_SEC     = 'aaaaaaaa-0002-0000-0000-000000000001';
const TX_BUY_CASH    = 'aaaaaaaa-0002-0000-0000-000000000002';
const TX_BUY2_SEC    = 'aaaaaaaa-0003-0000-0000-000000000001';
const TX_BUY2_CASH   = 'aaaaaaaa-0003-0000-0000-000000000002';
const TX_DIVIDEND    = 'aaaaaaaa-0004-0000-0000-000000000001';

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
  CREATE TABLE config_entry (
    uuid TEXT,
    config_set INTEGER,
    name TEXT NOT NULL,
    data TEXT
  );
  CREATE TABLE property (
    name TEXT PRIMARY KEY,
    special INTEGER NOT NULL DEFAULT 0,
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
  CREATE TABLE taxonomy_assignment (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    taxonomy TEXT,
    item TEXT,
    item_type TEXT
  );
  CREATE TABLE taxonomy_assignment_data (
    assignment INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL
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
`;

// ─── Seed Data ─────────────────────────────────────────────────────────────────
// All values are raw ppxml2db integers (hecto-units for amounts/fees/taxes, ×10^8 for shares).

const SEED_SQL = `
  -- Accounts
  INSERT INTO account (uuid, type, name, currency, isRetired, referenceAccount, updatedAt, _xmlid, _order) VALUES
    ('${PORTFOLIO_UUID}', 'portfolio', 'Directa (Titoli)',    NULL,  0, '${DEPOSIT_UUID}', '2026-03-24', 1, 1),
    ('${DEPOSIT_UUID}',   'account',   'Directa (Liquidità)', 'EUR', 0, NULL,              '2026-03-24', 2, 2),
    ('${RETIRED_UUID}',   'account',   'Conto Rendimax',      'EUR', 1, NULL,              '2024-08-14', 3, 3);

  -- Securities
  INSERT INTO security (uuid, name, isin, tickerSymbol, currency, updatedAt) VALUES
    ('${SECURITY_A}', 'VWCE',        'IE00BK5BQT80', 'VWCE',     'EUR', '2026-03-24'),
    ('${SECURITY_B}', 'BTP 1FB37',   'IT0005532715', 'BTP1FB37',  'EUR', '2026-03-24'),
    ('${SECURITY_C}', 'BTP VALORE1', 'IT0005547390', 'BTPVAL1',   'EUR', '2026-03-24');

  -- ──── DEPOSIT ──────────────────────────────────────────────────────────
  -- T1.1: amount=150000 hecto → expect 1500
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DEPOSIT}', 'DEPOSIT', '2020-09-01', 'EUR', 150000, 0, NULL, '${DEPOSIT_UUID}', 0, 0, 'account', '2024-01-18', 500, 50000);

  -- Second deposit (from fixture)
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DEPOSIT2}', 'DEPOSIT', '2020-09-02', 'EUR', 400000, 0, NULL, '${DEPOSIT_UUID}', 0, 0, 'account', '2024-01-18', 296, 44330);

  -- ──── BUY pair #1 ──────────────────────────────────────────────────────
  -- T1.2: shares=1000000000 → expect 10
  -- T1.3: fees=550 → expect 5.5
  -- T1.4: taxes=0 → expect 0
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_SEC}', 'BUY', '2020-09-03', 'EUR', 150000, 1000000000, '${SECURITY_A}', '${PORTFOLIO_UUID}', 550, 0, 'portfolio', '2024-01-18', 28, 39234);

  -- Cash-side (excluded from global list, visible in deposit account list)
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY_CASH}', 'BUY', '2020-09-03', 'EUR', 150000, 0, '${SECURITY_A}', '${DEPOSIT_UUID}', 0, 0, 'account', '2024-01-18', 25, 44136);

  INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES
    ('${TX_BUY_SEC}', '${PORTFOLIO_UUID}', '${TX_BUY_CASH}', '${DEPOSIT_UUID}', 'buysell');

  INSERT INTO xact_unit (xact, type, amount, currency) VALUES
    ('${TX_BUY_SEC}', 'FEE', 550, 'EUR');

  -- ──── BUY pair #2 (with fees + taxes) ──────────────────────────────────
  -- T2.4: taxes=61802 → expect 618.02
  -- T2.6/T2.7: xact_unit FEE + TAX
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY2_SEC}', 'BUY', '2024-01-17', 'EUR', 3856602, 38000000000, '${SECURITY_B}', '${PORTFOLIO_UUID}', 500, 61802, 'portfolio', '2024-02-09', 122, 40986);

  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_BUY2_CASH}', 'BUY', '2024-01-17', 'EUR', 3856602, 0, '${SECURITY_B}', '${DEPOSIT_UUID}', 0, 0, 'account', '2024-02-09', 120, 40988);

  INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES
    ('${TX_BUY2_SEC}', '${PORTFOLIO_UUID}', '${TX_BUY2_CASH}', '${DEPOSIT_UUID}', 'buysell');

  INSERT INTO xact_unit (xact, type, amount, currency) VALUES
    ('${TX_BUY2_SEC}', 'FEE', 500, 'EUR'),
    ('${TX_BUY2_SEC}', 'TAX', 61802, 'EUR');

  -- ──── DIVIDEND (with taxes) ────────────────────────────────────────────
  INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, fees, taxes, acctype, updatedAt, _xmlid, _order) VALUES
    ('${TX_DIVIDEND}', 'DIVIDENDS', '2023-12-13', 'EUR', 71094, 50000000000, '${SECURITY_C}', '${DEPOSIT_UUID}', 0, 10156, 'account', '2024-12-16', 348, 45202);

  INSERT INTO xact_unit (xact, type, amount, currency) VALUES
    ('${TX_DIVIDEND}', 'TAX', 10156, 'EUR');
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
  'Read-Path Parity: Transactions & Accounts',
  () => {
    let app: Express;

    beforeAll(() => {
      const testDb = createTestDb();
      app = createApp(testDb.db as Parameters<typeof createApp>[0], testDb.sqlite);
    });

    // ═══ GROUP A — GET /api/transactions (list) ════════════════════════════════

    describe('GROUP A — GET /api/transactions (list)', () => {
      it('T1.1 — amount: raw 150000 hecto → response 1500 (number)', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        expect(res.status).toBe(200);
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_DEPOSIT);
        expect(tx).toBeDefined();
        expect(tx.amount).toBe(1500);
        expect(typeof tx.amount).toBe('number');
      });

      it('T1.2 — shares: raw 1000000000 (×10^8) → response 10 (number)', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY_SEC);
        expect(tx).toBeDefined();
        expect(tx.shares).toBe(10);
        expect(typeof tx.shares).toBe('number');
      });

      it('T1.3 — fees: raw 550 hecto → response 5.5 (number)', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY_SEC);
        expect(tx.fees).toBe(5.5);
        expect(typeof tx.fees).toBe('number');
      });

      it('T1.4 — taxes: raw 0 → response 0 (number, not null, not undefined)', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY_SEC);
        expect(tx.taxes).toBe(0);
        expect(typeof tx.taxes).toBe('number');
      });

      it('T1.5 — date: stored YYYY-MM-DD → response is string YYYY-MM-DD', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_DEPOSIT);
        expect(typeof tx.date).toBe('string');
        expect(tx.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
      });

      it('T1.6 — security: NULL in DB → null in response (not undefined, not "")', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_DEPOSIT);
        expect(tx.security).toBeNull();
         
        expect(tx.hasOwnProperty('security')).toBe(true);
      });

      it('T1.7 — Decimal leak: amount and shares typeof === "number" for every row', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        for (const tx of res.body.data) {
          expect(typeof tx.amount).toBe('number');
          expect(typeof tx.shares).toBe('number');
        }
      });

      it('T1.8 — BUY cash-side row (shares=0): excluded from global list', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        const cashSide1 = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY_CASH);
        const cashSide2 = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY2_CASH);
        expect(cashSide1).toBeUndefined();
        expect(cashSide2).toBeUndefined();
      });

      it('T1.9 — crossAccountId: present for BUY, derived from xact_cross_entry', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY_SEC);
        expect(tx.crossAccountId).toBe(DEPOSIT_UUID);
      });

      it('T1.10 — pagination: total excludes cash-side rows', async () => {
        const res = await request(app).get('/api/transactions').query({ limit: 100 });
        // Visible: TX_DEPOSIT, TX_DEPOSIT2, TX_BUY_SEC, TX_BUY2_SEC, TX_DIVIDEND = 5
        // Excluded: TX_BUY_CASH, TX_BUY2_CASH = 2
        expect(res.body.total).toBe(5);
      });
    });

    // ═══ GROUP B — GET /api/transactions/:id (single) ══════════════════════════

    describe('GROUP B — GET /api/transactions/:id (single)', () => {
      it('T2.1 — amount: raw 79316-equivalent → correct number', async () => {
        const res = await request(app).get(`/api/transactions/${TX_BUY_SEC}`);
        expect(res.status).toBe(200);
        expect(res.body.amount).toBe(1500); // 150000 / 100
        expect(typeof res.body.amount).toBe('number');
      });

      it('T2.2 — shares: raw 1000000000 → 10 (number)', async () => {
        const res = await request(app).get(`/api/transactions/${TX_BUY_SEC}`);
        expect(res.body.shares).toBe(10);
        expect(typeof res.body.shares).toBe('number');
      });

      it('T2.3 — fees: raw 550 → 5.5 (number)', async () => {
        const res = await request(app).get(`/api/transactions/${TX_BUY_SEC}`);
        expect(res.body.fees).toBe(5.5);
        expect(typeof res.body.fees).toBe('number');
      });

      it('T2.4 — taxes: raw 61802 → 618.02 (number)', async () => {
        const res = await request(app).get(`/api/transactions/${TX_BUY2_SEC}`);
        expect(res.body.taxes).toBe(618.02);
        expect(typeof res.body.taxes).toBe('number');
      });

      it('T2.5 — date is string', async () => {
        const res = await request(app).get(`/api/transactions/${TX_BUY_SEC}`);
        expect(typeof res.body.date).toBe('string');
      });

      it('T2.6 — xact_unit: FEE and TAX units present for BUY with taxes', async () => {
        const res = await request(app).get(`/api/transactions/${TX_BUY2_SEC}`);
        expect(Array.isArray(res.body.units)).toBe(true);
        const unitTypes = res.body.units.map((u: Record<string, unknown>) => u.type);
        expect(unitTypes).toContain('FEE');
        expect(unitTypes).toContain('TAX');
      });

      it('T2.7 — xact_unit amounts: raw hecto → correctly converted numbers', async () => {
        const res = await request(app).get(`/api/transactions/${TX_BUY2_SEC}`);
        const feeUnit = res.body.units.find((u: Record<string, unknown>) => u.type === 'FEE');
        const taxUnit = res.body.units.find((u: Record<string, unknown>) => u.type === 'TAX');
        expect(feeUnit.amount).toBe(5);       // 500 / 100
        expect(taxUnit.amount).toBe(618.02);   // 61802 / 100
        expect(typeof feeUnit.amount).toBe('number');
        expect(typeof taxUnit.amount).toBe('number');
      });

      it('T2.8 — 404 for non-existent UUID', async () => {
        const res = await request(app).get('/api/transactions/00000000-0000-0000-0000-000000000000');
        expect(res.status).toBe(404);
      });
    });

    // ═══ GROUP C — GET /api/accounts/:id/transactions ══════════════════════════

    describe('GROUP C — GET /api/accounts/:id/transactions', () => {
      it('T3.1 — only rows where xact.account = accountId (no cross-entry duplicates)', async () => {
        const res = await request(app)
          .get(`/api/accounts/${PORTFOLIO_UUID}/transactions`)
          .query({ limit: 100 });
        expect(res.status).toBe(200);
        for (const tx of res.body.data) {
          expect(tx.account).toBe(PORTFOLIO_UUID);
        }
        // Portfolio has exactly 2 BUY rows (securities-side only)
        expect(res.body.data).toHaveLength(2);
      });

      it('T3.2 — deposit account includes BUY cash-side rows (no shares=0 exclusion)', async () => {
        const res = await request(app)
          .get(`/api/accounts/${DEPOSIT_UUID}/transactions`)
          .query({ limit: 100 });
        expect(res.status).toBe(200);
        // Cash-side BUY rows belong to the deposit — they MUST appear here
        const cashSide1 = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY_CASH);
        const cashSide2 = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_BUY2_CASH);
        expect(cashSide1).toBeDefined();
        expect(cashSide2).toBeDefined();
        // Deposit has: 2 DEPOSITs + 2 BUY cash-sides + 1 DIVIDEND = 5 rows
        expect(res.body.total).toBe(5);
      });

      it('T3.3 — amount conversion same as GROUP A (number, converted)', async () => {
        const res = await request(app)
          .get(`/api/accounts/${DEPOSIT_UUID}/transactions`)
          .query({ limit: 100 });
        const tx = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_DEPOSIT);
        expect(tx).toBeDefined();
        expect(tx.amount).toBe(1500);
        expect(typeof tx.amount).toBe('number');
      });

      it('T3.4 — fees/taxes converted for per-account list', async () => {
        const res = await request(app)
          .get(`/api/accounts/${DEPOSIT_UUID}/transactions`)
          .query({ limit: 100 });
        const div = res.body.data.find((t: Record<string, unknown>) => t.uuid === TX_DIVIDEND);
        expect(div.taxes).toBe(101.56); // 10156 / 100
        expect(typeof div.taxes).toBe('number');
        expect(div.fees).toBe(0);
        expect(typeof div.fees).toBe('number');
      });
    });

    // ═══ GROUP D — GET /api/accounts ════════════════════════════════════════════

    describe('GROUP D — GET /api/accounts and GET /api/accounts/:id', () => {
      it('T4.1 — balance is a number (not Decimal, not string)', async () => {
        const res = await request(app).get('/api/accounts');
        expect(res.status).toBe(200);
        for (const acct of res.body) {
          expect(typeof acct.balance).toBe('number');
        }
      });

      it('T4.2 — deposit balance sign convention with known cash flows', async () => {
        const res = await request(app).get(`/api/accounts/${DEPOSIT_UUID}`);
        expect(res.status).toBe(200);
        // Deposit cash flows:
        //   +DEPOSIT  150000 hecto = +1500.00
        //   +DEPOSIT2 400000       = +4000.00
        //   -BUY_CASH  150000      = -1500.00
        //   -BUY2_CASH 3856602     = -38566.02
        //   +DIVIDEND  71094       = +710.94
        // Net: 1500 + 4000 - 1500 - 38566.02 + 710.94 = -33855.08
        expect(typeof res.body.balance).toBe('number');
        expect(res.body.balance).toBeCloseTo(-33855.08, 2);
      });

      it('T4.3 — isRetired: boolean (not integer)', async () => {
        const res = await request(app).get('/api/accounts?includeRetired=true');
        expect(res.status).toBe(200);

        const retired = res.body.find((a: Record<string, unknown>) => a.id === RETIRED_UUID);
        expect(retired).toBeDefined();
        expect(retired.isRetired).toBe(true);
        expect(typeof retired.isRetired).toBe('boolean');

        const active = res.body.find((a: Record<string, unknown>) => a.id === DEPOSIT_UUID);
        expect(active.isRetired).toBe(false);
        expect(typeof active.isRetired).toBe('boolean');
      });

      it('T4.4 — referenceAccount: present for portfolio, null for deposit', async () => {
        const res = await request(app).get('/api/accounts');
        const portfolio = res.body.find((a: Record<string, unknown>) => a.id === PORTFOLIO_UUID);
        expect(portfolio.referenceAccountId).toBe(DEPOSIT_UUID);

        const deposit = res.body.find((a: Record<string, unknown>) => a.id === DEPOSIT_UUID);
        expect(deposit.referenceAccountId).toBeNull();
      });

      it('T4.5 — single account balance is also a number', async () => {
        const res = await request(app).get(`/api/accounts/${DEPOSIT_UUID}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.balance).toBe('number');
      });
    });
  },
);
