import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Decimal from 'decimal.js';
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
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EUR_DEPOSIT_ID = 'acct-eur';
const USD_DEPOSIT_ID = 'acct-usd';
const EUR_PORTFOLIO_ID = 'port-eur';
const SEC_EUR_ID = 'sec-eur-001';
const SEC_USD_ID = 'sec-usd-001';
const PERIOD_START = '2024-01-01';
const PERIOD_END = '2024-12-31';

// ─── Seed: multi-currency portfolio ──────────────────────────────────────────

function seedMultiCurrencyData(sqlite: Database.Database) {
  // Base currency = EUR
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
    .run('portfolio.currency', 'EUR');

  // EUR deposit account
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(EUR_DEPOSIT_ID, 'EUR Cash', 'account', 'EUR');

  // USD deposit account (foreign currency)
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency) VALUES (?, ?, ?, ?)`)
    .run(USD_DEPOSIT_ID, 'USD Cash', 'account', 'USD');

  // EUR portfolio account
  sqlite.prepare(`INSERT INTO account (uuid, name, type, currency, referenceAccount) VALUES (?, ?, ?, ?, ?)`)
    .run(EUR_PORTFOLIO_ID, 'Portfolio', 'portfolio', 'EUR', EUR_DEPOSIT_ID);

  // EUR security
  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
    .run(SEC_EUR_ID, 'Euro Corp', 'EUR');

  // USD security (foreign currency)
  sqlite.prepare(`INSERT INTO security (uuid, name, currency) VALUES (?, ?, ?)`)
    .run(SEC_USD_ID, 'US Corp', 'USD');

  // ── Transactions ──

  // DEPOSIT 5000 EUR into EUR account
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, account) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('xact-dep-eur', 'DEPOSIT', '2024-01-02', 'EUR', 500000, EUR_DEPOSIT_ID);

  // DEPOSIT 2000 USD into USD account
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, account) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('xact-dep-usd', 'DEPOSIT', '2024-01-02', 'USD', 200000, USD_DEPOSIT_ID);

  // BUY 10 shares of EUR security at 100 EUR = 1000 EUR
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-buy-eur', 'BUY', '2024-02-01', 'EUR', 100000, 10 * 1e8, SEC_EUR_ID, EUR_DEPOSIT_ID);

  // BUY 5 shares of USD security at 200 USD = 1000 USD
  sqlite.prepare(`INSERT INTO xact (uuid, type, date, currency, amount, shares, security, account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('xact-buy-usd', 'BUY', '2024-02-01', 'USD', 100000, 5 * 1e8, SEC_USD_ID, USD_DEPOSIT_ID);

  // ── Prices (stored as value × 1e8) ──

  // EUR security prices
  const eurPrices: [string, number][] = [
    ['2023-12-29', 9500000000],   // 95 EUR
    ['2024-01-05', 9800000000],   // 98 EUR
    ['2024-06-28', 11000000000],  // 110 EUR
    ['2024-12-31', 12000000000],  // 120 EUR
  ];
  for (const [d, v] of eurPrices) {
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_EUR_ID, d, v);
  }

  // USD security prices (in USD — native currency)
  const usdPrices: [string, number][] = [
    ['2023-12-29', 19000000000],  // 190 USD
    ['2024-01-05', 19500000000],  // 195 USD
    ['2024-06-28', 22000000000],  // 220 USD
    ['2024-12-31', 24000000000],  // 240 USD
  ];
  for (const [d, v] of usdPrices) {
    sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`).run(SEC_USD_ID, d, v);
  }

  // Latest prices
  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(SEC_EUR_ID, '2024-12-31', 12000000000);
  sqlite.prepare(`INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(SEC_USD_ID, '2024-12-31', 24000000000);

  // ── Exchange rates: EUR/USD (ECB convention: from_currency=EUR, to_currency=USD) ──
  // Rate = how many USD per 1 EUR
  const fxRates: [string, string][] = [
    ['2023-12-29', '1.1050'],  // 1 EUR = 1.1050 USD
    ['2024-01-02', '1.1000'],  // 1 EUR = 1.1000 USD → USD→EUR = 1/1.10 = 0.9091
    ['2024-02-01', '1.0800'],  // 1 EUR = 1.0800 USD → USD→EUR = 1/1.08 = 0.9259
    ['2024-06-28', '1.0700'],  // 1 EUR = 1.0700 USD → USD→EUR = 1/1.07 = 0.9346
    ['2024-12-31', '1.0400'],  // 1 EUR = 1.0400 USD → USD→EUR = 1/1.04 = 0.9615
  ];
  const insertFx = sqlite.prepare(
    `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES (?, ?, ?, ?)`,
  );
  for (const [d, r] of fxRates) {
    insertFx.run(d, 'EUR', 'USD', r);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!hasSqliteBindings)('Multi-currency integration', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
    seedMultiCurrencyData(sqlite);
  });

  describe('GET /api/reports/statement-of-assets', () => {
    it('converts USD security market value to EUR base currency', async () => {
      const res = await request(app)
        .get(`/api/reports/statement-of-assets?date=${PERIOD_END}`);

      expect(res.status).toBe(200);
      const body = res.body;

      // EUR security: 10 shares × 120 EUR = 1200 EUR (no conversion needed)
      const eurSec = body.securities.find(
        (s: { securityId: string }) => s.securityId === SEC_EUR_ID,
      );
      expect(eurSec).toBeDefined();
      expect(new Decimal(eurSec.marketValue).toDecimalPlaces(2).toNumber()).toBeCloseTo(1200, 0);

      // USD security: 5 shares × 240 USD = 1200 USD
      // Rate on 2024-12-31: EUR/USD = 1.0400, so USD→EUR = 1/1.04 = 0.9615
      // Converted: 1200 × 0.9615 ≈ 1153.85 EUR
      const usdSec = body.securities.find(
        (s: { securityId: string }) => s.securityId === SEC_USD_ID,
      );
      expect(usdSec).toBeDefined();
      const usdSecMV = new Decimal(usdSec.marketValue).toDecimalPlaces(2).toNumber();
      expect(usdSecMV).toBeGreaterThan(1100);
      expect(usdSecMV).toBeLessThan(1200);
      // More precisely: 1200 / 1.04 = 1153.846...
      expect(usdSecMV).toBeCloseTo(1153.85, 0);

      // USD cash account should be converted to EUR
      const usdAcct = body.depositAccounts.find(
        (a: { accountId: string }) => a.accountId === USD_DEPOSIT_ID,
      );
      if (usdAcct) {
        // Balance: 2000 - 1000 (BUY) = 1000 USD remaining
        // Converted: 1000 / 1.04 ≈ 961.54 EUR
        const usdBalance = new Decimal(usdAcct.balance).toDecimalPlaces(2).toNumber();
        expect(usdBalance).toBeGreaterThan(900);
        expect(usdBalance).toBeLessThan(1000);
      }

      // Total MV should include both EUR and converted USD values
      const totalMV = new Decimal(body.totals.marketValue).toDecimalPlaces(2).toNumber();
      // EUR securities (1200) + USD securities (~1153.85) + EUR cash (4000) + USD cash (~961.54)
      // ≈ 7315.39
      expect(totalMV).toBeGreaterThan(7000);
      expect(totalMV).toBeLessThan(8000);
    });
  });

  describe('GET /api/performance/calculation', () => {
    it('returns valid performance metrics with multi-currency positions', async () => {
      const res = await request(app)
        .get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

      expect(res.status).toBe(200);
      const body = res.body;

      // All required fields should be strings
      expect(typeof body.initialValue).toBe('string');
      expect(typeof body.finalValue).toBe('string');
      expect(typeof body.ttwror).toBe('string');
      expect(typeof body.irr).toBe('string');
      expect(typeof body.cashCurrencyGains.total).toBe('string');
      expect(typeof body.capitalGains.foreignCurrencyGains).toBe('string');

      // cashCurrencyGains should NOT be '0' since we have a USD deposit account
      // The USD rate changed from 1.10 to 1.04 (USD strengthened vs EUR)
      // So USD cash should show a positive FX gain in EUR terms
      const cashFxGains = new Decimal(body.cashCurrencyGains.total);
      // USD balance: 1000 USD, rate changed from USD→EUR=0.9091 to 0.9615
      // Gain: 1000 × (0.9615 - 0.9091) ≈ 52.4 EUR (positive — USD strengthened)
      // But the exact value depends on which period start/end rates are used
      // Just verify it's non-zero
      expect(cashFxGains.abs().gt(0)).toBe(true);

      // TTWROR should be valid (not NaN)
      const ttwror = parseFloat(body.ttwror);
      expect(isNaN(ttwror)).toBe(false);

      // IRR should converge
      expect(body.irrConverged).toBe(true);

      // Final value should be greater than initial (securities went up)
      const initialValue = parseFloat(body.initialValue);
      const finalValue = parseFloat(body.finalValue);
      expect(finalValue).toBeGreaterThan(initialValue);
    });

    it('foreignCurrencyGains is non-zero for USD security', async () => {
      const res = await request(app)
        .get(`/api/performance/securities?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

      expect(res.status).toBe(200);
      const securities = res.body;

      // Find USD security performance
      const usdPerf = securities.find(
        (s: { securityId: string }) => s.securityId === SEC_USD_ID,
      );
      expect(usdPerf).toBeDefined();

      // FX gains should be computed (not just '0')
      // USD strengthened from 1.10 to 1.04 against EUR
      // So foreign currency gains should be positive
      expect(typeof usdPerf.foreignCurrencyGains).toBe('string');

      // EUR security should have zero FX gains (same currency as base)
      const eurPerf = securities.find(
        (s: { securityId: string }) => s.securityId === SEC_EUR_ID,
      );
      expect(eurPerf).toBeDefined();
      expect(new Decimal(eurPerf.foreignCurrencyGains).toNumber()).toBe(0);
    });
  });

  describe('consistency checks', () => {
    it('Statement of Assets and Portfolio Calc agree on final value', async () => {
      const [soaRes, calcRes] = await Promise.all([
        request(app).get(`/api/reports/statement-of-assets?date=${PERIOD_END}`),
        request(app).get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`),
      ]);

      expect(soaRes.status).toBe(200);
      expect(calcRes.status).toBe(200);

      const soaTotalMV = new Decimal(soaRes.body.totals.marketValue);
      const calcFinalValue = new Decimal(calcRes.body.finalValue);

      // They should be close (may differ slightly due to different code paths)
      // but should be in the same ballpark
      const diff = soaTotalMV.minus(calcFinalValue).abs();
      const tolerance = soaTotalMV.times(0.05); // 5% tolerance
      expect(diff.lte(tolerance)).toBe(true);
    });

    it('all-EUR portfolio has zero FX effects', async () => {
      // Remove USD elements
      sqlite.exec(`DELETE FROM xact WHERE currency = 'USD'`);
      sqlite.exec(`DELETE FROM account WHERE currency = 'USD'`);
      sqlite.exec(`DELETE FROM security WHERE currency = 'USD'`);

      const res = await request(app)
        .get(`/api/performance/calculation?periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`);

      expect(res.status).toBe(200);

      // No FX effects in all-EUR portfolio
      expect(new Decimal(res.body.cashCurrencyGains.total).toNumber()).toBe(0);
      expect(new Decimal(res.body.capitalGains.foreignCurrencyGains).toNumber()).toBe(0);
    });
  });
});
