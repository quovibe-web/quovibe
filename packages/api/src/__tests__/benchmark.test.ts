// Tests for GET /api/performance/benchmark-series

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { createApp } from '../create-app';

let hasSqliteBindings = false;
try {
  new Database(':memory:').close();
  hasSqliteBindings = true;
} catch {
  // native bindings not available
}

// ─── Test DB setup ─────────────────────────────────────────────────────────────

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
      currency TEXT,
      amount INTEGER,
      shares INTEGER,
      note TEXT,
      security TEXT,
      account TEXT,
      source TEXT,
      updatedAt TEXT,
      fees INTEGER,
      taxes INTEGER,
      acctype TEXT,
      _xmlid INTEGER,
      _order INTEGER
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
      value TEXT
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
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    );
    CREATE TABLE calendar_holiday (
      calendar TEXT NOT NULL,
      date TEXT NOT NULL,
      name TEXT,
      PRIMARY KEY (calendar, date)
    );
  `);

  // Base currency
  sqlite.prepare(`INSERT INTO property (name, value) VALUES (?, ?)`)
    .run('portfolio.currency', 'EUR');

  // EUR-denominated benchmark security
  sqlite.prepare(`INSERT INTO security (uuid, name, tickerSymbol, currency) VALUES (?, ?, ?, ?)`)
    .run('sec-eur-1', 'EUR Index', 'EURIDX', 'EUR');

  // USD-denominated benchmark security
  sqlite.prepare(`INSERT INTO security (uuid, name, tickerSymbol, currency) VALUES (?, ?, ?, ?)`)
    .run('sec-usd-1', 'USD Index', 'USDIDX', 'USD');

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/** Insert a historical price. value is the human-readable price (e.g. 100.0);
 *  it is stored ×10^8 as per ppxml2db convention. */
function insertPrice(sqlite: Database.Database, securityId: string, date: string, price: number) {
  sqlite.prepare(`INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)`)
    .run(securityId, date, Math.round(price * 1e8));
}

/** Insert a USD→EUR FX rate for a specific date. */
function insertFxRate(
  sqlite: Database.Database,
  fromCurrency: string,
  toCurrency: string,
  date: string,
  rate: number,
) {
  sqlite.prepare(
    `INSERT INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES (?, ?, ?, ?)`
  ).run(date, fromCurrency, toCurrency, rate.toString());
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

(hasSqliteBindings ? describe : describe.skip)('GET /api/performance/benchmark-series', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  // ── 1. Full price coverage — returns correct cumulative series starting at 0% ──

  it('returns cumulative series starting at 0 for full price coverage', async () => {
    // Prices: 100 on 2024-01-02, 105 on 2024-01-03, 110 on 2024-01-04
    // First point should be 0% (rebased), subsequent points reflect return
    insertPrice(sqlite, 'sec-eur-1', '2024-01-02', 100);
    insertPrice(sqlite, 'sec-eur-1', '2024-01-03', 105);
    insertPrice(sqlite, 'sec-eur-1', '2024-01-04', 110);

    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: 'sec-eur-1',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
        interval: 'daily',
      })
      .expect(200);

    expect(res.body.benchmarks).toHaveLength(1);
    const bm = res.body.benchmarks[0];
    expect(bm.securityId).toBe('sec-eur-1');
    expect(bm.securityName).toBe('EUR Index');
    expect(bm.series.length).toBeGreaterThan(0);

    // First data point must be rebased to 0
    const firstPoint = bm.series[0];
    expect(firstPoint.cumulative).toBeCloseTo(0, 5);

    // Last point reflects a +10% return (100 → 110)
    const lastPoint = bm.series[bm.series.length - 1];
    expect(lastPoint.cumulative).toBeCloseTo(0.1, 4);
  });

  // ── 2. Unknown UUID — returns 200 with empty series ──────────────────────────

  it('returns 200 with empty series for unknown security UUID', async () => {
    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: 'non-existent-uuid',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
        interval: 'daily',
      })
      .expect(200);

    expect(res.body.benchmarks).toHaveLength(1);
    expect(res.body.benchmarks[0].securityId).toBe('non-existent-uuid');
    expect(res.body.benchmarks[0].series).toEqual([]);
  });

  // ── 3. No prices — returns empty series ──────────────────────────────────────

  it('returns empty series when security has no price data', async () => {
    // sec-eur-1 exists but has no prices inserted

    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: 'sec-eur-1',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
        interval: 'daily',
      })
      .expect(200);

    expect(res.body.benchmarks).toHaveLength(1);
    expect(res.body.benchmarks[0].series).toEqual([]);
  });

  // ── 4. Multiple benchmarks — returns both in single request ──────────────────

  it('returns a series for each requested security in a single request', async () => {
    insertPrice(sqlite, 'sec-eur-1', '2024-01-02', 100);
    insertPrice(sqlite, 'sec-eur-1', '2024-01-03', 102);

    insertPrice(sqlite, 'sec-usd-1', '2024-01-02', 200);
    insertPrice(sqlite, 'sec-usd-1', '2024-01-03', 204);

    // Provide USD→EUR FX rate so sec-usd-1 can be converted
    insertFxRate(sqlite, 'USD', 'EUR', '2024-01-01', 0.92);

    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: 'sec-eur-1,sec-usd-1',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-03',
        interval: 'daily',
      })
      .expect(200);

    expect(res.body.benchmarks).toHaveLength(2);
    const ids = res.body.benchmarks.map((b: { securityId: string }) => b.securityId);
    expect(ids).toContain('sec-eur-1');
    expect(ids).toContain('sec-usd-1');

    // Both should have non-empty series
    for (const bm of res.body.benchmarks) {
      expect(bm.series.length).toBeGreaterThan(0);
    }
  });

  // ── 5. FX conversion — USD price with constant rate, return = price change ──

  it('applies FX conversion: USD security with constant rate produces return equal to price change', async () => {
    // USD price goes from 100 to 110 (+10%). FX rate is constant (1.0 USD→EUR).
    // Expected cumulative return at end: +10%.
    insertPrice(sqlite, 'sec-usd-1', '2024-01-02', 100);
    insertPrice(sqlite, 'sec-usd-1', '2024-01-03', 105);
    insertPrice(sqlite, 'sec-usd-1', '2024-01-04', 110);

    // Constant FX rate — inserted several days before to satisfy the 30-day lookback
    insertFxRate(sqlite, 'USD', 'EUR', '2023-12-01', 1.0);
    insertFxRate(sqlite, 'USD', 'EUR', '2024-01-02', 1.0);
    insertFxRate(sqlite, 'USD', 'EUR', '2024-01-04', 1.0);

    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: 'sec-usd-1',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
        interval: 'daily',
      })
      .expect(200);

    expect(res.body.benchmarks).toHaveLength(1);
    const bm = res.body.benchmarks[0];
    expect(bm.series.length).toBeGreaterThan(0);

    // First point rebased to 0
    expect(bm.series[0].cumulative).toBeCloseTo(0, 5);

    // Last point: +10% return (100 → 110, FX neutral)
    const last = bm.series[bm.series.length - 1];
    expect(last.cumulative).toBeCloseTo(0.1, 4);
  });

  // ── 6. Missing securityIds — returns 400 ────────────────────────────────────

  // ── 7. FX gap — skips unconverted prices instead of mixing currencies ──────

  it('skips price points with missing FX rate instead of returning unconverted prices', async () => {
    // USD security: prices on Jan 2-4. FX rate starts only on Jan 3 (none before).
    // buildForwardFilledMap forward-fills from first known rate, but Jan 2 has no rate.
    // Before fix: Jan 2 price was pushed unconverted (USD value 50, not ×0.5 → 25),
    //   mixing USD and EUR prices → wrong cumulative return.
    // After fix: Jan 2 is skipped; engine uses only correctly converted prices.
    insertPrice(sqlite, 'sec-usd-1', '2024-01-02', 50);   // no FX rate → should be skipped
    insertPrice(sqlite, 'sec-usd-1', '2024-01-03', 100);  // FX 0.5 → 50 EUR
    insertPrice(sqlite, 'sec-usd-1', '2024-01-04', 110);  // FX 0.5 → 55 EUR

    // FX rate starts on Jan 3 only — no rate available for Jan 2
    insertFxRate(sqlite, 'USD', 'EUR', '2024-01-03', 0.5);

    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: 'sec-usd-1',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
        interval: 'daily',
      })
      .expect(200);

    const bm = res.body.benchmarks[0];
    expect(bm.series.length).toBeGreaterThan(0);

    // The cumulative return should be 10% (100→110 USD, constant FX 0.5 → 50→55 EUR)
    // NOT affected by unconverted $50 on Jan 2
    const last = bm.series[bm.series.length - 1];
    expect(last.cumulative).toBeCloseTo(0.1, 2);

    // No point should have extreme cumulative return from mixed-currency prices
    for (const point of bm.series) {
      expect(Math.abs(point.cumulative)).toBeLessThan(0.5);
    }
  });

  // ── 8. Calendar alignment — weekly sampled dates match portfolio chart ────

  it('applies calendar filtering so weekly sampled dates exclude weekends', async () => {
    // Insert prices for 2 weeks including weekends
    // Period: Mon Jan 1 to Sun Jan 14 (14 days)
    const prices = [
      ['2024-01-01', 100], ['2024-01-02', 101], ['2024-01-03', 102],
      ['2024-01-04', 103], ['2024-01-05', 104],
      ['2024-01-06', 104.5], ['2024-01-07', 104.8], // weekend
      ['2024-01-08', 105], ['2024-01-09', 106], ['2024-01-10', 107],
      ['2024-01-11', 108], ['2024-01-12', 109],
      ['2024-01-13', 109.5], ['2024-01-14', 109.8], // weekend
    ] as const;
    for (const [date, price] of prices) {
      insertPrice(sqlite, 'sec-eur-1', date, price);
    }

    // Set the global calendar to 'default' (which excludes weekends)
    sqlite.prepare(`INSERT OR REPLACE INTO property (name, special, value) VALUES (?, 0, ?)`)
      .run('portfolio.calendar', 'default');

    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: 'sec-eur-1',
        periodStart: '2024-01-01',
        periodEnd: '2024-01-14',
        interval: 'daily',
      })
      .expect(200);

    const bm = res.body.benchmarks[0];
    const dates = bm.series.map((p: { date: string }) => p.date);

    // Weekend dates (Sat=6, Sun=0) and holidays should be filtered out
    // Jan 1 is New Year's Day in the default calendar
    const nonTradingDates = ['2024-01-01', '2024-01-06', '2024-01-07', '2024-01-13', '2024-01-14'];
    for (const nd of nonTradingDates) {
      expect(dates).not.toContain(nd);
    }

    // Trading days should still be present
    expect(dates).toContain('2024-01-02');
    expect(dates).toContain('2024-01-08');
  });

  // ── 9. Missing securityIds — returns 400 ────────────────────────────────────

  it('returns 400 when securityIds query parameter is missing', async () => {
    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when securityIds is an empty string', async () => {
    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: '',
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when more than 5 security IDs are provided', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `sec-${i}`).join(',');
    const res = await request(app)
      .get('/api/performance/benchmark-series')
      .query({
        securityIds: ids,
        periodStart: '2024-01-02',
        periodEnd: '2024-01-04',
      })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});
