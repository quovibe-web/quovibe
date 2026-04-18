// Regression harness for BUG-40: the watchlist "Change" column rendered
// +0.00% for every row because the previousClose subquery returned the most
// recent price in the `price` table — which, on any day yf.chart() had
// already run, is today's intraday snapshot (see .claude/rules/latest-price.md).
// That snapshot equals latest_price.value by construction, so
// (latestPrice - previousClose) / previousClose always collapsed to zero.
//
// The fix clamps the previousClose subquery to prices strictly earlier than
// latest_price.tstamp. Any regression that drops the date guard or reverts
// to `ORDER BY tstamp DESC LIMIT 1` will fail this test.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-wl-prevclose-'));
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

interface Seeded {
  securityUuid: string;
}

function seedSecurityAndPrices(
  pid: string,
  opts: {
    yesterdayClose: number;     // human units, e.g. 100.0
    todaySnapshot: number | null; // human units for intraday row in `price`, or null to skip
    latestPriceValue: number | null; // human units for `latest_price`, or null to skip
    latestPriceDate: string | null;
  },
): Seeded {
  const securityUuid = randomUUID();
  const h = acquirePortfolioDb(pid);
  try {
    h.sqlite.prepare(
      `INSERT INTO security (_id, uuid, name, currency, isRetired, updatedAt)
       VALUES (100, ?, 'ACME Corp', 'EUR', 0, '2026-01-01T00:00:00Z')`,
    ).run(securityUuid);

    // Historical close from the previous trading day.
    h.sqlite.prepare(
      `INSERT INTO price (security, tstamp, value) VALUES (?, '2026-04-17', ?)`,
    ).run(securityUuid, Math.round(opts.yesterdayClose * 1e8));

    // Today's intraday snapshot (written by yf.chart() on first daily fetch).
    if (opts.todaySnapshot != null) {
      h.sqlite.prepare(
        `INSERT INTO price (security, tstamp, value) VALUES (?, '2026-04-18', ?)`,
      ).run(securityUuid, Math.round(opts.todaySnapshot * 1e8));
    }

    // Live latest_price scalar — what `yf.quote()` refreshes during the day.
    if (opts.latestPriceValue != null && opts.latestPriceDate != null) {
      h.sqlite.prepare(
        `INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)`,
      ).run(securityUuid, opts.latestPriceDate, Math.round(opts.latestPriceValue * 1e8));
    }
  } finally {
    releasePortfolioDb(pid);
  }
  return { securityUuid };
}

async function createWatchlistWithSecurity(
  app: ReturnType<typeof createApp>,
  pid: string,
  securityUuid: string,
): Promise<number> {
  const rList = await request(app).post(`/api/p/${pid}/watchlists`).send({ name: 'WL' });
  expect(rList.status).toBe(201);
  const listId = rList.body.id as number;

  const rAdd = await request(app)
    .post(`/api/p/${pid}/watchlists/${listId}/securities`)
    .send({ securityId: securityUuid });
  expect(rAdd.status).toBe(201);

  return listId;
}

interface WatchlistSecurityPayload {
  id: string;
  latestPrice: number | null;
  previousClose: number | null;
}
interface WatchlistPayload {
  id: number;
  securities: WatchlistSecurityPayload[];
}

async function fetchWatchlistSecurity(
  app: ReturnType<typeof createApp>,
  pid: string,
  listId: number,
  securityUuid: string,
): Promise<WatchlistSecurityPayload> {
  const res = await request(app).get(`/api/p/${pid}/watchlists`);
  expect(res.status).toBe(200);
  const wl = (res.body as WatchlistPayload[]).find(w => w.id === listId);
  expect(wl, 'watchlist missing from response').toBeDefined();
  const sec = wl!.securities.find(s => s.id === securityUuid);
  expect(sec, 'security missing from watchlist payload').toBeDefined();
  return sec!;
}

describe('GET /api/p/:pid/watchlists — previousClose (BUG-40)', () => {
  it('returns yesterday\'s close as previousClose, not today\'s intraday snapshot', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'WL-PREVCLOSE-1' });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id as string;

    const { securityUuid } = seedSecurityAndPrices(pid, {
      yesterdayClose: 100.0,
      todaySnapshot: 101.0,        // the trap: yf.chart() wrote this on the first daily fetch
      latestPriceValue: 102.0,     // live quote during the trading day
      latestPriceDate: '2026-04-18',
    });

    const listId = await createWatchlistWithSecurity(app, pid, securityUuid);
    const sec = await fetchWatchlistSecurity(app, pid, listId, securityUuid);

    expect(sec.latestPrice).toBe(102.0);
    // Under BUG-40 this would be 101.0 (today's snapshot) → change ≈ +0.99%
    // After the fix it must be 100.0 (yesterday's close) → change ≈ +2.00%
    expect(sec.previousClose).toBe(100.0);
  });

  it('falls back to the last available close when no intraday snapshot exists', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'WL-PREVCLOSE-2' });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id as string;

    const { securityUuid } = seedSecurityAndPrices(pid, {
      yesterdayClose: 100.0,
      todaySnapshot: null,         // yf.chart() hasn't run today
      latestPriceValue: 102.0,
      latestPriceDate: '2026-04-18',
    });

    const listId = await createWatchlistWithSecurity(app, pid, securityUuid);
    const sec = await fetchWatchlistSecurity(app, pid, listId, securityUuid);

    expect(sec.latestPrice).toBe(102.0);
    expect(sec.previousClose).toBe(100.0);
  });

  it('returns null previousClose when no historical close pre-dates latest_price', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const rP = await request(app).post('/api/portfolios').send({ source: 'fresh', name: 'WL-PREVCLOSE-3' });
    expect(rP.status).toBe(201);
    const pid = rP.body.entry.id as string;

    // Only same-day rows exist — there is no earlier close to reference.
    const securityUuid = randomUUID();
    const h = acquirePortfolioDb(pid);
    try {
      h.sqlite.prepare(
        `INSERT INTO security (_id, uuid, name, currency, isRetired, updatedAt)
         VALUES (100, ?, 'NEW IPO', 'EUR', 0, '2026-01-01T00:00:00Z')`,
      ).run(securityUuid);
      h.sqlite.prepare(
        `INSERT INTO price (security, tstamp, value) VALUES (?, '2026-04-18', ?)`,
      ).run(securityUuid, Math.round(101.0 * 1e8));
      h.sqlite.prepare(
        `INSERT INTO latest_price (security, tstamp, value) VALUES (?, '2026-04-18', ?)`,
      ).run(securityUuid, Math.round(102.0 * 1e8));
    } finally {
      releasePortfolioDb(pid);
    }

    const listId = await createWatchlistWithSecurity(app, pid, securityUuid);
    const sec = await fetchWatchlistSecurity(app, pid, listId, securityUuid);

    expect(sec.latestPrice).toBe(102.0);
    expect(sec.previousClose).toBeNull();
  });
});
