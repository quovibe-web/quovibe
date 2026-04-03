import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

// ─── Test DB setup ────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');

  sqlite.exec(`
    CREATE TABLE account (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT,
      currency TEXT DEFAULT 'EUR',
      isRetired INTEGER DEFAULT 0,
      referenceAccount TEXT,
      updatedAt TEXT,
      note TEXT,
      _xmlid INTEGER,
      _order INTEGER
    );
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
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
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const SEC_ID = 'sec-001';
const ACCT_ID = 'acct-001';
const PERIOD_START = '2024-01-01';
const PERIOD_END = '2024-12-31';

function seedData(sqlite: Database.Database) {
  // Security
  sqlite
    .prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
    .run(SEC_ID, 'Test Corp', 'EUR');

  // Deposit account
  sqlite
    .prepare(
      `INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`,
    )
    .run(ACCT_ID, 'Cash', 'DEPOSIT', 'EUR');

  // BUY transaction: 10 shares at 100 EUR each (gross = 1000, fee = 10, total = 1010)
  // shares stored in ppxml2db units: 10 * 1e8 = 1000000000
  // amounts stored in hecto-units (× 100): 1010 EUR → 101000, 1000 EUR → 100000, 10 EUR → 1000
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'xact-buy-001', 'BUY', '2024-02-01', 'EUR', 1010 * 100, 10 * 1e8, SEC_ID, ACCT_ID,
  );
  sqlite.prepare(`INSERT INTO xact_unit (xact, type, amount) VALUES (?, ?, ?)`).run(
    'xact-buy-001', 'FEE', 10 * 100,
  );

  // DIVIDEND transaction: 50 EUR (amount in hecto-units: 50 * 100 = 5000)
  // ppxml2db uses 'DIVIDENDS' (plural) for the type
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'xact-div-001', 'DIVIDENDS', '2024-06-15', 'EUR', 50 * 100, 10 * 1e8, SEC_ID, ACCT_ID,
  );
  // DEPOSIT transaction: 200 EUR to deposit account (amount in hecto-units: 200 * 100 = 20000)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, account)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    'xact-dep-001', 'DEPOSIT', '2024-03-01', 'EUR', 200 * 100, ACCT_ID,
  );
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc)
    VALUES (?, ?, ?, ?)`).run(
    'xact-dep-001', ACCT_ID, null, null,
  );

  // Prices: weekly close prices (stored as price * 1e8, ppxml2db convention)
  // Price at period start (for priceAtPeriodStart)
  sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(
    SEC_ID, '2023-12-29', 9_500_000_000, // 95.00 EUR (last trading day of 2023)
  );
  // In-period prices
  const priceData = [
    ['2024-01-05',  9_800_000_000], // 98.00
    ['2024-02-02', 10_200_000_000], // 102.00 (day after BUY)
    ['2024-03-01', 10_500_000_000], // 105.00
    ['2024-06-14', 11_000_000_000], // 110.00
    ['2024-09-30', 11_500_000_000], // 115.00
    ['2024-12-31', 12_000_000_000], // 120.00
  ];
  const insertPrice = sqlite.prepare(
    `INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`,
  );
  for (const [date, value] of priceData) {
    insertPrice.run(SEC_ID, date, value);
  }

  // Latest price: 120.00 EUR → stored as 12_000_000_000 (120 * 1e8)
  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`).run(
    SEC_ID, '2024-12-31', 12_000_000_000,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('GET /api/performance/calculation', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedData(sqlite);
  });

  it('returns all required fields with string amounts', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;

    // Required top-level fields
    expect(typeof body.initialValue).toBe('string');
    expect(typeof body.finalValue).toBe('string');
    expect(typeof body.ttwror).toBe('string');
    expect(typeof body.ttwrorPa).toBe('string');
    expect(typeof body.absoluteChange).toBe('string');
    expect(typeof body.delta).toBe('string');
    // fees, taxes, cashCurrencyGains are now breakdown objects
    const feesObj = body.fees as Record<string, unknown>;
    expect(typeof feesObj.total).toBe('string');
    expect(Array.isArray(feesObj.items)).toBe(true);
    const taxesObj = body.taxes as Record<string, unknown>;
    expect(typeof taxesObj.total).toBe('string');
    expect(Array.isArray(taxesObj.items)).toBe(true);
    const ccgObj = body.cashCurrencyGains as Record<string, unknown>;
    expect(typeof ccgObj.total).toBe('string');
    expect(Array.isArray(ccgObj.items)).toBe(true);
    expect(typeof body.performanceNeutralTransfers).toBe('object');
    const pntObj = body.performanceNeutralTransfers as Record<string, unknown>;
    expect(typeof pntObj.deposits).toBe('string');
    expect(typeof pntObj.removals).toBe('string');
    expect(typeof pntObj.deliveryInbound).toBe('string');
    expect(typeof pntObj.deliveryOutbound).toBe('string');
    expect(typeof pntObj.taxes).toBe('string');
    expect(typeof pntObj.total).toBe('string');
    expect(Array.isArray(pntObj.items)).toBe(true);
    expect(typeof body.irrConverged).toBe('boolean');

    // Nested objects
    const cg = body.capitalGains as Record<string, unknown>;
    expect(typeof cg.unrealized).toBe('string');
    expect(typeof cg.realized).toBe('string');
    expect(typeof cg.foreignCurrencyGains).toBe('string');
    expect(typeof cg.total).toBe('string');
    expect(Array.isArray(cg.items)).toBe(true);

    // realizedGains is a new top-level field
    const rg = body.realizedGains as Record<string, unknown>;
    expect(typeof rg.total).toBe('string');
    expect(Array.isArray(rg.items)).toBe(true);

    const earn = body.earnings as Record<string, unknown>;
    expect(typeof earn.dividends).toBe('string');
    expect(typeof earn.interest).toBe('string');
    expect(typeof earn.total).toBe('string');
    expect(Array.isArray(earn.dividendItems)).toBe(true);
  });

  it('preTax=true (default) → taxes = "0"', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}&preTax=true`);

    expect(res.status).toBe(200);
    expect(res.body.taxes.total).toBe('0');
    expect(res.body.taxes.items).toEqual([]);
  });

  it('returns dividends > 0 when dividends exist in period', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

    expect(res.status).toBe(200);
    const earnings = res.body.earnings as { dividends: string };
    expect(parseFloat(earnings.dividends)).toBeGreaterThan(0);
  });

  it('returns fees > 0 when fees exist in period', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

    expect(res.status).toBe(200);
    expect(parseFloat(res.body.fees.total)).toBeGreaterThan(0);
  });

  it('cashCurrencyGains = "0"', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

    expect(res.status).toBe(200);
    expect(res.body.cashCurrencyGains.total).toBe('0');
    expect(res.body.cashCurrencyGains.items).toEqual([]);
  });
});

