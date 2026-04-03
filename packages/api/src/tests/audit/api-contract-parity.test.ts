/**
 * API Contract Parity Tests
 *
 * Supertest-based contract tests that verify the full vertical stack:
 *   HTTP request → Zod validation → route handler → service layer → raw DB state
 *
 * These complement the service-level audit tests by catching Zod validation gaps,
 * route handler bugs, and middleware issues at the HTTP boundary.
 *
 * Payloads match what the React frontend forms actually send.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

// ─── SQLite bindings check ──────────────────────────────────────────────────

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available — skip all tests
}

// ─── Schema SQL ─────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE account (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
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
    onlineId TEXT,
    name TEXT,
    currency TEXT DEFAULT 'EUR',
    targetCurrency TEXT,
    note TEXT,
    isin TEXT,
    tickerSymbol TEXT,
    calendar TEXT,
    wkn TEXT,
    feedTickerSymbol TEXT,
    feed TEXT,
    feedURL TEXT,
    latestFeed TEXT,
    latestFeedURL TEXT,
    isRetired INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL DEFAULT ''
  );
  CREATE UNIQUE INDEX security__uuid ON security(uuid);

  CREATE TABLE security_attr (
    security TEXT NOT NULL,
    attr_uuid TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'string',
    value TEXT,
    seq INTEGER DEFAULT 0
  );
  CREATE UNIQUE INDEX security_attr__pk ON security_attr(security, attr_uuid);

  CREATE TABLE security_prop (
    security TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT,
    seq INTEGER DEFAULT 0
  );

  CREATE TABLE security_event (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    security TEXT NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    details TEXT
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

  CREATE TABLE taxonomy (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL,
    name TEXT NOT NULL,
    root TEXT NOT NULL
  );

  CREATE TABLE taxonomy_category (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL,
    taxonomy TEXT NOT NULL,
    parent TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    weight INTEGER NOT NULL,
    rank INTEGER NOT NULL
  );

  CREATE TABLE taxonomy_assignment (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    taxonomy TEXT NOT NULL,
    category TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item TEXT NOT NULL,
    weight INTEGER NOT NULL DEFAULT 10000,
    rank INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE taxonomy_data (
    taxonomy TEXT NOT NULL,
    category TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL
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

// ─── Helpers ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(CREATE_TABLES_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

const SEC_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function insertTestSecurity(sqlite: Database.Database, uuid = SEC_UUID) {
  sqlite.prepare(
    "INSERT INTO security (uuid, name, currency, updatedAt) VALUES (?, 'Test Security', 'EUR', ?)",
  ).run(uuid, new Date().toISOString());
}

// ─── CONTRACT-1: POST /api/transactions (BUY) ──────────────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-1: POST /api/transactions (BUY)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = secRes.body.id as string;

    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('returns 201 and creates dual xact rows', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY',
        date: '2024-06-15',
        amount: 1000,
        shares: 10,
        fees: 5.50,
        taxes: 2.25,
        securityId: SEC_UUID,
        accountId: portfolioId,
        currencyCode: 'EUR',
      });

    expect(res.status).toBe(201);
    expect(res.body.uuid).toBeDefined();

    // Two xact rows for BUY: securities-side (shares > 0) + cash-side (shares = 0)
    const rows = sqlite.prepare("SELECT * FROM xact WHERE type = 'BUY'").all() as Row[];
    expect(rows).toHaveLength(2);

    const secSide = rows.find(r => (r.shares as number) > 0)!;
    const cashSide = rows.find(r => (r.shares as number) === 0)!;
    expect(secSide).toBeDefined();
    expect(cashSide).toBeDefined();

    // Securities-side: account = portfolio
    expect(secSide.account).toBe(portfolioId);
    // Cash-side: account = deposit (referenceAccount)
    expect(cashSide.account).toBe(depositId);
  });

  it('stores security UUID on both xact rows (D4 parity)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const rows = sqlite.prepare("SELECT security FROM xact WHERE type = 'BUY'").all() as Row[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.security).toBe(SEC_UUID);
    }
  });

  it('creates xact_cross_entry linking portfolio to deposit', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 500, shares: 5,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const ce = sqlite.prepare('SELECT * FROM xact_cross_entry').all() as Row[];
    expect(ce).toHaveLength(1);
    expect(ce[0].from_acc).toBe(portfolioId);
    expect(ce[0].to_acc).toBe(depositId);
    // to_xact must NOT be self-referential
    expect(ce[0].to_xact).not.toBe(ce[0].from_xact);
  });

  it('creates FEE and TAX xact_unit rows', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        fees: 15, taxes: 8, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);
    const txUuid = res.body.uuid as string;

    const units = sqlite.prepare('SELECT type, amount FROM xact_unit WHERE xact = ?').all(txUuid) as Row[];
    const types = units.map(u => u.type);
    expect(types).toContain('FEE');
    expect(types).toContain('TAX');

    const feeUnit = units.find(u => u.type === 'FEE')!;
    const taxUnit = units.find(u => u.type === 'TAX')!;
    // fees=15 → 15*100 = 1500 hecto-units; taxes=8 → 800
    expect(feeUnit.amount).toBe(1500);
    expect(taxUnit.amount).toBe(800);
  });

  it('stores amount/shares/fees/taxes as integers (no float drift)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 123.45, shares: 0.001,
        fees: 1.99, taxes: 0.51, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT amount, shares, fees, taxes FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    // All must be integers (no decimals in DB)
    expect(Number.isInteger(row.amount)).toBe(true);
    expect(Number.isInteger(row.shares)).toBe(true);
    expect(Number.isInteger(row.fees)).toBe(true);
    expect(Number.isInteger(row.taxes)).toBe(true);
  });

  it('amount follows BUY formula: net = gross + fees + taxes (all positive)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        fees: 15, taxes: 8, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT amount, fees, taxes FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    // gross=1000 → 100000 hecto; fees=15→1500; taxes=8→800; net = 100000+1500+800 = 102300
    expect(row.amount).toBe(102300);
    expect(row.fees).toBe(1500);
    expect(row.taxes).toBe(800);
    // All positive per sign convention
    expect((row.amount as number) > 0).toBe(true);
    expect((row.fees as number) >= 0).toBe(true);
    expect((row.taxes as number) >= 0).toBe(true);
  });
});

// ─── CONTRACT-2: POST /api/transactions (SELL) ─────────────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-2: POST /api/transactions (SELL)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = secRes.body.id as string;

    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('returns 201 and creates dual xact rows for SELL', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'SELL', date: '2024-07-20', amount: 2000, shares: 20,
        fees: 10, taxes: 5, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const rows = sqlite.prepare("SELECT * FROM xact WHERE type = 'SELL'").all() as Row[];
    expect(rows).toHaveLength(2);

    const secSide = rows.find(r => (r.shares as number) > 0)!;
    const cashSide = rows.find(r => (r.shares as number) === 0)!;
    expect(secSide.account).toBe(portfolioId);
    expect(cashSide.account).toBe(depositId);
  });

  it('SELL amount follows inflow formula: net = gross - fees - taxes (all positive)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'SELL', date: '2024-07-20', amount: 2000, shares: 20,
        fees: 10, taxes: 5, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT amount, fees, taxes FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    // gross=2000→200000; fees=10→1000; taxes=5→500; net = 200000-1000-500 = 198500
    expect(row.amount).toBe(198500);
    expect(row.fees).toBe(1000);
    expect(row.taxes).toBe(500);
    // All positive per sign convention
    expect((row.amount as number) > 0).toBe(true);
  });

  it('SELL cross-entry exists and is not self-referential', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'SELL', date: '2024-07-20', amount: 2000, shares: 20,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const ce = sqlite.prepare('SELECT * FROM xact_cross_entry').all() as Row[];
    expect(ce).toHaveLength(1);
    expect(ce[0].from_xact).not.toBe(ce[0].to_xact);
  });

  it('SELL shares stored as positive integer ×10^8', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'SELL', date: '2024-07-20', amount: 500, shares: 3.5,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT shares FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    // 3.5 × 10^8 = 350000000
    expect(row.shares).toBe(350000000);
    expect((row.shares as number) > 0).toBe(true);
  });
});

// ─── CONTRACT-3: POST /api/transactions (DEPOSIT) ──────────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-3: POST /api/transactions (DEPOSIT)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = secRes.body.id as string;
  });

  afterEach(() => { sqlite.close(); });

  it('creates single xact row, no cross entry', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'DEPOSIT', date: '2024-03-01', amount: 5000, accountId: depositId, currencyCode: 'EUR' });

    expect(res.status).toBe(201);

    const rows = sqlite.prepare('SELECT * FROM xact').all() as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('DEPOSIT');
    expect(rows[0].account).toBe(depositId);
    expect(rows[0].shares).toBe(0);

    const ce = sqlite.prepare('SELECT * FROM xact_cross_entry').all();
    expect(ce).toHaveLength(0);
  });

  it('routes portfolio accountId to deposit (referenceAccount)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'DEPOSIT', date: '2024-03-01', amount: 5000, accountId: portfolioId, currencyCode: 'EUR' });

    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT account FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    // Must be routed to deposit, NOT stored against portfolio
    expect(row.account).toBe(depositId);
  });

  it('DEPOSIT amount stored as positive hecto-units', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'DEPOSIT', date: '2024-03-01', amount: 1234.56, accountId: depositId, currencyCode: 'EUR' });

    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT amount, shares, fees, taxes FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    // 1234.56 × 100 = 123456
    expect(row.amount).toBe(123456);
    expect(row.shares).toBe(0);
    expect(row.fees).toBe(0);
    expect(row.taxes).toBe(0);
  });
});

// ─── CONTRACT-4: POST /api/transactions (DIVIDEND with security) ────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-4: POST /api/transactions (DIVIDEND)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = secRes.body.id as string;

    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('creates DIVIDEND with security UUID populated', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DIVIDEND', date: '2024-09-15', amount: 50, taxes: 12.50,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });

    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT * FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    expect(row.security).toBe(SEC_UUID);
    // Type stored as "DIVIDENDS" in DB (ppxml2db convention)
    expect(row.type).toBe('DIVIDENDS');
    // Routed to deposit account
    expect(row.account).toBe(depositId);
    // No cross entry for cash-only type
    const ce = sqlite.prepare('SELECT * FROM xact_cross_entry').all();
    expect(ce).toHaveLength(0);
  });

  it('DIVIDEND net amount = gross - fees - taxes', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DIVIDEND', date: '2024-09-15', amount: 100, taxes: 26.38,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT amount, taxes FROM xact WHERE uuid = ?')
      .get(res.body.uuid as string) as Row;
    // gross=100→10000; taxes=26.38→2638; net = 10000 - 2638 = 7362
    expect(row.amount).toBe(7362);
    expect(row.taxes).toBe(2638);
  });

  it('DIVIDEND creates TAX xact_unit when taxes > 0', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DIVIDEND', date: '2024-09-15', amount: 100, taxes: 26,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const units = sqlite.prepare('SELECT type, amount FROM xact_unit WHERE xact = ?')
      .all(res.body.uuid as string) as Row[];
    const taxUnit = units.find(u => u.type === 'TAX');
    expect(taxUnit).toBeDefined();
    expect(taxUnit!.amount).toBe(2600);
  });
});

// ─── CONTRACT-5: PUT /api/transactions/:id (update BUY) ────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-5: PUT /api/transactions/:id (update BUY)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = secRes.body.id as string;

    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('updates BUY amount — both xact rows reflect new amount', async () => {
    // Create
    const createRes = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        fees: 5, taxes: 2, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(createRes.status).toBe(201);
    const txId = createRes.body.uuid as string;

    // Update with new amount
    const updateRes = await request(app)
      .put(`/api/transactions/${txId}`)
      .send({
        type: 'BUY', date: '2024-06-15', amount: 2000, shares: 10,
        fees: 5, taxes: 2, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(updateRes.status).toBe(200);

    // Both rows should have updated amount: 2000 + 5 + 2 = 2007 → 200700
    const rows = sqlite.prepare("SELECT amount FROM xact WHERE type = 'BUY'").all() as Row[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.amount).toBe(200700);
    }
  });

  it('xact_unit rows are refreshed after update (no orphans)', async () => {
    // Create with fees=15, taxes=8
    const createRes = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        fees: 15, taxes: 8, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(createRes.status).toBe(201);
    const txId = createRes.body.uuid as string;

    // Update with fees=20, taxes=0
    await request(app)
      .put(`/api/transactions/${txId}`)
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        fees: 20, taxes: 0, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });

    const units = sqlite.prepare('SELECT type, amount FROM xact_unit WHERE xact = ?').all(txId) as Row[];
    const types = units.map(u => u.type);
    // FEE should be updated to 2000
    const feeUnit = units.find(u => u.type === 'FEE');
    expect(feeUnit).toBeDefined();
    expect(feeUnit!.amount).toBe(2000);
    // TAX should be gone (taxes=0)
    expect(types).not.toContain('TAX');
  });

  it('returns 404 for non-existent transaction', async () => {
    const res = await request(app)
      .put('/api/transactions/00000000-0000-0000-0000-000000000000')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ─── CONTRACT-6: DELETE /api/transactions/:id (BUY) ─────────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-6: DELETE /api/transactions/:id (BUY)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = secRes.body.id as string;

    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('deletes both xact rows, cross entry, and xact_units', async () => {
    // Create BUY
    const createRes = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        fees: 5, taxes: 2, securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(createRes.status).toBe(201);
    const txId = createRes.body.uuid as string;

    // Verify setup: 2 xact rows, 1 cross entry, units exist
    expect(sqlite.prepare('SELECT COUNT(*) as c FROM xact').get()).toEqual({ c: 2 });
    expect(sqlite.prepare('SELECT COUNT(*) as c FROM xact_cross_entry').get()).toEqual({ c: 1 });

    // Delete
    const delRes = await request(app).delete(`/api/transactions/${txId}`);
    expect(delRes.status).toBe(204);

    // Everything gone
    expect(sqlite.prepare('SELECT COUNT(*) as c FROM xact').get()).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) as c FROM xact_cross_entry').get()).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) as c FROM xact_unit').get()).toEqual({ c: 0 });
  });

  it('returns 404 for non-existent transaction', async () => {
    const res = await request(app).delete('/api/transactions/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ─── CONTRACT-7: POST /api/securities (create) ─────────────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-7: POST /api/securities (create)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('creates security with AddInstrumentDialog payload shape', async () => {
    // Matches what AddInstrumentDialog sends
    const res = await request(app)
      .post('/api/securities')
      .send({
        name: 'Apple Inc.',
        ticker: 'AAPL',
        currency: 'USD',
        feed: 'YAHOO',
        latestFeed: 'YAHOO',
        feedTickerSymbol: 'AAPL',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Apple Inc.');

    // Verify raw DB
    const row = sqlite.prepare('SELECT * FROM security WHERE uuid = ?')
      .get(res.body.id) as Row;
    expect(row.name).toBe('Apple Inc.');
    expect(row.tickerSymbol).toBe('AAPL');
    expect(row.currency).toBe('USD');
    expect(row.feed).toBe('YAHOO');
    expect(row.latestFeed).toBe('YAHOO');
    expect(row.feedTickerSymbol).toBe('AAPL');
    expect(row.isRetired).toBe(0);
    expect(row.updatedAt).toBeTruthy();
  });

  it('creates security with all optional fields', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({
        name: 'Test ETF',
        isin: 'IE00B4L5Y983',
        ticker: 'IWDA',
        wkn: 'A0RPWH',
        currency: 'EUR',
        note: 'iShares Core MSCI World',
        feed: 'YAHOO',
        feedTickerSymbol: 'IWDA.AS',
        onlineId: 'IWDA.AS',
        calendar: 'XAMS',
      });

    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT * FROM security WHERE uuid = ?')
      .get(res.body.id) as Row;
    expect(row.isin).toBe('IE00B4L5Y983');
    expect(row.wkn).toBe('A0RPWH');
    expect(row.note).toBe('iShares Core MSCI World');
    expect(row.onlineId).toBe('IWDA.AS');
    expect(row.calendar).toBe('XAMS');
  });
});

// ─── CONTRACT-8: PUT /api/securities/:id (partial update) ──────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-8: PUT /api/securities/:id (update)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('partial update preserves non-updated columns', async () => {
    // Create
    const createRes = await request(app)
      .post('/api/securities')
      .send({
        name: 'Original Name',
        ticker: 'ORIG',
        currency: 'EUR',
        isin: 'DE0001234567',
        note: 'Original note',
      });
    expect(createRes.status).toBe(201);
    const secId = createRes.body.id as string;

    // Update only name
    const updateRes = await request(app)
      .put(`/api/securities/${secId}`)
      .send({ name: 'Updated Name' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.name).toBe('Updated Name');

    // Non-updated fields preserved in raw DB
    const row = sqlite.prepare('SELECT * FROM security WHERE uuid = ?').get(secId) as Row;
    expect(row.name).toBe('Updated Name');
    expect(row.tickerSymbol).toBe('ORIG');
    expect(row.isin).toBe('DE0001234567');
    expect(row.note).toBe('Original note');
    expect(row.currency).toBe('EUR');
  });

  it('returns 404 for non-existent security', async () => {
    const res = await request(app)
      .put('/api/securities/00000000-0000-0000-0000-000000000000')
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ─── CONTRACT-9: POST /api/taxonomies (with template) ──────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-9: POST /api/taxonomies (with template)', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('creates taxonomy with asset-classes template', async () => {
    // Matches CreateTaxonomyDialog payload
    const res = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'My Asset Classes', template: 'asset-classes' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('My Asset Classes');

    // Verify taxonomy row
    const taxRow = sqlite.prepare('SELECT * FROM taxonomy WHERE uuid = ?')
      .get(res.body.id) as Row;
    expect(taxRow).toBeDefined();
    expect(taxRow.name).toBe('My Asset Classes');
    expect(taxRow.root).toBeTruthy(); // root category UUID

    // Verify categories were created from template
    const categories = sqlite.prepare('SELECT * FROM taxonomy_category WHERE taxonomy = ?')
      .all(res.body.id) as Row[];
    // Template should have produced multiple categories
    expect(categories.length).toBeGreaterThan(1);

    // Root category has weight 10000 (ppxml2db parity)
    const rootCat = categories.find(c => c.uuid === taxRow.root);
    expect(rootCat).toBeDefined();
    expect(rootCat!.weight).toBe(10000);
  });

  it('creates taxonomy without template (empty)', async () => {
    const res = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Custom Taxonomy' });

    expect(res.status).toBe(201);

    // Should have exactly 1 category: the root
    const categories = sqlite.prepare('SELECT * FROM taxonomy_category WHERE taxonomy = ?')
      .all(res.body.id) as Row[];
    expect(categories).toHaveLength(1);
    expect(categories[0].weight).toBe(10000);
  });
});

// ─── CONTRACT-10: Zod rejection tests ──────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-10: Zod rejection tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);

    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    portfolioId = secRes.body.id as string;

    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('BUY with shares=0 → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 0,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('BUY with missing accountId → 400 (accountId is required — xact.account NOT NULL)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10, securityId: SEC_UUID });
    expect(res.status).toBe(400);
  });

  it('BUY with negative shares → 400 (positive() constraint)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: -5,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details).toBeDefined();
  });

  it('TRANSFER_BETWEEN_ACCOUNTS without crossAccountId → 400 or completes without crash', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'TRANSFER_BETWEEN_ACCOUNTS', date: '2024-06-15', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    // crossAccountId is optional in Zod schema — so service may error or handle it
    // The key assertion: server must not crash (5xx)
    expect(res.status).toBeLessThan(500);
  });

  it('negative amount → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2024-06-15', amount: -100,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details).toBeDefined();
  });

  it('non-UUID securityId → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: 'not-a-uuid', accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.arrayContaining(['securityId']) }),
      ]),
    );
  });

  it('invalid date format → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '15/06/2024', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('missing required type field → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ date: '2024-06-15', amount: 500, accountId: depositId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('invalid transaction type → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({ type: 'NONEXISTENT', date: '2024-06-15', amount: 500, accountId: depositId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('taxonomy name too long (>100 chars) → 400', async () => {
    const res = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'A'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('security with empty name → 400', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: '', currency: 'EUR' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('security with invalid currency length → 400', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Test', currency: 'EURO' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });
});

// ─── CONTRACT-11: Content-Type enforcement ──────────────────────────────────

describe.skipIf(!hasSqliteBindings)('CONTRACT-11: Content-Type enforcement', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('text/plain Content-Type → error (not 2xx)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Content-Type', 'text/plain')
      .send('{"type":"DEPOSIT","date":"2024-01-01","amount":100}');
    // Express JSON middleware won't parse text/plain → req.body is undefined → Zod fails
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('no body → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Content-Type', 'application/json')
      .send('');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('malformed JSON → 400', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Content-Type', 'application/json')
      .send('{invalid json}');
    expect(res.status).toBe(400);
  });
});
