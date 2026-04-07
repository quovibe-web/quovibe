import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { InstrumentType } from '@quovibe/shared';
import * as schema from '../../db/schema';
import { createApp } from '../../create-app';

// Mock the yahoo-search service so tests don't hit the network
const mockSearchYahoo = vi.fn();
const mockFetchPreviewPrices = vi.fn();

vi.mock('../../services/yahoo-search.service', () => ({
  searchYahoo: (...args: unknown[]) => mockSearchYahoo(...args),
  fetchPreviewPrices: (...args: unknown[]) => mockFetchPreviewPrices(...args),
  YahooSearchError: class YahooSearchError extends Error {
    constructor(message: string) { super(message); this.name = 'YahooSearchError'; }
  },
}));

let hasSqliteBindings = false;
try { new Database(':memory:').close(); hasSqliteBindings = true; } catch {}

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`
    CREATE TABLE security (
      _id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT, isin TEXT, tickerSymbol TEXT, wkn TEXT,
      currency TEXT DEFAULT 'EUR',
      note TEXT, isRetired INTEGER DEFAULT 0,
      feedURL TEXT, feed TEXT, latestFeedURL TEXT, latestFeed TEXT,
      feedTickerSymbol TEXT, calendar TEXT,
      updatedAt TEXT NOT NULL DEFAULT '', onlineId TEXT, targetCurrency TEXT
    );
    CREATE TABLE latest_price (
      security TEXT PRIMARY KEY, tstamp TEXT,
      value INTEGER NOT NULL, open INTEGER, high INTEGER, low INTEGER, volume INTEGER
    );
    CREATE TABLE price (
      security TEXT, tstamp TEXT NOT NULL,
      value INTEGER NOT NULL, open INTEGER, high INTEGER, low INTEGER, volume INTEGER,
      PRIMARY KEY (security, tstamp)
    );
    CREATE TABLE attribute_type (
      _id INTEGER PRIMARY KEY, id TEXT NOT NULL,
      name TEXT NOT NULL, columnLabel TEXT,
      target TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
      converterClass TEXT NOT NULL DEFAULT '', props_json TEXT
    );
    CREATE TABLE security_attr (
      security TEXT NOT NULL, attr_uuid TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'string', value TEXT,
      PRIMARY KEY (security, attr_uuid)
    );
    CREATE TABLE security_prop (
      security TEXT NOT NULL, type TEXT NOT NULL,
      name TEXT NOT NULL, value TEXT, seq INTEGER DEFAULT 0
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
    CREATE TABLE property (name TEXT PRIMARY KEY, special INTEGER NOT NULL DEFAULT 0, value TEXT NOT NULL);
  `);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

describe.skipIf(!hasSqliteBindings)('GET /api/securities/search', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    app = createApp(db as Parameters<typeof createApp>[0], sqlite);
    mockSearchYahoo.mockReset();
    mockSearchYahoo.mockResolvedValue([
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        type: InstrumentType.EQUITY,
        exchange: 'NMS',
        exchDisp: 'NASDAQ',
        sector: 'Technology',
        industry: 'Consumer Electronics',
      },
      {
        symbol: 'AAPL.BA',
        name: 'Apple Inc.',
        type: InstrumentType.EQUITY,
        exchange: 'BUE',
        exchDisp: null,
        sector: null,
        industry: null,
      },
    ]);
  });

  it('returns normalized search results with name and type fields', async () => {
    const res = await request(app).get('/api/securities/search?q=AAPL');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      symbol: 'AAPL',
      name: 'Apple Inc.',
      type: 'EQUITY',
      exchange: 'NMS',
      exchDisp: 'NASDAQ',
    });
  });

  it('includes all required fields for the UI spec', async () => {
    const res = await request(app).get('/api/securities/search?q=AAPL');
    const result = res.body[0];
    expect(result).toHaveProperty('symbol');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('type');
    expect(result).toHaveProperty('exchange');
    expect(result).toHaveProperty('exchDisp');
    expect(result).toHaveProperty('sector');
    expect(result).toHaveProperty('industry');
  });

  it('handles results with null optional fields', async () => {
    const res = await request(app).get('/api/securities/search?q=AAPL');
    const result = res.body[1];
    expect(result.exchDisp).toBeNull();
    expect(result.sector).toBeNull();
    expect(result.industry).toBeNull();
  });

  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/securities/search');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when q is empty', async () => {
    const res = await request(app).get('/api/securities/search?q=');
    expect(res.status).toBe(400);
  });

  it('returns 400 when q exceeds max length', async () => {
    const longQuery = 'a'.repeat(201);
    const res = await request(app).get(`/api/securities/search?q=${longQuery}`);
    expect(res.status).toBe(400);
  });

  it('handles special characters in query', async () => {
    mockSearchYahoo.mockResolvedValue([]);
    const res = await request(app).get('/api/securities/search?q=BRK.B%20%26%20test');
    expect(res.status).toBe(200);
    expect(mockSearchYahoo).toHaveBeenCalledWith('BRK.B & test');
  });

  it('returns 502 when Yahoo service fails', async () => {
    const { YahooSearchError } = await import('../../services/yahoo-search.service');
    mockSearchYahoo.mockRejectedValue(new YahooSearchError('rate limit exceeded'));
    const res = await request(app).get('/api/securities/search?q=NVDA');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Search provider unavailable');
  });
});