// ─── Equation Balance: MVB + components ≈ MVE ──────────────────────────────
// The Calculation panel decomposes the portfolio change between MVB and MVE.
// Equation: MVB + capitalGains(unrealized+realized+fx) + earnings − fees − taxes
//           + cashCurrencyGains + PNT ≈ MVE
describe.skipIf(!hasSqliteBindings)('Calculation equation balance', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedDeltaData(sqlite);
  });

  for (const costMethod of ['FIFO', 'MOVING_AVERAGE'] as const) {
    for (const preTax of [true, false]) {
      it(`equation balances for costMethod=${costMethod}, preTax=${preTax}`, async () => {
        const res = await request(app)
          .get(`/api/performance/calculation?periodStart=${D_START}&periodEnd=${D_END}&costMethod=${costMethod}&preTax=${preTax}`);

        expect(res.status).toBe(200);
        const body = res.body as Record<string, string | Record<string, string>>;

        const initialValue = parseFloat(body.initialValue as string);
        const finalValue = parseFloat(body.finalValue as string);
        const cg = body.capitalGains as Record<string, string>;
        const unrealized = parseFloat(cg.unrealized);
        const realized = parseFloat(cg.realized);
        const fxGains = parseFloat(cg.foreignCurrencyGains);
        const earn = body.earnings as Record<string, string>;
        const earningsTotal = parseFloat(earn.total);
        const fees = parseFloat((body.fees as Record<string, string>).total);
        const taxes = parseFloat((body.taxes as Record<string, string>).total);
        const cashCurrencyGains = parseFloat((body.cashCurrencyGains as Record<string, string>).total);
        const pnt = body.performanceNeutralTransfers as Record<string, string>;
        const pntTotal = parseFloat(pnt.total);

        // MVB + capitalGains + earnings − fees − taxes + cashCurrencyGains + PNT ≈ MVE
        const computed = initialValue
          + unrealized + realized + fxGains
          + earningsTotal
          - fees - taxes
          + cashCurrencyGains
          + pntTotal;

        expect(computed).toBeCloseTo(finalValue, 1);
      });
    }
  }
});

describe.skipIf(!hasSqliteBindings)('GET /api/performance/securities', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedData(sqlite);
  });

  it('returns an array with per-security fields', async () => {
    const res = await request(app)
      .get(`/api/performance/securities?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const first = res.body[0] as Record<string, unknown>;
    expect(typeof first.securityId).toBe('string');
    expect(typeof first.ttwror).toBe('string');
    expect(typeof first.ttwrorPa).toBe('string');
    expect(typeof first.irr === 'string' || first.irr === null).toBe(true);
    expect(typeof first.irrConverged).toBe('boolean');
    expect(typeof first.mvb).toBe('string');
    expect(typeof first.mve).toBe('string');
    expect(typeof first.purchaseValue).toBe('string');
    expect(typeof first.realizedGain).toBe('string');
    expect(typeof first.unrealizedGain).toBe('string');
    expect(typeof first.fees).toBe('string');
    expect(typeof first.dividends).toBe('string');
  });

  it('security is the seeded security', async () => {
    const res = await request(app)
      .get(`/api/performance/securities?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ securityId: string }>).map((r) => r.securityId);
    expect(ids).toContain(SEC_ID);
  });
});

describe.skipIf(!hasSqliteBindings)('GET /api/performance/chart', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedData(sqlite);
  });

  it('returns array with required fields', async () => {
    const res = await request(app)
      .get(`/api/performance/chart?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}&interval=monthly`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const point = res.body[0] as Record<string, unknown>;
    expect(typeof point.date).toBe('string');
    expect(typeof point.marketValue).toBe('string');
    expect(typeof point.transfersAccumulated).toBe('string');
    expect(typeof point.ttwrorCumulative).toBe('string');
    expect(typeof point.delta).toBe('string');
  });

  it('monthly interval returns fewer points than daily', async () => {
    const [monthlyRes, dailyRes] = await Promise.all([
      request(app).get(
        `/api/performance/chart?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}&interval=monthly`,
      ),
      request(app).get(
        `/api/performance/chart?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}&interval=daily`,
      ),
    ]);

    expect(monthlyRes.status).toBe(200);
    expect(dailyRes.status).toBe(200);
    expect((monthlyRes.body as unknown[]).length).toBeLessThan(
      (dailyRes.body as unknown[]).length,
    );
  });
});

