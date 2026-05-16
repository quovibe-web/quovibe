// Regression harness for the candlestick wire surface: GET
// /api/p/:pid/securities/:id must return Open + OHLCV on each `prices[]`
// row so the security-detail chart can render candlesticks for
// CSV-imported securities. The schema patch (`apply-bootstrap.ts >
// VENDOR_COLUMN_PATCHES`) and the CSV write path (`executePriceImport`)
// landed in a prior session; this test pins the read path.
//
// Any regression that strips `open` / `high` / `low` / `volume` from the
// route's response, drops the OHLC conversion in `convertPriceFromDb`, or
// reverts the drizzle `prices` shape will fail one of these cases.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-sec-ohlc-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;
let acquirePortfolioDb: typeof import('../services/portfolio-db-pool').acquirePortfolioDb;
let releasePortfolioDb: typeof import('../services/portfolio-db-pool').releasePortfolioDb;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
  ({ createApp } = await import('../create-app'));
  ({ loadSettings } = await import('../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../services/boot-recovery'));
  await import('../services/portfolio-registry');
  ({ acquirePortfolioDb, releasePortfolioDb } = await import('../services/portfolio-db-pool'));
});

async function setup() {
  loadSettings();
  recoverFromInterruptedSwap();
  const app = createApp();

  const rP = await request(app).post('/api/portfolios').send({
    source: 'fresh',
    name: `OHLC Test ${Math.random().toString(36).slice(2)}`,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main',
    primaryDeposit: { name: 'Cash' },
  });
  expect(rP.status).toBe(201);
  const pid = rP.body.entry.id as string;

  const rS = await request(app)
    .post(`/api/p/${pid}/securities`)
    .send({ name: 'No-Ticker Note', currency: 'EUR' });
  expect(rS.status).toBe(201);
  const secId = rS.body.id as string;

  return { app, pid, secId };
}

function seedPrice(
  pid: string,
  secId: string,
  date: string,
  close: number,
  ohlc: { open?: number; high?: number; low?: number; volume?: number } = {},
): void {
  const h = acquirePortfolioDb(pid);
  try {
    h.sqlite.prepare(
      `INSERT INTO price (security, tstamp, value, open, high, low, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      secId,
      date,
      Math.round(close * 1e8),
      ohlc.open != null ? Math.round(ohlc.open * 1e8) : null,
      ohlc.high != null ? Math.round(ohlc.high * 1e8) : null,
      ohlc.low != null ? Math.round(ohlc.low * 1e8) : null,
      ohlc.volume ?? null,
    );
  } finally {
    releasePortfolioDb(pid);
  }
}

describe('GET /api/p/:pid/securities/:id — OHLC wire shape', () => {
  it('returns open/high/low/volume on each price row when persisted', async () => {
    const { app, pid, secId } = await setup();

    seedPrice(pid, secId, '2024-01-15', 150.50, {
      open: 149.50, high: 151.00, low: 149.00, volume: 1_000_000,
    });
    seedPrice(pid, secId, '2024-01-16', 152.25, {
      open: 150.75, high: 152.75, low: 150.50, volume: 1_250_000,
    });

    const res = await request(app).get(`/api/p/${pid}/securities/${secId}`);
    expect(res.status).toBe(200);
    const prices = res.body.prices as Array<{
      date: string; value: string;
      open: string | null; high: string | null; low: string | null;
      volume: number | null;
    }>;
    expect(prices).toHaveLength(2);

    const first = prices[0]!;
    expect(first.date).toBe('2024-01-15');
    expect(first.value).toBe('150.5');
    expect(first.open).toBe('149.5');
    expect(first.high).toBe('151');
    expect(first.low).toBe('149');
    expect(first.volume).toBe(1_000_000);

    const second = prices[1]!;
    expect(second.value).toBe('152.25');
    expect(second.open).toBe('150.75');
    expect(second.high).toBe('152.75');
    expect(second.low).toBe('150.5');
    expect(second.volume).toBe(1_250_000);
  });

  it('returns null OHLC fields for close-only rows (Yahoo-fetched shape)', async () => {
    const { app, pid, secId } = await setup();

    seedPrice(pid, secId, '2024-02-01', 200.00);  // no OHLC, no volume

    const res = await request(app).get(`/api/p/${pid}/securities/${secId}`);
    expect(res.status).toBe(200);
    const prices = res.body.prices as Array<{
      date: string; value: string;
      open: string | null; high: string | null; low: string | null;
      volume: number | null;
    }>;
    expect(prices).toHaveLength(1);
    expect(prices[0]!.value).toBe('200');
    expect(prices[0]!.open).toBeNull();
    expect(prices[0]!.high).toBeNull();
    expect(prices[0]!.low).toBeNull();
    expect(prices[0]!.volume).toBeNull();
  });
});