describe.skipIf(!hasSqliteBindings)('POST /api/securities/preview-prices', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const { sqlite, db } = createTestDb();
    app = createApp(db as Parameters<typeof createApp>[0], sqlite);
    mockFetchPreviewPrices.mockReset();
    mockFetchPreviewPrices.mockResolvedValue({
      currency: 'USD',
      prices: [
        { date: '2024-01-02', close: '185.92', high: '186.00', low: '183.50', volume: 55000000 },
        { date: '2024-01-03', close: '184.25', high: '185.00', low: '183.00', volume: 45000000 },
      ],
    });
  });

  it('returns currency and prices for a valid ticker', async () => {
    const res = await request(app)
      .post('/api/securities/preview-prices')
      .send({ ticker: 'AAPL' });
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    expect(Array.isArray(res.body.prices)).toBe(true);
    expect(res.body.prices).toHaveLength(2);
    expect(res.body.prices[0]).toMatchObject({ date: '2024-01-02', close: '185.92' });
  });

  it('returns 400 when ticker is missing', async () => {
    const res = await request(app).post('/api/securities/preview-prices').send({});
    expect(res.status).toBe(400);
  });

  it('returns 502 when Yahoo chart fails', async () => {
    const { YahooSearchError } = await import('../../services/yahoo-search.service');
    mockFetchPreviewPrices.mockRejectedValue(new YahooSearchError('timeout'));
    const res = await request(app)
      .post('/api/securities/preview-prices')
      .send({ ticker: 'INVALID' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Price provider unavailable');
  });
});

describe.skipIf(!hasSqliteBindings)('POST /api/securities/:id/prices/import', () => {
  let app: ReturnType<typeof createApp>;
  let sqlite: Database.Database;

  beforeEach(async () => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    app = createApp(testDb.db as Parameters<typeof createApp>[0], sqlite);
  });

  it('imports prices with correct unit conversion (×10^8) and syncs latest_price', async () => {
    // Create a security first
    const createRes = await request(app).post('/api/securities').send({ name: 'AAPL', currency: 'USD' });
    expect(createRes.status).toBe(201);
    const securityId = createRes.body.id as string;

    // Import prices
    const importRes = await request(app)
      .post(`/api/securities/${securityId}/prices/import`)
      .send({
        prices: [
          { date: '2024-01-02', close: '185.92', high: '186.00', low: '183.50', volume: 55000000 },
          { date: '2024-01-03', close: '184.25', high: '185.00', low: '183.00', volume: 45000000 },
        ],
      });
    expect(importRes.status).toBe(200);
    expect(importRes.body.ok).toBe(true);
    expect(importRes.body.count).toBe(2);

    // Verify prices stored with correct ×10^8 conversion
    const priceRows = sqlite.prepare('SELECT tstamp, value FROM price WHERE security = ? ORDER BY tstamp').all(securityId) as { tstamp: string; value: number }[];
    expect(priceRows).toHaveLength(2);
    expect(priceRows[0].tstamp).toBe('2024-01-02');
    // 185.92 * 1e8 = 18592000000
    expect(priceRows[0].value).toBeCloseTo(185.92 * 1e8, -2);

    // Verify latest_price synced to most recent price
    const latestRow = sqlite.prepare('SELECT tstamp, value FROM latest_price WHERE security = ?').get(securityId) as { tstamp: string; value: number } | undefined;
    expect(latestRow).toBeDefined();
    expect(latestRow!.tstamp).toBe('2024-01-03');
  });

  it('deduplicates prices on conflict (INSERT OR REPLACE)', async () => {
    const createRes = await request(app).post('/api/securities').send({ name: 'MSFT', currency: 'USD' });
    const securityId = createRes.body.id as string;

    await request(app)
      .post(`/api/securities/${securityId}/prices/import`)
      .send({ prices: [{ date: '2024-01-02', close: '185.00' }] });

    // Import again with updated close for same date
    const res = await request(app)
      .post(`/api/securities/${securityId}/prices/import`)
      .send({ prices: [{ date: '2024-01-02', close: '190.00' }] });
    expect(res.status).toBe(200);

    const priceRows = sqlite.prepare('SELECT value FROM price WHERE security = ? AND tstamp = ?').all(securityId, '2024-01-02') as { value: number }[];
    expect(priceRows).toHaveLength(1);
    // Should be updated to 190.00
    expect(priceRows[0].value).toBeCloseTo(190.00 * 1e8, -2);
  });

  it('returns 400 with empty prices array', async () => {
    const createRes = await request(app).post('/api/securities').send({ name: 'TEST', currency: 'EUR' });
    const securityId = createRes.body.id as string;
    const res = await request(app)
      .post(`/api/securities/${securityId}/prices/import`)
      .send({ prices: [] });
    expect(res.status).toBe(400);
  });

  it('returns 404 when security does not exist', async () => {
    const res = await request(app)
      .post('/api/securities/non-existent-id/prices/import')
      .send({ prices: [{ date: '2024-01-02', close: '100.00' }] });
    expect(res.status).toBe(404);
  });
});