describe.skipIf(!hasSqliteBindings)('GET /api/reports/statement-of-assets', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedData(sqlite);
  });

  it('returns correct structure with securities and deposit accounts', async () => {
    const res = await request(app).get(
      `/api/reports/statement-of-assets?date=${PERIOD_END}`,
    );

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.date).toBe(PERIOD_END);
    expect(Array.isArray(body.securities)).toBe(true);
    expect(Array.isArray(body.depositAccounts)).toBe(true);

    const totals = body.totals as Record<string, unknown>;
    expect(typeof totals.marketValue).toBe('string');
    expect(typeof totals.securityValue).toBe('string');
    expect(typeof totals.cashValue).toBe('string');
  });

  it('security value = shares × price at date', async () => {
    const res = await request(app).get(
      `/api/reports/statement-of-assets?date=${PERIOD_END}`,
    );

    expect(res.status).toBe(200);
    const secs = res.body.securities as Array<{
      securityId: string;
      shares: string;
      pricePerShare: string;
      marketValue: string;
    }>;
    const sec = secs.find((s) => s.securityId === SEC_ID);
    expect(sec).toBeDefined();
    // 10 shares × 120.00 EUR = 1200 EUR
    expect(parseFloat(sec!.shares)).toBeCloseTo(10, 4);
    expect(parseFloat(sec!.pricePerShare)).toBeCloseTo(120, 2);
    expect(parseFloat(sec!.marketValue)).toBeCloseTo(1200, 2);
  });
});

describe.skipIf(!hasSqliteBindings)('GET /api/reports/payments', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedData(sqlite);
  });

  it('groups dividends by month', async () => {
    const res = await request(app).get(
      `/api/reports/payments?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}&groupBy=month`,
    );

    expect(res.status).toBe(200);
    const body = res.body as {
      totals: { dividendsGross: string; earningsGross: string };
      dividendGroups: Array<{ bucket: string; totalGross: string; count: number }>;
      combinedGroups: Array<{ bucket: string; totalGross: string; count: number }>;
    };
    expect(Array.isArray(body.dividendGroups)).toBe(true);
    expect(body.dividendGroups.length).toBeGreaterThan(0);

    const juneGroup = body.dividendGroups.find((g) => g.bucket === '2024-06');
    expect(juneGroup).toBeDefined();
    expect(parseFloat(juneGroup!.totalGross)).toBeCloseTo(50, 2);
    expect(juneGroup!.count).toBe(1);
  });
});

// ─── Delta & Absolute Change seed ────────────────────────────────────────────

const D_SEC_ID = 'sec-delta-001';
const D_PORT_ID = 'acct-portfolio-001';
const D_DEP_ID = 'acct-deposit-001';
const D_START = '2024-01-01';
const D_END = '2024-12-31';

function seedDeltaData(sqlite: Database.Database) {
  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
    .run(D_SEC_ID, 'Delta Corp', 'EUR');

  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(D_PORT_ID, 'Portfolio', 'portfolio', null, D_DEP_ID);
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(D_DEP_ID, 'Cash', 'account', 'EUR');

  // DEPOSIT 5000 on 2024-01-15
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-dep-001', 'DEPOSIT', '2024-01-15', 'EUR', 5000 * 100, 0, null, D_DEP_ID);
  // BUY 20 shares at 100 EUR on 2024-01-20 (dual-entry)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-buy-001', 'BUY', '2024-01-20', 'EUR', 2000 * 100, 20 * 1e8, D_SEC_ID, D_PORT_ID);
  // cash-side (shares=0, excluded from listing)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-buy-001-cash', 'BUY', '2024-01-20', 'EUR', 2000 * 100, 0, null, D_DEP_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('d-buy-001', D_PORT_ID, 'd-buy-001-cash', D_DEP_ID);

  // REMOVAL 500 on 2024-04-01
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-rem-001', 'REMOVAL', '2024-04-01', 'EUR', 500 * 100, 0, null, D_DEP_ID);
  // DIVIDENDS 100 on 2024-06-15 (ppxml2db uses DIVIDENDS)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-div-001', 'DIVIDENDS', '2024-06-15', 'EUR', 100 * 100, 0, D_SEC_ID, D_DEP_ID);
  // TRANSFER_IN (DELIVERY_INBOUND) 5 shares, amount=500 on 2024-07-01
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-tin-001', 'TRANSFER_IN', '2024-07-01', 'EUR', 500 * 100, 5 * 1e8, D_SEC_ID, D_PORT_ID);
  // TRANSFER_OUT (DELIVERY_OUTBOUND) 2 shares, amount=250 on 2024-09-01
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('d-tout-001', 'TRANSFER_OUT', '2024-09-01', 'EUR', 250 * 100, 2 * 1e8, D_SEC_ID, D_PORT_ID);
  // Prices
  const prices: [string, number][] = [
    ['2023-12-29', 95 * 1e8],
    ['2024-01-15', 95 * 1e8],
    ['2024-01-20', 100 * 1e8],
    ['2024-04-01', 105 * 1e8],
    ['2024-06-15', 110 * 1e8],
    ['2024-07-01', 110 * 1e8],
    ['2024-09-01', 115 * 1e8],
    ['2024-12-30', 120 * 1e8],
    ['2024-12-31', 122 * 1e8],
  ];
  const ins = sqlite.prepare(`INSERT OR REPLACE INTO price (security, tstamp, value) VALUES (?, ?, ?)`);
  for (const [date, value] of prices) ins.run(D_SEC_ID, date, value);

  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(D_SEC_ID, '2024-12-31', 122 * 1e8);
}

