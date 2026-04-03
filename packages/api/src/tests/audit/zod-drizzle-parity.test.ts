/**
 * Zod ↔ Drizzle ↔ Vendor DDL Parity Tests
 *
 * Verifies structural consistency between the API input validation layer (Zod),
 * the database storage layer (Drizzle + SQLite), and the ppxml2db vendor DDL.
 *
 * Groups:
 *   A — Nullability boundary tests
 *   B — Type conversion boundary tests
 *   C — Enum consistency tests
 *   D — Empty string vs NULL tests
 *   E — Foreign key integrity tests
 *   F — Date format tests
 *   G — Numeric range boundary tests
 *   H — Partial update safety tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';
import {
  createTransactionSchema,
  createAccountSchema,
  createSecuritySchema,
  createSecurityEventSchema,
  createCategorySchema,
  createAssignmentSchema,
} from '@quovibe/shared';

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
    name TEXT,
    type TEXT NOT NULL,
    currency TEXT,
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

  CREATE TABLE attribute_type (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    columnLabel TEXT NOT NULL,
    source TEXT,
    target TEXT NOT NULL,
    converterClass TEXT NOT NULL,
    props_json TEXT
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
    account TEXT NOT NULL,
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
    to_xact TEXT NOT NULL,
    to_acc TEXT NOT NULL,
    type TEXT NOT NULL
  );

  CREATE TABLE xact_unit (
    xact TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT,
    forex_amount INTEGER,
    forex_currency TEXT,
    exchangeRate TEXT
  );

  CREATE TABLE taxonomy (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    root TEXT NOT NULL
  );

  CREATE TABLE taxonomy_category (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
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

  CREATE TABLE watchlist (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    _order INTEGER NOT NULL
  );

  CREATE TABLE watchlist_security (
    list INTEGER NOT NULL,
    security TEXT NOT NULL
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

function setupAccounts(app: ReturnType<typeof createApp>) {
  return async () => {
    const depRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Cash', type: 'DEPOSIT', currency: 'EUR' });
    const depositId = depRes.body.id as string;

    const secRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Portfolio', type: 'SECURITIES', currency: 'EUR', referenceAccountId: depositId });
    const portfolioId = secRes.body.id as string;

    return { depositId, portfolioId };
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP A — Nullability boundary tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP A — Nullability boundary tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
    const ids = await setupAccounts(app)();
    depositId = ids.depositId;
    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('Z1.1 — BUY without accountId → 400 (xact.account NOT NULL, no DEFAULT)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: SEC_UUID, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z1.2 — DEPOSIT with omitted fees/taxes → stored as 0 (DEFAULT 0)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2024-06-15', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT fees, taxes FROM xact WHERE uuid = ?').get(res.body.uuid) as Row;
    expect(row.fees).toBe(0);
    expect(row.taxes).toBe(0);
  });

  it('Z1.3 — DEPOSIT with omitted currencyCode → defaults to EUR', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2024-06-15', amount: 500,
        accountId: depositId,
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT currency FROM xact WHERE uuid = ?').get(res.body.uuid) as Row;
    expect(row.currency).toBe('EUR');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP B — Type conversion boundary tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP B — Type conversion boundary tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
    const ids = await setupAccounts(app)();
    depositId = ids.depositId;
    portfolioId = ids.portfolioId;
    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('Z2.1 — DEPOSIT amount=15.50 → DB stores 1550 (hecto-units)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2024-06-15', amount: 15.50,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT amount FROM xact WHERE uuid = ?').get(res.body.uuid) as Row;
    expect(row.amount).toBe(1550);
  });

  it('Z2.2 — BUY shares=1.5, fees=5.50, taxes=2.25 → correct DB conversions', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 1.5,
        fees: 5.50, taxes: 2.25,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT shares, fees, taxes, amount FROM xact WHERE uuid = ? AND shares > 0').get(res.body.uuid) as Row;
    // shares: 1.5 × 10^8 = 150000000
    expect(row.shares).toBe(150000000);
    // fees: 5.50 × 100 = 550
    expect(row.fees).toBe(550);
    // taxes: 2.25 × 100 = 225
    expect(row.taxes).toBe(225);
    // amount: computeNetAmountDb(BUY, 1000, 5.50, 2.25) = (1000 + 5.50 + 2.25) × 100 = 100775
    expect(row.amount).toBe(100775);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP C — Enum consistency tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP C — Enum consistency tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
    const ids = await setupAccounts(app)();
    depositId = ids.depositId;
    portfolioId = ids.portfolioId;
    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('Z3.1 — transaction type=buy (lowercase) → rejected by Zod', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'buy', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z3.2 — transaction type=INVALID_TYPE → rejected by Zod', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'INVALID_TYPE', date: '2024-06-15', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z3.3 — account create type DEPOSIT → stored as "account" in DB', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .send({ name: 'Test Deposit', type: 'DEPOSIT', currency: 'EUR' });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT type FROM account WHERE uuid = ?').get(res.body.id) as Row;
    expect(row.type).toBe('account');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP D — Empty string vs NULL tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP D — Empty string vs NULL tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
    const ids = await setupAccounts(app)();
    depositId = ids.depositId;
    portfolioId = ids.portfolioId;
    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('Z4.1 — DEPOSIT with note="" → stored as "" or NULL (document behavior)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2024-06-15', amount: 500, note: '',
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT note FROM xact WHERE uuid = ?').get(res.body.uuid) as Row;
    // Service does `input.note ?? null` — '' is truthy so it stays as ''
    // ppxml2db stores NULL for absent notes. This is a known DIVERGENCE.
    expect(row.note === '' || row.note === null).toBe(true);
  });

  it('Z4.2 — BUY with securityId="" → rejected by Zod (.uuid() validation)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: '', accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z4.3 — security with isin="" → stored as "" (ppxml2db stores NULL)', async () => {
    const res = await request(app)
      .post('/api/securities')
      .send({ name: 'Test', currency: 'EUR', isin: '' });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT isin FROM security WHERE uuid = ?').get(res.body.id) as Row;
    // isin: '' is a valid string in Zod — service does `input.isin ?? null` → '' stays as ''
    // DIVERGENCE: ppxml2db stores NULL for absent ISIN
    expect(row.isin === '' || row.isin === null).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP E — Foreign key integrity tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP E — Foreign key integrity tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
    const ids = await setupAccounts(app)();
    portfolioId = ids.portfolioId;
    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('Z5.1 — BUY with non-existent accountId → not a Zod error but service/DB error', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: SEC_UUID, accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        currencyCode: 'EUR',
      });
    // With foreign_keys OFF, this may succeed (writes orphaned FK)
    // With foreign_keys ON, this would be a SQLite FK violation
    // Either way, it should not be a 500 unhandled error
    expect([201, 400, 404, 422]).toContain(res.status);
  });

  it('Z5.2 — BUY with malformed securityId → rejected by Zod (.uuid())', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
        securityId: 'not-a-uuid', accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z5.3 — taxonomy assignment with non-existent categoryId → rejected by service', async () => {
    // Create a taxonomy first
    const taxRes = await request(app)
      .post('/api/taxonomies')
      .send({ name: 'Test Taxonomy' });
    expect(taxRes.status).toBe(201);
    const taxonomyId = taxRes.body.id as string;

    const res = await request(app)
      .post(`/api/taxonomies/${taxonomyId}/assignments`)
      .send({
        itemId: SEC_UUID,
        itemType: 'security',
        categoryId: 'nonexistent-category-uuid',
      });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP F — Date format tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP F — Date format tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
    const ids = await setupAccounts(app)();
    depositId = ids.depositId;
  });

  afterEach(() => { sqlite.close(); });

  it('Z6.1 — date=2026-03-27 → accepted and stored as-is', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2026-03-27', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(201);

    const row = sqlite.prepare('SELECT date FROM xact WHERE uuid = ?').get(res.body.uuid) as Row;
    expect(row.date).toBe('2026-03-27');
  });

  it('Z6.2 — date=2026-03-27T14:30:00Z (ISO timestamp) → rejected by Zod', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2026-03-27T14:30:00Z', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z6.3 — date=27/03/2026 (DD/MM/YYYY) → rejected by Zod', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '27/03/2026', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z6.4 — date=not-a-date → rejected by Zod', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: 'not-a-date', amount: 500,
        accountId: depositId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP G — Numeric range boundary tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP G — Numeric range boundary tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;
  let depositId: string;
  let portfolioId: string;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
    const ids = await setupAccounts(app)();
    depositId = ids.depositId;
    portfolioId = ids.portfolioId;
    insertTestSecurity(sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('Z7.1 — BUY with shares=0 → rejected by superRefine', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: 0,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z7.2 — BUY with shares=-5 → rejected by positive() + superRefine', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'BUY', date: '2024-06-15', amount: 1000, shares: -5,
        securityId: SEC_UUID, accountId: portfolioId, currencyCode: 'EUR',
      });
    expect(res.status).toBe(400);
  });

  it('Z7.3 — DEPOSIT with amount=0 → rejected (cash types require amount > 0)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        type: 'DEPOSIT', date: '2024-06-15', amount: 0,
        accountId: depositId, currencyCode: 'EUR',
      });
    // amount=0 is now rejected for cash-type transactions
    expect(res.status).toBe(400);
  });

  it('Z7.4 — taxonomy assignment with weight=10001 → rejected by Zod', async () => {
    const result = createAssignmentSchema.safeParse({
      itemId: SEC_UUID,
      itemType: 'security',
      categoryId: 'some-cat-id',
      weight: 10001,
    });
    expect(result.success).toBe(false);
  });

  it('Z7.5 — taxonomy assignment with weight=-1 → rejected by Zod', async () => {
    const result = createAssignmentSchema.safeParse({
      itemId: SEC_UUID,
      itemType: 'security',
      categoryId: 'some-cat-id',
      weight: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// GROUP H — Partial update safety tests
// ═════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqliteBindings)('GROUP H — Partial update safety tests', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    const t = createTestDb();
    sqlite = t.sqlite;
    app = createApp(t.db as Parameters<typeof createApp>[0], sqlite);
  });

  afterEach(() => { sqlite.close(); });

  it('Z8.1 — security partial update preserves unmentioned fields', async () => {
    // Create security with all fields
    const createRes = await request(app)
      .post('/api/securities')
      .send({
        name: 'Full Security', currency: 'USD', isin: 'US0378331005',
        ticker: 'AAPL', wkn: '865985', note: 'A note',
        calendar: 'nyse',
      });
    expect(createRes.status).toBe(201);
    const id = createRes.body.id as string;

    // Partial update: only change name
    const updateRes = await request(app)
      .put(`/api/securities/${id}`)
      .send({ name: 'Renamed Security' });
    expect(updateRes.status).toBe(200);

    // Verify all other fields preserved
    const row = sqlite.prepare(
      'SELECT name, isin, tickerSymbol, wkn, currency, note, calendar FROM security WHERE uuid = ?',
    ).get(id) as Row;
    expect(row.name).toBe('Renamed Security');
    expect(row.isin).toBe('US0378331005');
    expect(row.tickerSymbol).toBe('AAPL');
    expect(row.wkn).toBe('865985');
    expect(row.currency).toBe('USD');
    expect(row.note).toBe('A note');
    expect(row.calendar).toBe('nyse');
  });

  it('Z8.2 — account partial update preserves unmentioned fields', async () => {
    // Create account
    const createRes = await request(app)
      .post('/api/accounts')
      .send({ name: 'Original Name', type: 'DEPOSIT', currency: 'USD' });
    expect(createRes.status).toBe(201);
    const id = createRes.body.id as string;

    // Partial update: only change name
    const updateRes = await request(app)
      .put(`/api/accounts/${id}`)
      .send({ name: 'New Name' });
    expect(updateRes.status).toBe(200);

    // Verify currency preserved
    const row = sqlite.prepare('SELECT name, currency, type FROM account WHERE uuid = ?').get(id) as Row;
    expect(row.name).toBe('New Name');
    expect(row.currency).toBe('USD');
    expect(row.type).toBe('account');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Zod schema-level validation tests (no HTTP needed)
// ═════════════════════════════════════════════════════════════════════════════

describe('Zod schema validation — transaction', () => {
  it('accountId is required (not optional)', () => {
    const result = createTransactionSchema.safeParse({
      type: 'DEPOSIT', date: '2024-06-15', amount: 500,
      // accountId intentionally omitted
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const accountIdIssue = result.error.issues.find(i => i.path.includes('accountId'));
      expect(accountIdIssue).toBeDefined();
    }
  });

  it('date accepts YYYY-MM-DD and YYYY-MM-DDTHH:mm formats', () => {
    const base = { type: 'DEPOSIT' as const, amount: 500, accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };

    // Valid date-only
    expect(createTransactionSchema.safeParse({ ...base, date: '2024-06-15' }).success).toBe(true);

    // Valid datetime (HH:mm)
    expect(createTransactionSchema.safeParse({ ...base, date: '2024-06-15T10:30' }).success).toBe(true);

    // Timestamps with seconds or timezone rejected
    expect(createTransactionSchema.safeParse({ ...base, date: '2024-06-15T14:30:00Z' }).success).toBe(false);

    // Other formats rejected
    expect(createTransactionSchema.safeParse({ ...base, date: '15/06/2024' }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...base, date: 'not-a-date' }).success).toBe(false);
  });

  it('amount must be >= 0 (negative rejected)', () => {
    const result = createTransactionSchema.safeParse({
      type: 'DEPOSIT', date: '2024-06-15', amount: -100,
      accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(result.success).toBe(false);
  });

  it('securityId must be valid UUID if provided', () => {
    const result = createTransactionSchema.safeParse({
      type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
      securityId: 'not-a-uuid',
      accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(result.success).toBe(false);
  });

  it('empty string securityId rejected by .uuid()', () => {
    const result = createTransactionSchema.safeParse({
      type: 'BUY', date: '2024-06-15', amount: 1000, shares: 10,
      securityId: '',
      accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(result.success).toBe(false);
  });
});

describe('Zod schema validation — account', () => {
  it('name is required and must be non-empty', () => {
    expect(createAccountSchema.safeParse({ name: '', type: 'DEPOSIT' }).success).toBe(false);
    expect(createAccountSchema.safeParse({ type: 'DEPOSIT' }).success).toBe(false);
  });

  it('type must be DEPOSIT or SECURITIES (not lowercase)', () => {
    expect(createAccountSchema.safeParse({ name: 'X', type: 'deposit' }).success).toBe(false);
    expect(createAccountSchema.safeParse({ name: 'X', type: 'portfolio' }).success).toBe(false);
    expect(createAccountSchema.safeParse({ name: 'X', type: 'DEPOSIT' }).success).toBe(true);
    expect(createAccountSchema.safeParse({ name: 'X', type: 'SECURITIES' }).success).toBe(true);
  });
});

describe('Zod schema validation — security', () => {
  it('name is required and must be non-empty', () => {
    expect(createSecuritySchema.safeParse({ name: '' }).success).toBe(false);
    expect(createSecuritySchema.safeParse({}).success).toBe(false);
  });

  it('currency defaults to EUR', () => {
    const result = createSecuritySchema.safeParse({ name: 'Test' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('EUR');
    }
  });

  it('feedUrl must be valid URL if provided', () => {
    expect(createSecuritySchema.safeParse({ name: 'X', feedUrl: 'not-a-url' }).success).toBe(false);
    expect(createSecuritySchema.safeParse({ name: 'X', feedUrl: 'https://example.com' }).success).toBe(true);
  });
});

describe('Zod schema validation — security event', () => {
  it('date must be strict YYYY-MM-DD', () => {
    const base = { securityId: SEC_UUID, type: 'STOCK_SPLIT' as const, details: '{}' };
    expect(createSecurityEventSchema.safeParse({ ...base, date: '2024-06-15' }).success).toBe(true);
    expect(createSecurityEventSchema.safeParse({ ...base, date: '2024-06-15T10:30' }).success).toBe(false);
    expect(createSecurityEventSchema.safeParse({ ...base, date: '15/06/2024' }).success).toBe(false);
  });

  it('type must be valid SecurityEventType', () => {
    const base = { securityId: SEC_UUID, date: '2024-06-15', details: '{}' };
    expect(createSecurityEventSchema.safeParse({ ...base, type: 'STOCK_SPLIT' }).success).toBe(true);
    expect(createSecurityEventSchema.safeParse({ ...base, type: 'INVALID' }).success).toBe(false);
  });
});

describe('Zod schema validation — taxonomy', () => {
  it('category color is optional (service defaults to palette color)', () => {
    const result = createCategorySchema.safeParse({
      name: 'Test', parentId: 'some-id',
    });
    expect(result.success).toBe(true);
  });

  it('assignment weight must be 0-10000', () => {
    const base = { itemId: 'x', itemType: 'security' as const, categoryId: 'y' };
    expect(createAssignmentSchema.safeParse({ ...base, weight: 0 }).success).toBe(true);
    expect(createAssignmentSchema.safeParse({ ...base, weight: 10000 }).success).toBe(true);
    expect(createAssignmentSchema.safeParse({ ...base, weight: 10001 }).success).toBe(false);
    expect(createAssignmentSchema.safeParse({ ...base, weight: -1 }).success).toBe(false);
    expect(createAssignmentSchema.safeParse({ ...base, weight: 5000.5 }).success).toBe(false);
  });
});
