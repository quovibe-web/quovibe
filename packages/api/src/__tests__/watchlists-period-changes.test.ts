// Regression harness for BUG-66: the watchlists surface emits change1d /
// change1w / change1m / change1y for each security, computed server-side
// from the price table anchored on latest_price.tstamp (or the newest
// price.tstamp when latest_price is absent). The route uses SQLite's
// date(anchor, '-N {days,month,year}') modifier to pick the historical close
// at or before the anchor minus the window; the service layer converts the
// ×10^8 integers via Decimal and delegates the ratio to engine.simpleReturn.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-wl-periodchg-'));
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

interface PeriodChange {
  value: number;
  asOf: string;
}

interface WatchlistSecurityPayload {
  id: string;
  latestPrice: number | null;
  previousClose: number | null;
  change1d: PeriodChange | null;
  change1w: PeriodChange | null;
  change1m: PeriodChange | null;
  change1y: PeriodChange | null;
}

function seedPrices(pid: string, priceRows: Array<{ date: string; value: number }>, latest: { date: string; value: number } | null): string {
  const securityUuid = randomUUID();
  const h = acquirePortfolioDb(pid);
  try {
    h.sqlite.prepare(
      `INSERT INTO security (_id, uuid, name, currency, isRetired, updatedAt)
       VALUES (100, ?, 'ACME Corp', 'EUR', 0, '2026-01-01T00:00:00Z')`,
    ).run(securityUuid);

    const ins = h.sqlite.prepare('INSERT INTO price (security, tstamp, value) VALUES (?, ?, ?)');
    for (const row of priceRows) {
      ins.run(securityUuid, row.date, Math.round(row.value * 1e8));
    }

    if (latest) {
      h.sqlite.prepare(
        'INSERT INTO latest_price (security, tstamp, value) VALUES (?, ?, ?)',
      ).run(securityUuid, latest.date, Math.round(latest.value * 1e8));
    }
  } finally {
    releasePortfolioDb(pid);
  }
  return securityUuid;
}

async function createFreshPortfolio(app: ReturnType<typeof createApp>, name: string): Promise<string> {
  const r = await request(app).post('/api/portfolios').send({
    source: 'fresh',
    name,
    baseCurrency: 'EUR',
    securitiesAccountName: 'Main Securities',
    primaryDeposit: { name: 'Cash' },
  });
  expect(r.status).toBe(201);
  return r.body.entry.id as string;
}

async function fetchSecurityPayload(
  app: ReturnType<typeof createApp>,
  pid: string,
  securityUuid: string,
): Promise<WatchlistSecurityPayload> {
  const wlRes = await request(app).post(`/api/p/${pid}/watchlists`).send({ name: 'WL' });
  expect(wlRes.status).toBe(201);
  const listId = wlRes.body.id as number;
  const addRes = await request(app)
    .post(`/api/p/${pid}/watchlists/${listId}/securities`)
    .send({ securityId: securityUuid });
  expect(addRes.status).toBe(201);

  const listRes = await request(app).get(`/api/p/${pid}/watchlists`);
  expect(listRes.status).toBe(200);
  const wl = (listRes.body as Array<{ id: number; securities: WatchlistSecurityPayload[] }>)
    .find(w => w.id === listId);
  expect(wl).toBeDefined();
  const sec = wl!.securities.find(s => s.id === securityUuid);
  expect(sec).toBeDefined();
  return sec!;
}

describe('GET /api/p/:pid/watchlists — change1d/1w/1m/1y (BUG-66)', () => {
  it('computes each period change vs the price at or before anchor - N', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await createFreshPortfolio(app, 'WL-CHG-1');

    // Anchor = latest_price.tstamp = 2026-04-20, value 120.
    // 1D anchor: last price strictly before 2026-04-20 → 2026-04-19 @ 100 → (120-100)/100 = 0.20
    // 1W anchor: last price ≤ date('2026-04-20','-7 days') = 2026-04-13 → 2026-04-13 @ 80 → 0.5
    // 1M anchor: last price ≤ 2026-03-20 → 2026-03-10 @ 60 → 1.0
    // 1Y anchor: last price ≤ 2025-04-20 → 2025-04-15 @ 30 → 3.0
    const securityUuid = seedPrices(pid, [
      { date: '2025-04-15', value: 30 },
      { date: '2026-03-10', value: 60 },
      { date: '2026-04-13', value: 80 },
      { date: '2026-04-19', value: 100 },
    ], { date: '2026-04-20', value: 120 });

    const sec = await fetchSecurityPayload(app, pid, securityUuid);

    expect(sec.latestPrice).toBe(120);
    expect(sec.previousClose).toBe(100);
    expect(sec.change1d).not.toBeNull();
    expect(sec.change1d!.value).toBeCloseTo(0.20, 10);
    expect(sec.change1d!.asOf).toBe('2026-04-19');
    expect(sec.change1w!.value).toBeCloseTo(0.50, 10);
    expect(sec.change1w!.asOf).toBe('2026-04-13');
    expect(sec.change1m!.value).toBeCloseTo(1.00, 10);
    expect(sec.change1m!.asOf).toBe('2026-03-10');
    expect(sec.change1y!.value).toBeCloseTo(3.00, 10);
    expect(sec.change1y!.asOf).toBe('2025-04-15');
  });

  it('emits null for any window that pre-dates the security\'s price history', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await createFreshPortfolio(app, 'WL-CHG-2');

    // Only a single historical row 2 days before anchor. 1D available (= the
    // row itself via "strictly before latestPriceDate"); 1W/1M/1Y require a
    // row ≤ anchor - N which does not exist → null.
    const securityUuid = seedPrices(pid, [
      { date: '2026-04-18', value: 100 },
    ], { date: '2026-04-20', value: 110 });

    const sec = await fetchSecurityPayload(app, pid, securityUuid);

    expect(sec.change1d).not.toBeNull();
    expect(sec.change1d!.value).toBeCloseTo(0.10, 10);
    expect(sec.change1w).toBeNull();
    expect(sec.change1m).toBeNull();
    expect(sec.change1y).toBeNull();
  });

  it('anchors on the newest price when latest_price is absent', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();
    const pid = await createFreshPortfolio(app, 'WL-CHG-3');

    // No latest_price row. Anchor = max(price.tstamp) = 2026-04-20 @ 150.
    // 1W window anchors on date('2026-04-20','-7 days') = 2026-04-13.
    const securityUuid = seedPrices(pid, [
      { date: '2026-04-13', value: 100 },
      { date: '2026-04-20', value: 150 },
    ], null);

    const sec = await fetchSecurityPayload(app, pid, securityUuid);

    expect(sec.latestPrice).toBeNull(); // latestPrice still tracks latest_price explicitly
    expect(sec.change1w).not.toBeNull();
    expect(sec.change1w!.value).toBeCloseTo(0.50, 10);
    expect(sec.change1w!.asOf).toBe('2026-04-13');
  });
});