describe.skipIf(!hasSqliteBindings)('Delta and Absolute Change', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedDeltaData(sqlite);
  });

  it('absoluteChange = MVE − MVB', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${D_START}&periodEnd=${D_END}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, string>;
    const mv = parseFloat(body.finalValue);
    const mvb = parseFloat(body.initialValue);
    const ac = parseFloat(body.absoluteChange);
    expect(ac).toBeCloseTo(mv - mvb, 4);
  });

  it('PNT includes delivery amounts (TRANSFER_IN and TRANSFER_OUT)', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${D_START}&periodEnd=${D_END}`);
    expect(res.status).toBe(200);
    const pntObj = (res.body as Record<string, Record<string, string>>).performanceNeutralTransfers;
    const pnt = parseFloat(pntObj.total);
    // deposits=5000, deliveryIn=500, removals=500, deliveryOut=250 → PNT = 4750
    expect(pnt).toBeCloseTo(4750, 2);
  });

  it('deltaValue = absoluteChange − performanceNeutralTransfers', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${D_START}&periodEnd=${D_END}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, string>;
    const ac = parseFloat(body.absoluteChange);
    const pnt = parseFloat((res.body as Record<string, Record<string, string>>).performanceNeutralTransfers.total);
    const dv = parseFloat(body.deltaValue);
    expect(dv).toBeCloseTo(ac - pnt, 4);
  });

  it('dividends are NOT included in PNT', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${D_START}&periodEnd=${D_END}`);
    expect(res.status).toBe(200);
    const pnt = parseFloat((res.body as Record<string, Record<string, string>>).performanceNeutralTransfers.total);
    // If dividends (100) were included, PNT would be 4850 — it must be 4750
    expect(pnt).not.toBeCloseTo(4850, 2);
    expect(pnt).toBeCloseTo(4750, 2);
  });

  it('lastDay fields are present and are valid strings', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${D_START}&periodEnd=${D_END}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.lastDayAbsoluteChange).toBe('string');
    expect(typeof body.lastDayDeltaValue).toBe('string');
    expect(typeof body.lastDayDelta).toBe('string');
    expect(isNaN(parseFloat(body.lastDayAbsoluteChange as string))).toBe(false);
    expect(isNaN(parseFloat(body.lastDayDeltaValue as string))).toBe(false);
  });

  it('lastDay values differ from full-period values', async () => {
    const res = await request(app)
      .get(`/api/performance/calculation?periodStart=${D_START}&periodEnd=${D_END}`);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, string>;
    const fullAc = parseFloat(body.absoluteChange);
    const lastAc = parseFloat(body.lastDayAbsoluteChange);
    // Full-year absolute change >> single-day change
    expect(Math.abs(fullAc)).toBeGreaterThan(Math.abs(lastAc));
  });
});

describe.skipIf(!hasSqliteBindings)('GET /api/taxonomies', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedData(sqlite);

    // Add taxonomy root entry (required by GET /api/taxonomies which queries the taxonomy table)
    // root = the uuid of the root taxonomy_category node
    sqlite.prepare(`INSERT INTO taxonomy (uuid, name, root) VALUES (?, ?, ?)`).run('tax-001', 'Asset Class', 'tax-001');
    // Add taxonomy_category entries
    sqlite.prepare(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank)
      VALUES (?, ?, NULL, ?, '#000', 10000, 0)`).run('tax-001', 'tax-001', 'Asset Class');
    sqlite.prepare(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank)
      VALUES (?, ?, ?, ?, '#00f', 0, 0)`).run('cat-001', 'tax-001', 'tax-001', 'Equity');
    sqlite.prepare(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank)
      VALUES (?, ?, ?, ?, '#f00', 0, 1)`).run('cat-002', 'tax-001', 'tax-001', 'Bonds');

    // Assign security to Equity category
    sqlite.prepare(`INSERT INTO taxonomy_assignment (item, category, taxonomy, item_type, weight)
      VALUES (?, ?, ?, ?, ?)`).run(SEC_ID, 'cat-001', 'tax-001', 'security', 100);
  });

  it('returns list of root taxonomies', async () => {
    const res = await request(app).get('/api/taxonomies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const tax = (res.body as Array<{ id: string; name: string }>).find(
      (t) => t.id === 'tax-001',
    );
    expect(tax).toBeDefined();
    expect(tax!.name).toBe('Asset Class');
  });

  it('returns taxonomy detail with categories and assignments', async () => {
    const res = await request(app).get('/api/taxonomies/tax-001');
    expect(res.status).toBe(200);

    const body = res.body as {
      id: string;
      name: string;
      categories: Array<{ id: string; name: string; assignments: Array<{ itemId: string; itemType: string }> }>;
    };
    expect(body.id).toBe('tax-001');
    expect(body.name).toBe('Asset Class');
    expect(Array.isArray(body.categories)).toBe(true);

    const equity = body.categories.find((c) => c.id === 'cat-001');
    expect(equity).toBeDefined();
    expect(equity!.assignments.length).toBe(1);
    expect(equity!.assignments[0].itemId).toBe(SEC_ID);
  });

  it('returns 404 for unknown taxonomy', async () => {
    const res = await request(app).get('/api/taxonomies/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ─── latest_price injection tests ────────────────────────────────────────────

const LP_SEC_ID = 'sec-lp-001';
const LP_PORT_ID = 'acct-lp-port';
const LP_DEP_ID = 'acct-lp-dep';

function seedLatestPriceData(sqlite: Database.Database) {
  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
    .run(LP_SEC_ID, 'LP Corp', 'EUR');
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(LP_PORT_ID, 'Portfolio', 'portfolio', null, LP_DEP_ID);
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(LP_DEP_ID, 'Cash', 'account', 'EUR');

  // BUY 10 shares at 100 EUR on 2024-01-10 (dual-entry)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('lp-buy-001', 'BUY', '2024-01-10', 'EUR', 1000 * 100, 10 * 1e8, LP_SEC_ID, LP_PORT_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('lp-buy-001-cash', 'BUY', '2024-01-10', 'EUR', 1000 * 100, 0, null, LP_DEP_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('lp-buy-001', LP_PORT_ID, 'lp-buy-001-cash', LP_DEP_ID);

  // Only one price entry in `price` table (stale — last price was 2024-11-15)
  sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(LP_SEC_ID, '2024-11-15', 110 * 1e8); // 110 EUR
}

describe.skipIf(!hasSqliteBindings)('latest_price injection into MVE', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedLatestPriceData(sqlite);
  });

  it('MVE uses latest_price when tstamp is more recent than last price table entry', async () => {
    // latest_price = 150 EUR on 2024-12-20, which is more recent than 2024-11-15
    sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(LP_SEC_ID, '2024-12-20', 150 * 1e8);

    const res = await request(app)
      .get(`/api/performance/securities?periodStart=2024-01-01&periodEnd=2024-12-31`);

    expect(res.status).toBe(200);
    const secs = res.body as Array<{ securityId: string; mve: string }>;
    const sec = secs.find((s) => s.securityId === LP_SEC_ID);
    expect(sec).toBeDefined();
    // MVE = 10 shares × 150 EUR = 1500
    expect(parseFloat(sec!.mve)).toBeCloseTo(1500, 2);
  });

  it('MVE does NOT use latest_price when tstamp is after period.end (historical view)', async () => {
    // latest_price = 160 EUR on 2025-02-01, which is after period.end=2024-12-31
    sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
      .run(LP_SEC_ID, '2025-02-01', 160 * 1e8);

    const res = await request(app)
      .get(`/api/performance/securities?periodStart=2024-01-01&periodEnd=2024-12-31`);

    expect(res.status).toBe(200);
    const secs = res.body as Array<{ securityId: string; mve: string }>;
    const sec = secs.find((s) => s.securityId === LP_SEC_ID);
    expect(sec).toBeDefined();
    // MVE must NOT be 1600 (160 × 10); it should carry forward 110 EUR (last price entry)
    expect(parseFloat(sec!.mve)).not.toBeCloseTo(1600, 2);
    expect(parseFloat(sec!.mve)).toBeCloseTo(1100, 2);
  });
});

describe.skipIf(!hasSqliteBindings)('GET /api/reports/payments/breakdown', () => {
  let app: ReturnType<typeof createApp>;

  // Two securities, one deposit account, one DIVIDENDS + one INTEREST tx
  const B_SEC1 = 'b-sec-001';
  const B_SEC2 = 'b-sec-002';
  const B_DEP  = 'b-dep-001';
  const B_PERIOD_START = '2024-01-01';
  const B_PERIOD_END   = '2024-12-31';

  beforeEach(() => {
    const { sqlite, db } = createTestDb();

    // Securities
    sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`).run(B_SEC1, 'Alpha Corp', 'EUR');
    sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`).run(B_SEC2, 'Beta Ltd',  'EUR');

    // Deposit account
    sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`).run(B_DEP, 'Main Cash', 'account', 'EUR');

    // DIVIDENDS for Alpha Corp in 2024-06: net 120 EUR (DB stores net), taxes 20, fees 5 → gross 145
    sqlite.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, taxes, fees, acctype)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('b-div-001', 'DIVIDENDS', '2024-06-10', 'EUR', 120 * 100, 0, B_SEC1, B_DEP, 20 * 100, 5 * 100, 'account');

    // DIVIDEND (singular) for Beta Ltd in 2024-06: net 80 EUR, taxes 10, fees 0 → gross 90
    sqlite.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, taxes, fees, acctype)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('b-div-002', 'DIVIDEND', '2024-06-20', 'EUR', 80 * 100, 0, B_SEC2, B_DEP, 10 * 100, 0, 'account');

    // DIVIDEND for Alpha Corp in 2024-07 (different bucket — must NOT appear in June breakdown)
    sqlite.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, taxes, fees, acctype)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('b-div-003', 'DIVIDEND', '2024-07-01', 'EUR', 50 * 100, 0, B_SEC1, B_DEP, 0, 0, 'account');

    // INTEREST on Main Cash in 2024-06: net 30 EUR, 0 taxes, 0 fees → gross 30
    sqlite.prepare(
      `INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account, taxes, fees, acctype)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('b-int-001', 'INTEREST', '2024-06-25', 'EUR', 30 * 100, 0, null, B_DEP, 0, 0, 'account');

    // createApp requires both the Drizzle db instance and the raw sqlite instance
    app = createApp(db as Parameters<typeof createApp>[0], sqlite);
  });

  const url = (params: Record<string, string>) => {
    const qs = new URLSearchParams({
      periodStart: B_PERIOD_START,
      periodEnd: B_PERIOD_END,
      ...params,
    }).toString();
    return `/api/reports/payments/breakdown?${qs}`;
  };

  it('returns 400 when bucket is missing', async () => {
    const res = await request(app).get(
      url({ groupBy: 'month', type: 'DIVIDEND' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when groupBy is invalid', async () => {
    const res = await request(app).get(
      url({ bucket: '2024-06', groupBy: 'week', type: 'DIVIDEND' }),
    );
    expect(res.status).toBe(400);
  });

  it('aggregates DIVIDEND breakdown by security for a monthly bucket', async () => {
    const res = await request(app).get(
      url({ bucket: '2024-06', groupBy: 'month', type: 'DIVIDEND' }),
    );

    expect(res.status).toBe(200);
    const body = res.body as {
      bucket: string;
      type: string;
      items: Array<{ id: string; name: string; grossAmount: string; netAmount: string; taxes: string; fees: string; count: number }>;
      totalGross: string;
      totalNet: string;
    };

    expect(body.bucket).toBe('2024-06');
    expect(body.type).toBe('DIVIDEND');
    expect(body.items).toHaveLength(2);

    // Alpha Corp: net 120 (DB), taxes 20, fees 5 → gross = 120 + 20 + 5 = 145
    const alpha = body.items.find((i) => i.id === B_SEC1);
    expect(alpha).toBeDefined();
    expect(parseFloat(alpha!.grossAmount)).toBeCloseTo(145, 2);
    expect(parseFloat(alpha!.netAmount)).toBeCloseTo(120, 2);
    expect(parseFloat(alpha!.taxes)).toBeCloseTo(20, 2);
    expect(parseFloat(alpha!.fees)).toBeCloseTo(5, 2);
    expect(alpha!.count).toBe(1);

    // Beta Ltd: net 80 (DB), taxes 10, fees 0 → gross = 80 + 10 = 90
    const beta = body.items.find((i) => i.id === B_SEC2);
    expect(beta).toBeDefined();
    expect(parseFloat(beta!.grossAmount)).toBeCloseTo(90, 2);
    expect(parseFloat(beta!.netAmount)).toBeCloseTo(80, 2);
    expect(beta!.count).toBe(1);

    // Totals: gross 145 + 90 = 235, net 120 + 80 = 200
    expect(parseFloat(body.totalGross)).toBeCloseTo(235, 2);
    expect(parseFloat(body.totalNet)).toBeCloseTo(200, 2);
  });

  it('includes both DIVIDEND and DIVIDENDS type rows (ppxml2db normalisation)', async () => {
    // b-div-001 is type 'DIVIDENDS' (plural), b-div-002 is 'DIVIDEND' — both must appear
    const res = await request(app).get(
      url({ bucket: '2024-06', groupBy: 'month', type: 'DIVIDEND' }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ id: string }> };
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(B_SEC1); // from 'DIVIDENDS' row
    expect(ids).toContain(B_SEC2); // from 'DIVIDEND' row
  });

  it('does NOT include transactions from a different bucket', async () => {
    // b-div-003 is in 2024-07, must not appear in 2024-06 breakdown
    const res = await request(app).get(
      url({ bucket: '2024-06', groupBy: 'month', type: 'DIVIDEND' }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ id: string; count: number }> };
    const alpha = body.items.find((i) => i.id === B_SEC1);
    expect(alpha?.count).toBe(1); // only the June tx, not July
  });

  it('aggregates INTEREST breakdown by account for a monthly bucket', async () => {
    const res = await request(app).get(
      url({ bucket: '2024-06', groupBy: 'month', type: 'INTEREST' }),
    );

    expect(res.status).toBe(200);
    const body = res.body as {
      type: string;
      items: Array<{ id: string; name: string; grossAmount: string; netAmount: string; count: number }>;
      totalGross: string;
      totalNet: string;
    };

    expect(body.type).toBe('INTEREST');
    expect(body.items).toHaveLength(1);

    const dep = body.items[0];
    expect(dep.id).toBe(B_DEP);
    expect(dep.name).toBe('Main Cash');
    expect(parseFloat(dep.grossAmount)).toBeCloseTo(30, 2);
    expect(parseFloat(dep.netAmount)).toBeCloseTo(30, 2); // no taxes/fees
    expect(dep.count).toBe(1);

    expect(parseFloat(body.totalGross)).toBeCloseTo(30, 2);
    expect(parseFloat(body.totalNet)).toBeCloseTo(30, 2);
  });

  it('returns empty items array when no transactions match the bucket', async () => {
    const res = await request(app).get(
      url({ bucket: '2024-01', groupBy: 'month', type: 'DIVIDEND' }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { items: unknown[]; totalGross: string };
    expect(body.items).toHaveLength(0);
    expect(parseFloat(body.totalGross)).toBe(0);
  });

  it('handles quarterly bucket groupBy', async () => {
    // Both 2024-06 and 2024-07 dividends should appear in Q2/Q3 respectively
    // 2024-06 → Q2, 2024-07 → Q3
    const resQ2 = await request(app).get(
      url({ bucket: '2024-Q2', groupBy: 'quarter', type: 'DIVIDEND' }),
    );
    expect(resQ2.status).toBe(200);
    const bodyQ2 = resQ2.body as { items: Array<{ id: string }> };
    expect(bodyQ2.items.map((i) => i.id)).toContain(B_SEC1);
    expect(bodyQ2.items.map((i) => i.id)).toContain(B_SEC2);

    const resQ3 = await request(app).get(
      url({ bucket: '2024-Q3', groupBy: 'quarter', type: 'DIVIDEND' }),
    );
    expect(resQ3.status).toBe(200);
    const bodyQ3 = resQ3.body as { items: Array<{ id: string }> };
    // Only Alpha Corp (July tx) in Q3
    expect(bodyQ3.items).toHaveLength(1);
    expect(bodyQ3.items[0].id).toBe(B_SEC1);
  });

  it('handles yearly bucket groupBy', async () => {
    const res = await request(app).get(
      url({ bucket: '2024', groupBy: 'year', type: 'DIVIDEND' }),
    );
    expect(res.status).toBe(200);
    const body = res.body as { items: Array<{ id: string; grossAmount: string }> };
    // Alpha Corp: gross 145 (Jun) + 50 (Jul, no fees/taxes) = 195
    const alpha = body.items.find((i) => i.id === B_SEC1);
    expect(parseFloat(alpha!.grossAmount)).toBeCloseTo(195, 2);
  });
});

// ─── Heatmap: inception year date truncation regression ─────────────────────
// Regression: getReturnsHeatmap uses MIN(date) from xact, which returns
// "yyyy-MM-ddTHH:mm" from ppxml2db. Without .slice(0,10), the time component
// causes cascading failures (cash map mismatch, price exclusion, inflated return).

const HM_SEC_ID = 'hm-sec-001';
const HM_PORT_ID = 'hm-port-001';
const HM_DEP_ID = 'hm-dep-001';

function seedHeatmapData(sqlite: Database.Database) {
  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
    .run(HM_SEC_ID, 'Heatmap Corp', 'EUR');
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(HM_PORT_ID, 'Portfolio', 'portfolio', null, HM_DEP_ID);
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(HM_DEP_ID, 'Cash', 'account', 'EUR');

  // DEPOSIT 10000 on inception day — date has TIME COMPONENT (ppxml2db format)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('hm-dep-001', 'DEPOSIT', '2024-02-01T10:14', 'EUR', 10000 * 100, 0, null, HM_DEP_ID);

  // BUY 50 shares at 100 EUR on inception day — also with time component
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('hm-buy-001', 'BUY', '2024-02-01T10:14', 'EUR', 5000 * 100, 50 * 1e8, HM_SEC_ID, HM_PORT_ID);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('hm-buy-001-cash', 'BUY', '2024-02-01T10:14', 'EUR', 5000 * 100, 0, null, HM_DEP_ID);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('hm-buy-001', HM_PORT_ID, 'hm-buy-001-cash', HM_DEP_ID);

  // Prices — date-only tstamps (standard price table format)
  const prices: [string, number][] = [
    ['2024-02-01', 100 * 1e8],  // inception day
    ['2024-06-30', 105 * 1e8],  // mid-year
    ['2024-12-31', 110 * 1e8],  // year-end
  ];
  const ins = sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`);
  for (const [date, value] of prices) ins.run(HM_SEC_ID, date, value);

  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(HM_SEC_ID, '2024-12-31', 110 * 1e8);
}

describe.skipIf(!hasSqliteBindings)('GET /api/performance/returns — inception year date truncation', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedHeatmapData(sqlite);
  });

  it('inception year return is not inflated when xact dates have time components', async () => {
    const res = await request(app).get('/api/performance/returns');

    expect(res.status).toBe(200);
    const body = res.body as { yearly: Array<{ year: number; value: string }> };
    expect(Array.isArray(body.yearly)).toBe(true);

    const y2024 = body.yearly.find((e) => e.year === 2024);
    expect(y2024).toBeDefined();

    // With time-component bug: deposit not neutralized → return ~69% (inflated)
    // With fix: deposit neutralized → return reflects only price gain
    // 50 shares × (110 − 100) = 500 gain on 10000 portfolio → ~5% range
    const val = parseFloat(y2024!.value);
    // Must be reasonable (< 20%), not inflated (was ~69.5% before fix)
    expect(val).toBeLessThan(0.20);
    expect(val).toBeGreaterThan(-0.20);
  });
});

// ─── Taxonomy-scoped heatmap regression ──────────────────────────────────────

const TSX_SEC_1 = 'tsx-sec-001';
const TSX_SEC_2 = 'tsx-sec-002';
const TSX_PORT = 'tsx-port-001';
const TSX_DEP = 'tsx-dep-001';
const TSX_TAX = 'tsx-tax-001';
const TSX_CAT = 'tsx-cat-001';
const TSX_TAX_ROOT = 'tsx-root-001';

function seedTaxonomyScopeData(sqlite: Database.Database) {
  // Accounts
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(TSX_DEP, 'Test Deposit', 'account', 'EUR');
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(TSX_PORT, 'Test Portfolio', 'portfolio', 'EUR', TSX_DEP);

  // Securities
  sqlite.prepare(`INSERT INTO security (uuid, name, currency, isin) VALUES (?, ?, ?, ?)`)
    .run(TSX_SEC_1, 'Sec One', 'EUR', 'IE0001');
  sqlite.prepare(`INSERT INTO security (uuid, name, currency, isin) VALUES (?, ?, ?, ?)`)
    .run(TSX_SEC_2, 'Sec Two', 'EUR', 'IE0002');

  // Deposit 20000 EUR
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('tsx-dep-001-tx', 'DEPOSIT', '2024-01-15', 'EUR', 20000 * 100, 0, null, TSX_DEP);

  // BUY 50 shares of Sec One at 100 EUR (5000 EUR)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('tsx-buy-001', 'BUY', '2024-02-01', 'EUR', 5000 * 100, 50 * 1e8, TSX_SEC_1, TSX_PORT);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('tsx-buy-001-cash', 'BUY', '2024-02-01', 'EUR', 5000 * 100, 0, null, TSX_DEP);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('tsx-buy-001', TSX_PORT, 'tsx-buy-001-cash', TSX_DEP);

  // BUY 25 shares of Sec Two at 80 EUR (2000 EUR)
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('tsx-buy-002', 'BUY', '2024-03-01', 'EUR', 2000 * 100, 25 * 1e8, TSX_SEC_2, TSX_PORT);
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('tsx-buy-002-cash', 'BUY', '2024-03-01', 'EUR', 2000 * 100, 0, null, TSX_DEP);
  sqlite.prepare(`INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc) VALUES (?, ?, ?, ?)`)
    .run('tsx-buy-002', TSX_PORT, 'tsx-buy-002-cash', TSX_DEP);

  // Prices — Sec One: 100 → 110 (10% gain)
  const insPrice = sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`);
  insPrice.run(TSX_SEC_1, '2024-02-01', 100 * 1e8);
  insPrice.run(TSX_SEC_1, '2024-06-30', 105 * 1e8);
  insPrice.run(TSX_SEC_1, '2024-12-31', 110 * 1e8);

  // Prices — Sec Two: 80 → 88 (10% gain)
  insPrice.run(TSX_SEC_2, '2024-03-01', 80 * 1e8);
  insPrice.run(TSX_SEC_2, '2024-06-30', 84 * 1e8);
  insPrice.run(TSX_SEC_2, '2024-12-31', 88 * 1e8);

  // Latest prices
  const insLatest = sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`);
  insLatest.run(TSX_SEC_1, '2024-12-31', 110 * 1e8);
  insLatest.run(TSX_SEC_2, '2024-12-31', 88 * 1e8);

  // Taxonomy: one taxonomy with one category containing both securities
  sqlite.prepare(`INSERT INTO taxonomy (uuid, name, root) VALUES (?, ?, ?)`)
    .run(TSX_TAX, 'Asset Class', TSX_TAX_ROOT);
  sqlite.prepare(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(TSX_TAX_ROOT, TSX_TAX, null, 'Asset Class', '#000000', 10000, 0);
  sqlite.prepare(`INSERT INTO taxonomy_category (uuid, taxonomy, parent, name, color, weight, rank) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(TSX_CAT, TSX_TAX, TSX_TAX_ROOT, 'Equities', '#0000FF', 10000, 0);
  sqlite.prepare(`INSERT INTO taxonomy_assignment (taxonomy, category, item_type, item, weight, rank) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(TSX_TAX, TSX_CAT, 'security', TSX_SEC_1, 10000, 0);
  sqlite.prepare(`INSERT INTO taxonomy_assignment (taxonomy, category, item_type, item, weight, rank) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(TSX_TAX, TSX_CAT, 'security', TSX_SEC_2, 10000, 0);
}

describe.skipIf(!hasSqliteBindings)('GET /api/performance/returns — taxonomy and security scope', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedTaxonomyScopeData(sqlite);
  });

  it('taxonomy-scoped heatmap is not inflated by BUY-day MV jumps', async () => {
    const res = await request(app)
      .get(`/api/performance/returns?taxonomyId=${TSX_TAX}&categoryId=${TSX_CAT}&periodStart=2024-01-01&periodEnd=2024-12-31`);

    expect(res.status).toBe(200);
    const body = res.body as { yearly: Array<{ year: number; value: string }> };
    const y2024 = body.yearly.find((e) => e.year === 2024);
    expect(y2024).toBeDefined();

    const val = parseFloat(y2024!.value);
    // Both securities gained ~10%. Without the fix, BUY-day MV jumps would
    // inflate this to 100%+ because cashflows were empty.
    expect(val).toBeLessThan(0.25);
    expect(val).toBeGreaterThan(-0.10);
  });

  it('single-security scoped heatmap is not inflated', async () => {
    const res = await request(app)
      .get(`/api/performance/returns?filter=${TSX_SEC_1}&periodStart=2024-01-01&periodEnd=2024-12-31`);

    expect(res.status).toBe(200);
    const body = res.body as { yearly: Array<{ year: number; value: string }> };
    const y2024 = body.yearly.find((e) => e.year === 2024);
    expect(y2024).toBeDefined();

    const val = parseFloat(y2024!.value);
    // Sec One: 100 → 110, ~10% gain
    expect(val).toBeLessThan(0.25);
    expect(val).toBeGreaterThan(-0.10);
  });

  it('full portfolio heatmap is unaffected (regression guard)', async () => {
    const res = await request(app)
      .get('/api/performance/returns?periodStart=2024-01-01&periodEnd=2024-12-31');

    expect(res.status).toBe(200);
    const body = res.body as { yearly: Array<{ year: number; value: string }> };
    const y2024 = body.yearly.find((e) => e.year === 2024);
    expect(y2024).toBeDefined();

    const val = parseFloat(y2024!.value);
    // Full portfolio: 20000 deposit, 7000 invested, gains ~700 → modest return
    expect(val).toBeLessThan(0.20);
    expect(val).toBeGreaterThan(-0.10);
  });
});
